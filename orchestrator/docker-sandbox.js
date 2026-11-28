import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IMAGE_NAME = "converge-sandbox";
const PYTHON_TIMEOUT_MS = 30_000;
const NODE_INSTALL_TIMEOUT_MS = 180_000;
const NODE_CHECK_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 60_000;

/** Resolve a test working directory without allowing it to escape the repo. */
export function resolveTestDirectory(repoPath, requestedPath = ".") {
  const repoRoot = fs.realpathSync(path.resolve(repoPath));
  const requested = typeof requestedPath === "string" && requestedPath.trim()
    ? requestedPath.trim()
    : ".";
  const candidate = path.resolve(repoRoot, requested);
  const relativeCandidate = path.relative(repoRoot, candidate);
  if (relativeCandidate === ".." || relativeCandidate.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCandidate)) {
    throw new Error("Test directory must stay inside the repository.");
  }

  const realCandidate = fs.realpathSync(candidate);
  const relativeReal = path.relative(repoRoot, realCandidate);
  if (relativeReal === ".." || relativeReal.startsWith(`..${path.sep}`) || path.isAbsolute(relativeReal)) {
    throw new Error("Test directory must stay inside the repository.");
  }
  if (!fs.statSync(realCandidate).isDirectory()) {
    throw new Error("Test path must be a directory.");
  }

  return relativeReal ? relativeReal.split(path.sep).join(path.posix.sep) : ".";
}

/** Pick a safe verification command for the selected project directory. */
export function detectProjectCheck(projectDirectory) {
  const packageJsonPath = path.join(projectDirectory, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return { kind: "pytest", command: ["pytest", "-q"], verification: "tests" };
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (err) {
    return { kind: "error", error: `Could not read package.json: ${err.message}` };
  }

  let script;
  let kind;
  if (typeof packageJson.scripts?.test === "string" && packageJson.scripts.test.trim()) {
    script = "test";
    kind = "npm-test";
  } else if (typeof packageJson.scripts?.build === "string" && packageJson.scripts.build.trim()) {
    script = "build";
    kind = "npm-build";
  } else {
    return { kind: "pytest", command: ["pytest", "-q"], verification: "tests" };
  }

  if (!fs.existsSync(path.join(projectDirectory, "package-lock.json"))) {
    return {
      kind: "error",
      error: "This npm project needs package-lock.json so dependencies can be installed reproducibly in the sandbox.",
    };
  }

  return {
    kind,
    command: ["npm", "run", script],
    verification: script === "test" ? "tests" : "build",
  };
}

export function isPackageLockOutOfSync(output = "") {
  return /package\.json and package-lock\.json.*(?:not in sync|out of sync)|npm ci can only install packages when|Missing: .+ from lock file/i.test(output);
}

function appendOutput(current, chunk) {
  const combined = current + chunk;
  if (combined.length <= MAX_OUTPUT_CHARS) return combined;
  return `${combined.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated …`;
}

function runDocker(args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ ...result, output: `${stdout}${stderr}`.trim() });
    };
    const killTimer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (data) => { stdout = appendOutput(stdout, data.toString()); });
    proc.stderr.on("data", (data) => { stderr = appendOutput(stderr, data.toString()); });
    proc.on("error", (err) => finish({ code: null, error: err, timedOut }));
    proc.on("close", (code) => finish({ code, error: null, timedOut }));
  });
}

function containerWorkspacePath(relativeTestPath) {
  return relativeTestPath === "." ? "/workspace" : path.posix.join("/workspace", relativeTestPath);
}

function appendContainerLimits(args, { node = false } = {}) {
  args.push(
    "--memory", node ? "2g" : "256m",
    "--cpus", node ? "2" : "1",
    "--pids-limit", node ? "512" : "128",
    "--read-only",
    "--tmpfs", node ? "/tmp:rw,nosuid,size=512m" : "/tmp"
  );
  return args;
}

function appendGitReadOnlyMount(args, repoPath) {
  const gitMetadata = path.join(repoPath, ".git");
  if (fs.existsSync(gitMetadata)) args.push("-v", `${gitMetadata}:/workspace/.git:ro`);
}

function resultFromRun(run, description) {
  if (run.error) {
    return { passed: false, output: `Failed to start sandbox container: ${run.error.message}` };
  }
  if (run.timedOut) {
    return { passed: false, output: `TIMEOUT: ${description} exceeded its time limit.` };
  }
  return { passed: run.code === 0, output: run.output };
}

async function runPythonTests(repoPath, relativeTestPath) {
  const args = ["run", "--rm", "--network", "none"];
  appendContainerLimits(args);
  args.push("-v", `${repoPath}:/workspace:rw`, "-w", containerWorkspacePath(relativeTestPath));
  appendGitReadOnlyMount(args, repoPath);
  args.push(IMAGE_NAME, "pytest", "-q");

  const run = await runDocker(args, PYTHON_TIMEOUT_MS);
  return { ...resultFromRun(run, "Python test run"), verification: "tests", runner: "pytest" };
}

async function runNpmCheck(repoPath, relativeTestPath, projectCheck) {
  const volumeName = `converge-node-deps-${randomUUID().replaceAll("-", "")}`;
  const workspacePath = containerWorkspacePath(relativeTestPath);
  const nodeModulesContainerPath = path.posix.join(workspacePath, "node_modules");
  const nodeModulesHostPath = path.join(repoPath, relativeTestPath === "." ? "" : relativeTestPath, "node_modules");
  let createdNodeModulesDirectory = false;

  try {
    const volume = await runDocker(["volume", "create", volumeName], 15_000);
    if (volume.error || volume.code !== 0) {
      return { passed: false, output: `Could not create temporary dependency storage: ${volume.output || volume.error?.message || "Docker volume creation failed."}` };
    }

    // Create the mount point in the disposable checkout. Dependencies live in
    // a Docker volume, never in the repository files being prepared for a PR.
    if (!fs.existsSync(nodeModulesHostPath)) {
      fs.mkdirSync(nodeModulesHostPath, { recursive: true });
      createdNodeModulesDirectory = true;
    }

    const installArgs = ["run", "--rm", "--network", "bridge"];
    appendContainerLimits(installArgs, { node: true });
    installArgs.push(
      "--user", "0:0",
      "-v", `${repoPath}:/workspace:ro`,
      "-v", `${volumeName}:${nodeModulesContainerPath}`,
      "-w", workspacePath,
      IMAGE_NAME,
      "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", "/tmp/npm-cache"
    );
    let install = await runDocker(installArgs, NODE_INSTALL_TIMEOUT_MS);
    if (!install.error && !install.timedOut && install.code !== 0 && isPackageLockOutOfSync(install.output)) {
      // The agent may add a test script or test-only dependency while fixing a
      // project that had no test suite. Refresh the lockfile without running
      // package lifecycle scripts, then retry the reproducible npm ci install.
      const lockArgs = ["run", "--rm", "--network", "bridge"];
      appendContainerLimits(lockArgs, { node: true });
      lockArgs.push(
        "--user", "0:0",
        "-v", `${repoPath}:/workspace:rw`,
        "-w", workspacePath,
        IMAGE_NAME,
        "npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", "/tmp/npm-cache"
      );
      const lockUpdate = await runDocker(lockArgs, NODE_INSTALL_TIMEOUT_MS);
      if (lockUpdate.error || lockUpdate.timedOut || lockUpdate.code !== 0) {
        const failure = resultFromRun(lockUpdate, "npm lockfile update");
        return {
          passed: false,
          verification: projectCheck.verification,
          runner: projectCheck.kind,
          output: `Could not update package-lock.json after package.json changed (lifecycle scripts were disabled):\n${failure.output || "npm install --package-lock-only exited unsuccessfully."}`,
        };
      }
      install = await runDocker(installArgs, NODE_INSTALL_TIMEOUT_MS);
    }
    if (install.error || install.timedOut || install.code !== 0) {
      const failure = resultFromRun(install, "npm dependency installation");
      return {
        passed: false,
        verification: projectCheck.verification,
        runner: projectCheck.kind,
        output: `Dependency installation failed (npm lifecycle scripts were disabled):\n${failure.output || "npm ci exited unsuccessfully."}`,
      };
    }

    const checkArgs = ["run", "--rm", "--network", "none"];
    appendContainerLimits(checkArgs, { node: true });
    checkArgs.push(
      "-e", "CI=true",
      "-e", "NEXT_TELEMETRY_DISABLED=1",
      "-e", "RAYON_NUM_THREADS=2",
      "-e", "UV_THREADPOOL_SIZE=2",
      "-v", `${repoPath}:/workspace:rw`,
      // Build tools such as Vite write temporary config/cache files under
      // node_modules. This is an isolated throwaway Docker volume, not the repo.
      "-v", `${volumeName}:${nodeModulesContainerPath}`
    );
    appendGitReadOnlyMount(checkArgs, repoPath);
    checkArgs.push("-w", workspacePath, IMAGE_NAME, ...projectCheck.command);

    const check = await runDocker(checkArgs, NODE_CHECK_TIMEOUT_MS);
    const result = resultFromRun(check, projectCheck.verification === "build" ? "JavaScript build" : "JavaScript test run");
    return {
      ...result,
      verification: projectCheck.verification,
      runner: projectCheck.kind,
      output: `${projectCheck.command.join(" ")}\n${result.output}`.trim(),
    };
  } catch (err) {
    return { passed: false, verification: projectCheck.verification, runner: projectCheck.kind, output: err.message };
  } finally {
    await runDocker(["volume", "rm", "-f", volumeName], 15_000);
    if (createdNodeModulesDirectory) {
      try {
        fs.rmSync(nodeModulesHostPath, { recursive: true, force: true });
      } catch {
        // The checkout is disposable; cleanup failure must not hide the run result.
      }
    }
  }
}

/**
 * Run Python tests or an npm check in a disposable, resource-limited Docker
 * container. npm dependencies install in a temporary networked container with
 * lifecycle scripts disabled; the actual test/build command runs offline.
 */
export async function runTestsInSandbox(repoPath, testPath = ".") {
  const absRepoPath = path.resolve(repoPath);
  let relativeTestPath;
  try {
    relativeTestPath = resolveTestDirectory(absRepoPath, testPath);
  } catch (err) {
    return { passed: false, output: err.message };
  }

  const projectDirectory = path.join(absRepoPath, relativeTestPath === "." ? "" : relativeTestPath);
  const projectCheck = detectProjectCheck(projectDirectory);
  if (projectCheck.kind === "error") {
    return { passed: false, output: projectCheck.error };
  }

  if (projectCheck.kind === "pytest") {
    return runPythonTests(absRepoPath, relativeTestPath);
  }
  return runNpmCheck(absRepoPath, relativeTestPath, projectCheck);
}

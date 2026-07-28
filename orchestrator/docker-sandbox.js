import { spawn } from "node:child_process";
import path from "node:path";

const IMAGE_NAME = "converge-sandbox";
const TIMEOUT_MS = 30_000;

/**
 * Runs `pytest` for the given repo inside a locked-down, disposable
 * Docker container and returns { passed, output }.
 *
 * Isolation choices, and why each one is there:
 *  --rm            container is destroyed after the run, no state persists
 *  --network none  the code being tested cannot phone home, exfiltrate,
 *                   or pull in anything not already in the image
 *  --memory / --cpus  caps a runaway or intentionally malicious test
 *                   from exhausting host resources
 *  --pids-limit    stops fork-bombs
 *  --read-only + tmpfs /tmp  repo mount is the only writable path that
 *                   matters; scratch space is a tmpfs, not disk
 *  timeout          a hung test (e.g. an infinite loop the LLM introduced)
 *                   can't block the agent loop forever
 */
export function runTestsInSandbox(repoPath) {
  return new Promise((resolve) => {
    const absRepoPath = path.resolve(repoPath);

    const args = [
      "run",
      "--rm",
      "--network", "none",
      "--memory", "256m",
      "--cpus", "1",
      "--pids-limit", "128",
      "--read-only",
      "--tmpfs", "/tmp",
      "-v", `${absRepoPath}:/workspace:rw`,
      "-w", "/workspace",
      IMAGE_NAME,
      "pytest", "-q",
    ];

    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      clearTimeout(killTimer);
      if (timedOut) {
        resolve({ passed: false, output: "TIMEOUT: test run exceeded 30s (likely infinite loop or hang)." });
        return;
      }
      resolve({ passed: code === 0, output: (stdout + stderr).trim() });
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({ passed: false, output: `Failed to start sandbox container: ${err.message}` });
    });
  });
}

import { spawn } from "node:child_process";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function gitAuthEnv(token) {
  // Empty values clear host-level helpers/headers before adding only the
  // per-user credential. Keep proxy and other non-credential Git settings.
  const entries = [
    ["credential.helper", ""],
    ["http.https://github.com/.extraheader", ""],
  ];
  if (token) {
    entries.push([
      "http.https://github.com/.extraheader",
      `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    ]);
  }
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(entries.length),
  };
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function run(cmd, args, cwd, { env = process.env, displayArgs = args, secret = null } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const output = stderr || stdout;
        const safeOutput = secret
          ? output.replaceAll(secret, "[redacted]").replaceAll(Buffer.from(`x-access-token:${secret}`).toString("base64"), "[redacted]")
          : output;
        reject(new Error(`${cmd} ${displayArgs.join(" ")} failed:\n${safeOutput}`));
      }
    });
  });
}

/**
 * Parses "https://github.com/owner/repo" or "owner/repo" or a .git URL
 * into { owner, repo }.
 */
export function parseRepoSlug(input) {
  if (typeof input !== "string" || input.length > 300) {
    throw new Error("Repository must be an owner/repo slug or a GitHub HTTPS URL.");
  }

  const slug = input.trim();
  const match = slug.match(/^(?:https:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error("Repository must be a GitHub owner/repo slug or https://github.com/owner/repo URL.");
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Clones a repo without writing credentials into its origin URL or Git config.
 */
export async function cloneRepo(repoSlugOrUrl, destDir, { token = GITHUB_TOKEN } = {}) {
  const { owner, repo } = parseRepoSlug(repoSlugOrUrl);
  const url = `https://github.com/${owner}/${repo}.git`;
  const env = gitAuthEnv(token);
  await run("git", ["clone", url, destDir], undefined, {
    env,
    displayArgs: ["clone", url, destDir],
    secret: token,
  });
  return { owner, repo };
}

export async function createBranch(repoDir, branchName) {
  await run("git", ["checkout", "-b", branchName], repoDir);
}

export async function commitAndPush(repoDir, branchName, message, { token = GITHUB_TOKEN, owner, repo } = {}) {
  await run("git", ["add", "-A"], repoDir);
  // Nothing to commit is not an error worth crashing over — surface it instead.
  try {
    await run("git", ["commit", "-m", message], repoDir);
  } catch (e) {
    if (/nothing to commit/i.test(e.message)) {
      throw new Error("Agent made no file changes — nothing to commit. Check the agent trace.");
    }
    throw e;
  }
  const env = gitAuthEnv(token);
  if (owner && repo) {
    const url = `https://github.com/${owner}/${repo}.git`;
    // Tests run against untrusted code. Pin both fetch and push URLs before
    // sending the access token so test code cannot redirect the push.
    await run("git", ["config", "--local", "--replace-all", "remote.origin.url", url], repoDir, { env });
    await run("git", ["config", "--local", "--replace-all", "remote.origin.pushurl", url], repoDir, { env });
  }
  await run("git", ["push", "-u", "origin", branchName], repoDir, {
    env,
    secret: token,
  });
}

export async function getDefaultBranch(owner, repo, token = GITHUB_TOKEN) {
  if (!token) return "main"; // best-effort fallback for unauthenticated/public use
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

export async function assertCanPushToRepo(owner, repo, token) {
  if (!token) throw new Error("Connect GitHub before opening a pull request.");
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.get({ owner, repo });
  if (data.permissions?.push !== true) {
    throw new Error("Your connected GitHub account does not have write access to this repository.");
  }
  return data.default_branch;
}

export async function openPullRequest({ owner, repo, branchName, baseBranch = "main", title, body, token = GITHUB_TOKEN }) {
  if (!token) throw new Error("A GitHub access token is required to open a pull request.");
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    head: branchName,
    base: baseBranch,
    title,
    body,
  });
  return { url: data.html_url, number: data.number };
}

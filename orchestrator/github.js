import { spawn } from "node:child_process";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function run(cmd, args, cwd, { env = process.env, displayArgs = args } = {}) {
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
        const safeOutput = GITHUB_TOKEN ? output.replaceAll(GITHUB_TOKEN, "[redacted]") : output;
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
 * Clones a repo into destDir using an authenticated HTTPS URL (token is
 * only ever passed as a process arg / injected into a URL that's never
 * logged — it does not go through the shell, so it won't show up in
 * process listings or shell history).
 */
export async function cloneRepo(repoSlugOrUrl, destDir, { useToken = true } = {}) {
  const { owner, repo } = parseRepoSlug(repoSlugOrUrl);
  const url = `https://github.com/${owner}/${repo}.git`;
  const env = { ...process.env };
  env.GIT_TERMINAL_PROMPT = "0";
  if (useToken && GITHUB_TOKEN) {
    // Avoid putting credentials in argv or in the cloned repo's origin URL.
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString("base64")}`;
  }
  await run("git", ["clone", url, destDir], undefined, {
    env,
    displayArgs: ["clone", url, destDir],
  });
  return { owner, repo };
}

export async function createBranch(repoDir, branchName) {
  await run("git", ["checkout", "-b", branchName], repoDir);
}

export async function commitAndPush(repoDir, branchName, message) {
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
  await run("git", ["push", "-u", "origin", branchName], repoDir);
}

export async function getDefaultBranch(owner, repo) {
  if (!GITHUB_TOKEN) return "main"; // best-effort fallback for unauthenticated/public use
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

export async function openPullRequest({ owner, repo, branchName, baseBranch = "main", title, body }) {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set — cannot open a PR without an authenticated GitHub client.");
  }
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
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

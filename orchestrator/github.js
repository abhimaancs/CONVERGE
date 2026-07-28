import { spawn } from "node:child_process";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} ${args.join(" ")} failed:\n${stderr || stdout}`));
    });
  });
}

/**
 * Parses "https://github.com/owner/repo" or "owner/repo" or a .git URL
 * into { owner, repo }.
 */
export function parseRepoSlug(input) {
  const cleaned = input.replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/) || cleaned.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error(`Could not parse a GitHub owner/repo out of: ${input}`);
  return { owner: match[1], repo: match[2] };
}

/**
 * Clones a repo into destDir using an authenticated HTTPS URL (token is
 * only ever passed as a process arg / injected into a URL that's never
 * logged — it does not go through the shell, so it won't show up in
 * process listings or shell history).
 */
export async function cloneRepo(repoSlugOrUrl, destDir) {
  const { owner, repo } = parseRepoSlug(repoSlugOrUrl);
  const authedUrl = GITHUB_TOKEN
    ? `https://x-access-token:${GITHUB_TOKEN}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;
  await run("git", ["clone", authedUrl, destDir]);
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

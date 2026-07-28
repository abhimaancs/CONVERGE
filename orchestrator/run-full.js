import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent } from "./agent-core.js";
import { cloneRepo, createBranch, commitAndPush, openPullRequest, getDefaultBranch } from "./github.js";

function logTrace(label, detail) {
  console.log(`\n[${label}]`);
  if (detail) console.log(detail);
}

/**
 * Full pipeline: clone -> agent loop (read/write/run_tests in sandbox) -> push -> PR.
 * Only pushes/opens a PR if the agent loop actually got tests to pass —
 * a failed run just leaves the temp clone on disk for you to inspect.
 */
async function main() {
  const [, , repoSlugOrUrl, issue, issueNumberArg] = process.argv;
  if (!repoSlugOrUrl || !issue) {
    console.error('Usage: node run-full.js <owner/repo or repo URL> "<issue description>" [issueNumber]');
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "converge-"));
  logTrace("CLONE", `Cloning ${repoSlugOrUrl} into ${tmpDir}`);
  const { owner, repo } = await cloneRepo(repoSlugOrUrl, tmpDir);

  logTrace("AGENT", "Handing off to the agent loop...");
  const result = await runAgent({ repoRoot: tmpDir, issue, onEvent: (e) => logTrace(e.label, e.detail) });

  if (!result.success) {
    logTrace("STOPPING", `Agent did not reach a passing test run (${result.reason}). Repo left at ${tmpDir} for inspection. No branch pushed, no PR opened.`);
    process.exit(1);
  }

  const branchName = `converge/fix-${issueNumberArg || Date.now()}`;
  logTrace("BRANCH", `Creating branch ${branchName}`);
  await createBranch(tmpDir, branchName);

  logTrace("COMMIT+PUSH", "Committing agent's changes and pushing...");
  await commitAndPush(tmpDir, branchName, `Fix: ${issue.slice(0, 72)}`);

  const baseBranch = await getDefaultBranch(owner, repo);
  logTrace("PR", `Opening PR against ${baseBranch}...`);
  const pr = await openPullRequest({
    owner,
    repo,
    branchName,
    baseBranch,
    title: `Converge: ${issue.slice(0, 72)}`,
    body: `Automated fix by Converge (autonomous code-fixing agent).\n\n**Issue:**\n${issue}\n\n**Attempts to converge:** ${result.attempts}\n\nGenerated fully autonomously — review before merging.`,
  });

  logTrace("DONE", `PR opened: ${pr.url}`);
  console.log(`\n✅ ${pr.url}`);
}

main().catch((err) => {
  console.error("\n[FATAL]", err.message);
  process.exit(1);
});

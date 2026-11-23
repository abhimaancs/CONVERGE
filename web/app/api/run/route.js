import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent } from "../../../../orchestrator/agent-core.js";
import { assertCanPushToRepo, cloneRepo, commitAndPush, createBranch, openPullRequest, parseRepoSlug } from "../../../../orchestrator/github.js";
import { verifySessionToken } from "../../../lib/auth.js";
import { getGithubAccessToken } from "../../../lib/github-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ISSUE_LENGTH = 6_000;
const MAX_ACTIVE_RUNS = 2;
const RUN_WINDOW_MS = 60 * 60 * 1000;
const MAX_USER_RUNS_PER_WINDOW = 3;
const MAX_RUNS_PER_WINDOW = 10;
const activeUsers = new Set();
const userRunStarts = new Map();
const runStarts = [];
let activeRuns = 0;

function jsonError(message, status, headers = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), { status: 413 });
  }

  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("A JSON request body is required."), { status: 400 });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error("Request body is too large."), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw Object.assign(new Error("Request body must contain valid JSON."), { status: 400 });
  }
}

export async function POST(request) {
  const username = verifySessionToken(request.cookies.get("session")?.value);
  if (!username) return jsonError("Not signed in.", 401);

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonError(error.status ? error.message : "Could not read request body.", error.status || 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Request body must be a JSON object.", 400);
  }
  const { repoSlug, issue, openPr = false } = body;
  if (typeof repoSlug !== "string" || typeof issue !== "string") {
    return jsonError("repoSlug and issue must be strings.", 400);
  }
  if (issue.trim().length === 0 || issue.length > MAX_ISSUE_LENGTH) {
    return jsonError(`Issue description must be between 1 and ${MAX_ISSUE_LENGTH} characters.`, 400);
  }
  if (typeof openPr !== "boolean") return jsonError("openPr must be a boolean.", 400);

  let repository;
  try {
    repository = parseRepoSlug(repoSlug);
  } catch (error) {
    return jsonError(error.message, 400);
  }

  let githubToken = null;
  try {
    githubToken = await getGithubAccessToken(username);
  } catch (error) {
    if (openPr) return jsonError(error.message, 403);
  }
  if (openPr && !githubToken) {
    return jsonError("Connect GitHub before opening a pull request.", 403);
  }

  if (activeUsers.has(username)) return jsonError("You already have a run in progress.", 429);
  if (activeRuns >= MAX_ACTIVE_RUNS) return jsonError("The service is busy. Try again shortly.", 429);

  const now = Date.now();
  const windowStart = now - RUN_WINDOW_MS;
  const recentUserRuns = (userRunStarts.get(username) || []).filter((start) => start > windowStart);
  const recentRuns = runStarts.filter((start) => start > windowStart);
  userRunStarts.set(username, recentUserRuns);
  runStarts.splice(0, runStarts.length, ...recentRuns);
  if (recentUserRuns.length >= MAX_USER_RUNS_PER_WINDOW || recentRuns.length >= MAX_RUNS_PER_WINDOW) {
    const starts = recentUserRuns.length >= MAX_USER_RUNS_PER_WINDOW ? recentUserRuns : recentRuns;
    const retryAfter = Math.max(1, Math.ceil((starts[0] + RUN_WINDOW_MS - now) / 1000));
    return jsonError("Run limit reached. Try again later.", 429, { "Retry-After": String(retryAfter) });
  }

  recentUserRuns.push(now);
  runStarts.push(now);
  userRunStarts.set(username, recentUserRuns);
  activeUsers.add(username);
  activeRuns += 1;

  const encoder = new TextEncoder();
  let closed = false;
  let aborted = false;
  const send = (controller, event) => {
    if (closed || aborted) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      closed = true;
      aborted = true;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => send(controller, { type: "heartbeat" }), 8_000);
      let tmpDir;
      try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "converge-web-"));
        let baseBranch = null;
        if (openPr) {
          send(controller, { label: "ACCESS", detail: "Checking your GitHub write access..." });
          baseBranch = await assertCanPushToRepo(repository.owner, repository.repo, githubToken);
        }

        send(controller, { label: "CLONE", detail: `Cloning ${githubToken ? "repository" : "public repository"} ${repository.owner}/${repository.repo}` });
        // Web runs use only the current account's GitHub App token. Without a
        // connection, cloneRepo receives null and public repositories work unauthenticated.
        await cloneRepo(`${repository.owner}/${repository.repo}`, tmpDir, { token: githubToken });
        if (aborted) return;

        send(controller, { label: "AGENT", detail: "Handing off to the agent loop..." });
        const result = await runAgent({
          repoRoot: tmpDir,
          issue: issue.trim(),
          onEvent: (event) => send(controller, { label: event.label, detail: event.detail }),
        });

        if (aborted) return;
        if (!result.success) {
          send(controller, { label: "STOPPED", detail: `Agent did not reach a passing test run (${result.reason}).` });
          send(controller, { type: "result", success: false, reason: result.reason });
          return;
        }
        if (!openPr) {
          send(controller, { type: "result", success: true, attempts: result.attempts, prUrl: null });
          return;
        }

        const branchName = `converge/fix-${Date.now()}`;
        send(controller, { label: "BRANCH", detail: `Creating branch ${branchName}` });
        await createBranch(tmpDir, branchName);
        if (aborted) return;

        send(controller, { label: "COMMIT+PUSH", detail: "Committing the verified fix and pushing your branch..." });
        await commitAndPush(tmpDir, branchName, `Fix: ${issue.slice(0, 72)}`, {
          token: githubToken,
          owner: repository.owner,
          repo: repository.repo,
        });
        if (aborted) return;

        send(controller, { label: "PR", detail: `Opening pull request against ${baseBranch}...` });
        const pr = await openPullRequest({
          owner: repository.owner,
          repo: repository.repo,
          branchName,
          baseBranch,
          title: `Converge: ${issue.slice(0, 72)}`,
          body: `Automated fix by Converge.\n\n**Issue:**\n${issue}\n\n**Attempts:** ${result.attempts}\n\nPlease review this change before merging.`,
          token: githubToken,
        });
        send(controller, { label: "DONE", detail: `Pull request opened: ${pr.url}` });
        send(controller, { type: "result", success: true, attempts: result.attempts, prUrl: pr.url });
      } catch (error) {
        if (!aborted) {
          send(controller, { label: "FATAL", detail: error.message });
          send(controller, { type: "result", success: false, reason: error.message });
        }
      } finally {
        clearInterval(heartbeat);
        try {
          if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error("Could not remove temporary run directory:", cleanupError);
        } finally {
          activeUsers.delete(username);
          activeRuns -= 1;
        }
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* stream already closed */ }
        }
      }
    },
    cancel() {
      aborted = true;
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

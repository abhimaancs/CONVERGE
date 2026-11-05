import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent } from "../../../../orchestrator/agent-core.js";
import { cloneRepo, createBranch, commitAndPush, openPullRequest, getDefaultBranch } from "../../../../orchestrator/github.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST body: { repoSlug: "owner/repo", issue: "...", openPr: boolean }
 *
 * Streams Server-Sent Events as the agent runs: each event is one line of
 * the same trace you'd see in the CLI (`[PROVIDER]`, `[ATTEMPT 1/10]`,
 * `[TOOL CALL: read_file]`, etc.), plus a final `result` event with the
 * outcome (and PR URL, if openPr was true and the fix succeeded).
 *
 * Uses a real GitHub clone in a temp dir either way, so the sandboxed
 * run_tests behaves identically to the CLI — this route is a thin
 * translation layer over agent-core.js, not a separate implementation.
 */
export async function POST(request) {
  const { repoSlug, issue, openPr } = await request.json();

  if (!repoSlug || !issue) {
    return new Response(JSON.stringify({ error: "repoSlug and issue are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  // Stream cancellation is reported through the underlying source's cancel()
  // hook, which runs outside start(). Keep this flag in the shared scope so
  // a disconnected client cannot trigger a later branch push or pull request.
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Track close state ourselves rather than relying on the controller
      // to tell us — if the browser disconnects mid-run (which happens
      // easily here, since a Docker-backed run_tests call can genuinely
      // take a minute or more on a slow Docker Desktop setup), the runtime
      // can close the controller on its own. Calling controller.close() or
      // .enqueue() again afterward throws "Invalid state: Controller is
      // already closed" and crashes the whole request — this flag, plus
      // guarding every write, prevents that.
      let closed = false;

      const send = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the runtime — fine, that's what we're guarding against
        }
      };

      // run_tests can take well over a minute (Docker container startup +
      // pytest, especially slow on Windows/WSL2 Docker Desktop setups) with
      // zero events sent during that gap — long enough for some browsers or
      // dev-server proxies to treat the connection as idle and drop it.
      // A comment line (": ping") every few seconds keeps it visibly alive
      // without being parsed as a real event by the client.
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), 8_000);

      let tmpDir;
      try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "converge-web-"));
        send({ label: "CLONE", detail: `Cloning ${repoSlug} into a temp workspace` });
        const { owner, repo } = await cloneRepo(repoSlug, tmpDir);
        if (aborted) return;

        send({ label: "AGENT", detail: "Handing off to the agent loop..." });
        const result = await runAgent({
          repoRoot: tmpDir,
          issue,
          onEvent: (e) => send({ label: e.label, detail: e.detail }),
        });

        if (aborted) return; // client is gone, no point doing more work

        if (!result.success) {
          send({ label: "STOPPED", detail: `Agent did not reach a passing test run (${result.reason}).` });
          send({ type: "result", success: false, reason: result.reason });
          return;
        }

        if (!openPr) {
          send({ type: "result", success: true, attempts: result.attempts, prUrl: null });
          return;
        }

        const branchName = `converge/fix-${Date.now()}`;
        send({ label: "BRANCH", detail: `Creating branch ${branchName}` });
        await createBranch(tmpDir, branchName);

        send({ label: "COMMIT+PUSH", detail: "Committing agent's changes and pushing..." });
        await commitAndPush(tmpDir, branchName, `Fix: ${issue.slice(0, 72)}`);

        const baseBranch = await getDefaultBranch(owner, repo);
        if (aborted) return;
        send({ label: "PR", detail: `Opening PR against ${baseBranch}...` });
        const pr = await openPullRequest({
          owner,
          repo,
          branchName,
          baseBranch,
          title: `Converge: ${issue.slice(0, 72)}`,
          body: `Automated fix by Converge (autonomous code-fixing agent).\n\n**Issue:**\n${issue}\n\n**Attempts to converge:** ${result.attempts}\n\nGenerated fully autonomously — review before merging.`,
        });

        send({ label: "DONE", detail: `PR opened: ${pr.url}` });
        send({ type: "result", success: true, attempts: result.attempts, prUrl: pr.url });
      } catch (err) {
        send({ label: "FATAL", detail: err.message });
        send({ type: "result", success: false, reason: err.message });
      } finally {
        clearInterval(heartbeat);
        closeOnce();
      }
    },

    // Called by the runtime when the client disconnects (browser closed,
    // navigated away, or its own fetch gave up waiting). We can't cancel
    // the in-flight Gemini call or Docker run already underway, but this at
    // least lets the rest of the handler know not to bother sending more
    // events to a socket nobody's listening on.
    cancel() {
      aborted = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

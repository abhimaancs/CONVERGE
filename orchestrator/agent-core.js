import OpenAI from "openai";
import { makeTools, TOOL_DEFINITIONS } from "./tools.js";

const MAX_ATTEMPTS = 12; // leave room to add and verify a focused regression test

const BEHAVIORAL_ISSUE_PATTERN = /\b(?:bug|wrong|incorrect|expected|should|returns?|returning|persist(?:s|ed|ence)?|refresh(?:es|ed)?|reload(?:s|ed)?|save(?:s|d)?|restore(?:s|d)?|clear(?:s|ed|ing)?|vanish(?:es|ed)?|disappear(?:s|ed)?|los(?:e|es|t)|break(?:s|ing|en)?|cart|quantity|count|total|display|render|show|hide|calculate|validation|validate|crash(?:es|ed)?|regression|feature)\b/i;

export function requiresBehavioralTests(issue) {
  return BEHAVIORAL_ISSUE_PATTERN.test(issue || "");
}

// Two providers supported, both via the OpenAI SDK's OpenAI-compatible
// interface. Constructed lazily (inside getClient/getModel, called at the
// start of runAgent) rather than at module load time — some environments
// (Next.js's build-time route analysis, for one) import this file before
// env vars are necessarily set, and eagerly creating the client here would
// throw just from importing the module, before any request ever happens.
function usingGemini() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getModel() {
  return usingGemini()
    // "gemini-flash-latest" is an alias Google keeps pointed at their current
    // stable Flash model — using it instead of a hardcoded version (like
    // "gemini-2.5-flash", which stopped existing) means this won't silently
    // 404 again next time Google ships a new generation.
    ? process.env.GEMINI_MODEL || "gemini-flash-latest"
    : // Default uses OpenRouter's free auto-router: it picks a currently-available
      // free model that supports tool calling, instead of a hardcoded slug like
      // "qwen/qwen3-coder:free" — which is exactly what broke, since
      // OpenRouter's free-model lineup rotates without notice.
      // Once you've added credits, switch back to Claude either by setting the
      // env var (set OPENROUTER_MODEL=anthropic/claude-sonnet-4.5) or by
      // changing the fallback below.
      process.env.OPENROUTER_MODEL || "openrouter/free";
}

function getClient() {
  return usingGemini()
    ? new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      })
    : new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      });
}

const SYSTEM_PROMPT = `You are an autonomous code-fixing agent. You will be given a GitHub issue
or failing-test description for a repository you have access to via tools.

Your loop:
1. Call list_files once to see the whole repo tree (it's recursive — no need
   to call it more than once, or once per directory).
2. Use run_tests early to see which tests fail and why — the failure output
   usually tells you which file is responsible. A passing baseline check does
   not mean the requested fix is done; continue to implement the issue.
   When the issue targets a subproject, pass that directory as run_tests' path
   (for example, path "toy-repo" for toy-repo/calculator.py) so unrelated
   projects elsewhere in the repository don't block the fix.
   For npm projects, run_tests uses "npm test" when present, otherwise
   "npm run build". Treat a build result as a build check, not as a test suite.
   For behavior changes or bug fixes, add or update a focused regression test
   that would fail before the fix and pass after it. If no test command exists,
   add a small test using the project's existing tools or a native test runner
   and configure "npm test". A passing build alone cannot verify behavior.
3. Use read_file only on the specific file(s) that look relevant, not every file.
4. Use write_file to make a fix.
5. Use run_tests again to check whether your fix works.
6. If tests fail, read the error output carefully, form a new hypothesis, and try again.
7. Stop and summarize only after you have changed a file for the requested fix
   and a later run_tests reports passed: true. A passing check without any
   actual file changes is not a completed fix.

Rules:
- Make the smallest change that correctly fixes the issue. Don't rewrite unrelated code.
- Always call run_tests after write_file before declaring victory.
- For behavior changes, do not declare victory without a passing regression test.
- If you're stuck after a couple of failed attempts, reconsider your assumptions about
  the bug rather than repeating the same fix.
- Be decisive: once run_tests output plus reading the directly-relevant source file
  tells you the cause, move straight to write_file. Don't read unrelated files,
  passing tests, or modules the failure output didn't implicate — every extra call
  costs part of your limited attempt budget and API rate limit.`;

/**
 * Wraps the API call with retry/backoff for transient failures:
 *  - 408 and 5xx (temporary provider/server failures), including Gemini 503s
 *  - 429 (rate limit) — free tiers enforce fairly tight requests-per-minute caps
 *  - connection timeouts / dropped connections — free/shared endpoints under
 *    load occasionally hang or reset a request; these are worth one retry
 *    before giving up, since the request itself was fine
 * Genuine errors (bad auth, malformed request, model not found) are NOT
 * retried — waiting won't fix those, so they surface immediately.
 */
export function isRetryable(err) {
  if ([408, 429, 500, 502, 503, 504].includes(err?.status)) return true;
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.name === "APIConnectionTimeoutError" ||
    err?.name === "APIConnectionError" ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("socket")
  );
}

async function callModelWithRetry(client, params, onEvent, { maxRetries = 6, baseDelayMs = 10_000 } = {}) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      if (!isRetryable(err) || i === maxRetries) throw err;
      const isRateLimit = err?.status === 429;
      const isProviderUnavailable = err?.status >= 500;
      // Per-minute rate limits reset roughly every 60s, so it's worth waiting
      // closer to that regardless of retry count, capped so it doesn't spiral
      // (65s, 65s, 65s... vs connection issues, which back off more gently).
      const delay = isRateLimit ? 65_000 : baseDelayMs * (i + 1);
      const reason = isRateLimit
        ? "Rate limited (429)"
        : isProviderUnavailable
          ? `Provider temporarily unavailable (${err.status})`
          : `Connection issue (${err?.message || "unknown"})`;
      onEvent({ type: "retrying", label: "RETRYING", detail: `${reason} — backing off ${Math.round(delay / 1000)}s before retry ${i + 1}/${maxRetries}...` });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Runs the agent loop. onEvent(event) is called for every meaningful step —
 * { type, label, detail } — so callers (CLI stdout, a web SSE stream, tests,
 * whatever) can render the trace however they want without this file caring.
 * Defaults to a no-op so callers that don't need live progress can omit it.
 */
export async function runAgent({ repoRoot, issue, onEvent = () => {} }) {
  const client = getClient();
  const model = getModel();
  const gemini = usingGemini();

  onEvent({ type: "provider", label: "PROVIDER", detail: `Using ${gemini ? "Gemini" : "OpenRouter"} — model: ${model}` });
  const tools = makeTools(repoRoot);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Repo root is mounted and ready. Here is the issue to fix:\n\n${issue}` },
  ];
  const writtenFiles = new Map();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onEvent({ type: "attempt", label: `ATTEMPT ${attempt}/${MAX_ATTEMPTS}`, detail: `Calling ${gemini ? "Gemini" : "OpenRouter"}...` });

    const response = await callModelWithRetry(
      client,
      { model, max_tokens: 2048, tools: TOOL_DEFINITIONS, messages },
      onEvent
    );

    const message = response.choices[0].message;
    messages.push(message);

    if (message.content && message.content.trim()) {
      onEvent({ type: "model_says", label: "MODEL SAYS", detail: message.content.trim() });
    }

    const toolCalls = message.tool_calls || [];

    if (toolCalls.length === 0) {
      onEvent({ type: "done_no_tools", label: "DONE", detail: "No further tool calls — agent considers the task complete or has given up." });
      return { success: false, reason: "Model stopped without a successful verification.", messages };
    }

    let sawPassingRun = false;
    let changesAfterPassingRun = false;
    let passingVerification = null;

    for (const call of toolCalls) {
      const name = call.function.name;
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (e) {
        onEvent({ type: "arg_parse_error", label: "ARG PARSE ERROR", detail: `${name}: ${e.message}` });
      }

      onEvent({ type: "tool_call", label: `TOOL CALL: ${name}`, detail: JSON.stringify(args) });
      const result = await tools[name](args);
      onEvent({ type: "tool_result", label: `TOOL RESULT: ${name}`, detail: typeof result === "string" ? result : JSON.stringify(result).slice(0, 2000) });

      if (name === "write_file" && result?.ok && typeof result.path === "string") {
        const current = writtenFiles.get(result.path);
        writtenFiles.set(result.path, {
          before: current ? current.before : result.previousHash,
          after: result.contentHash,
        });
        if (result.changed) changesAfterPassingRun = true;
      }

      if (name === "run_tests") {
        sawPassingRun = Boolean(result.passed);
        if (result.passed) {
          changesAfterPassingRun = false;
          passingVerification = result.verification || "tests";
        } else {
          passingVerification = null;
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    if (sawPassingRun && !changesAfterPassingRun) {
      const hasActualChanges = [...writtenFiles.values()].some(({ before, after }) => before !== after);
      if (!hasActualChanges) {
        const detail = "The check passed, but no file changes were made. The requested fix is not complete yet.";
        onEvent({ type: "changes_needed", label: "CHANGE NEEDED", detail });
        messages.push({ role: "user", content: `${detail} Inspect the relevant source, implement the requested change with write_file, then run the check again.` });
        continue;
      }

      if (requiresBehavioralTests(issue) && passingVerification !== "tests") {
        const detail = "The build passed, but this behavior change needs a passing regression test before it can be marked fixed.";
        onEvent({ type: "tests_needed", label: "TEST NEEDED", detail });
        messages.push({ role: "user", content: `${detail} Add or update a focused test for the reported behavior, make the project test command run it, then run the tests again. Do not treat another build-only pass as verification.` });
        continue;
      }

      const checkLabel = passingVerification === "build" ? "Build" : "Tests";
      onEvent({ type: "success", label: "SUCCESS", detail: `${checkLabel} passed on attempt ${attempt}.` });
      return { success: true, attempts: attempt, messages };
    }
  }

  onEvent({ type: "failed", label: "FAILED", detail: `No successful verification after ${MAX_ATTEMPTS} attempts.` });
  return { success: false, reason: `Exceeded max attempts (${MAX_ATTEMPTS})`, messages };
}

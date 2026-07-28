import OpenAI from "openai";
import { makeTools, TOOL_DEFINITIONS } from "./tools.js";

const MAX_ATTEMPTS = 10; // was 6 — too tight for repos needing real exploration before a fix

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
   usually tells you which file is responsible.
3. Use read_file only on the specific file(s) that look relevant, not every file.
4. Use write_file to make a fix.
5. Use run_tests again to check whether your fix works.
6. If tests fail, read the error output carefully, form a new hypothesis, and try again.
7. Once run_tests reports passed: true, stop and summarize the fix in plain text (no more tool calls).

Rules:
- Make the smallest change that correctly fixes the issue. Don't rewrite unrelated code.
- Always call run_tests after write_file before declaring victory.
- If you're stuck after a couple of failed attempts, reconsider your assumptions about
  the bug rather than repeating the same fix.
- Be decisive: once run_tests output plus reading the directly-relevant source file
  tells you the cause, move straight to write_file. Don't read unrelated files,
  passing tests, or modules the failure output didn't implicate — every extra call
  costs part of your limited attempt budget and API rate limit.`;

/**
 * Wraps the API call with retry/backoff for transient failures:
 *  - 429 (rate limit) — free tiers enforce fairly tight requests-per-minute caps
 *  - connection timeouts / dropped connections — free/shared endpoints under
 *    load occasionally hang or reset a request; these are worth one retry
 *    before giving up, since the request itself was fine
 * Genuine errors (bad auth, malformed request, model not found) are NOT
 * retried — waiting won't fix those, so they surface immediately.
 */
function isRetryable(err) {
  if (err?.status === 429) return true;
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
      // Per-minute rate limits reset roughly every 60s, so it's worth waiting
      // closer to that regardless of retry count, capped so it doesn't spiral
      // (65s, 65s, 65s... vs connection issues, which back off more gently).
      const delay = isRateLimit ? 65_000 : baseDelayMs * (i + 1);
      const reason = isRateLimit ? "Rate limited (429)" : `Connection issue (${err?.message || "unknown"})`;
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
      return { success: false, reason: "Model stopped without a passing test run.", messages };
    }

    let sawPassingRun = false;

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

      if (name === "run_tests" && result.passed) {
        sawPassingRun = true;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    if (sawPassingRun) {
      onEvent({ type: "success", label: "SUCCESS", detail: `Tests passed on attempt ${attempt}.` });
      return { success: true, attempts: attempt, messages };
    }
  }

  onEvent({ type: "failed", label: "FAILED", detail: `No passing test run after ${MAX_ATTEMPTS} attempts.` });
  return { success: false, reason: `Exceeded max attempts (${MAX_ATTEMPTS})`, messages };
}

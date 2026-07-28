# Converge — Engineering Journal

This documents the actual build process: what broke, why, and how it was
fixed. Kept deliberately concrete (real errors, real fixes) so it's useful
both as a debugging reference and as interview material — "I built an agent"
is a weak story; "here's what actually went wrong and how I reasoned through
it" is a strong one.

## Architecture decisions (and why)

**Docker sandbox for test execution, but not for file read/write.**
The repo checkout is trusted (it's just text); what needs isolation is
*running* code — arbitrary imports, loops, syscalls. So `read_file`/
`write_file` operate directly on the host filesystem (fast, simple), while
only `run_tests` goes through a locked-down container: `--network none`
(nothing it runs can exfiltrate data or phone home), memory/CPU/pid caps
(a bad fix that forks or infinite-loops can't take down the host), and a
hard 30s timeout (a hung test can't block the agent loop forever).

**Shared agent loop, decoupled from output.**
`agent-core.js` emits structured events (`{ type, label, detail }`) via an
`onEvent` callback instead of hardcoding `console.log`. The CLI (`index.js`)
just prints them; the web route streams them as Server-Sent Events. One
implementation, two front ends — avoided duplicating the actual hard logic
(the retry loop, tool dispatch, provider handling) between them.

**Provider-agnostic via the OpenAI-compatible API shape.**
Anthropic, OpenRouter, and Gemini all support (or can be reached through) an
OpenAI-compatible chat-completions interface, so switching providers is a
`baseURL`/`apiKey` change, not a rewrite. This mattered a lot in practice —
see the free-tier section below.

## Bugs found and fixed, in the order they actually happened

### 1. Windows path comparison silently no-oped the CLI
**Symptom:** `node index.js ...` produced zero output and returned
immediately — no error, no trace, nothing.
**Cause:** The "was this file run directly from the CLI" check compared
`import.meta.url` (a `file://` URL, forward slashes, percent-encoded spaces)
against `` `file://${process.argv[1]}` `` (a raw OS path, backslashes on
Windows). These never match on Windows, especially with spaces in the path
(a username like "First Last" guarantees it). The script's entire CLI block
just never ran.
**Fix:** Use `pathToFileURL(process.argv[1]).href` for a real cross-platform
comparison.
**Lesson:** silent no-ops are worse than crashes — this cost real debugging
time precisely because there was no error to search for.

### 2. `list_files` wasn't recursive — burned the attempt budget on navigation
**Symptom:** Given a multi-file repo with a deliberately vague issue, the
agent used 4 of 6 attempts just walking the directory tree one level at a
time (`list_files` root → `src` → `src/stringutils` → `tests`), then ran out
of attempts before ever reading the actual broken file.
**Fix:** Made `list_files` walk the whole tree recursively in one call, and
raised the attempt cap from 6 to 10. Also tightened the system prompt to
explicitly discourage over-exploration once the cause is found.
**Lesson:** designed a harder second fixture (`toy-repo-2`, multi-file,
issue text that doesn't name the file) specifically to surface this — the
first toy repo was too easy to expose a real scaling problem.

### 3. Free-model tool calls emitted double-escaped content
**Symptom:** A free routed model (via OpenRouter) correctly diagnosed the
bug and wrote the *right fix logic*, but the file it wrote was one giant
broken line — it emitted literal `\n` (backslash + n as text) instead of
real newline characters inside the JSON tool-call arguments.
**Fix:** Added validation in `write_file`: if content has no real newlines
but does contain literal `\n` text, reject it immediately with an
actionable error instead of letting it surface later as a confusing Python
`SyntaxError` from `run_tests`.
**Lesson:** weaker/free models have real, specific failure modes in tool
calling (not just "worse answers") — defensive input validation on tool
arguments is worth having regardless of which model you use.

### 4. Free-tier model names rotate without notice
**Symptom:** `qwen/qwen3-coder:free` worked, then 404'd mid-project with
"this model is now paid, use this slug instead." Later, `gemini-2.5-flash`
404'd because Google had moved on to newer model generations.
**Fix:** Where possible, use auto-updating aliases instead of hardcoded
version strings — `openrouter/free` (OpenRouter's own free-model
auto-router) and `gemini-flash-latest` (Google's alias for their current
stable Flash model) — so a provider's naming churn doesn't silently break
the pipeline again.
**Lesson:** free-tier model catalogs are not stable dependencies. Pin to
aliases, not specific version strings, when the provider offers one.

### 5. Rate limits and connection drops crashed the whole run
**Symptom:** A 429 (rate limit) or a dropped connection during a Gemini
call crashed the entire process with an unhandled exception — one
transient hiccup killed a run that had already made real progress.
**Fix:** Added `callModelWithRetry` with backoff — 429s get longer, more
patient retries (rate limits are usually per-minute and self-resolve
within about a minute), while connection errors get shorter exponential
backoff. Genuine errors (bad auth, malformed request) are not retried,
since waiting won't fix those.
**Lesson:** distinguish retryable failures (rate limits, transient network
issues) from real ones (auth, bad input) — retrying the latter just wastes
time and hides the actual problem.

### 6. The web UI crashed on `Controller is already closed`
**Symptom:** A slow `run_tests` call (Docker startup + pytest can take well
over a minute on Windows/WSL2 Docker Desktop) meant the browser's fetch
gave up and disconnected before the server was done. The server then tried
to write to / close an already-abandoned stream and crashed with
`Invalid state: Controller is already closed`.
**Fix:** Tracked stream state explicitly with a `closed` flag; guarded
every `enqueue`/`close` call against it; added a heartbeat event every 8s
so the connection doesn't look idle during long silent gaps (like Docker
spinning up).
**Lesson:** streaming responses have a lifecycle that doesn't automatically
match your code's control flow — the consumer can disappear at any point,
and every write needs to defend against that.

## What each bug says about the underlying skill being demonstrated

- Bugs 1 and 6 are **environment/platform reasoning** (Windows path
  semantics, stream lifecycle management) — not AI-specific at all, just
  solid engineering.
- Bugs 2 and 3 are about **designing tools and prompts for a model to use
  reliably**, and noticing when the harness itself (not the model) is the
  bottleneck.
- Bugs 4 and 5 are about **treating external APIs as unreliable
  dependencies** — provider churn and rate limits are real production
  concerns, not edge cases.

That range — systems/platform issues, agent-harness design, and
production-reliability handling — is deliberately the story this project
was built to tell.

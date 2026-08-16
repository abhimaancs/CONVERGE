# Converge — Autonomous Code-Fixing Agent

You give it a GitHub repo and an issue (or failing test). It reads the
codebase, writes a fix, runs the test suite in a sandboxed Docker container,
retries until tests pass, and opens a pull request automatically — no human
in the loop until review time.

This isn't a "call an LLM, show the answer" wrapper. It's a closed
**plan → act → observe → retry** loop: the agent reads code, proposes a fix,
executes it in an isolated sandbox, checks its own work against the real
test suite, and iterates on failure — the same pattern behind Cursor's
agent mode, Devin, and Claude Code.

**[See ENGINEERING_JOURNAL.md for the real build story →](./ENGINEERING_JOURNAL.md)**
Every bug hit along the way — Windows path bugs, a free-tier model
double-escaping newlines in tool calls, provider rate limits, a stream
lifecycle crash — with root cause and fix for each. That's the more
interesting read if you want the "why," not just "how to run it."

## What a real run looks like

Abridged trace from an actual successful run against a live GitHub repo
(full pipeline: clone → diagnose → fix → verify → branch → push → PR):

```
[TOOL CALL: run_tests]
{"passed":false,"output":"...AssertionError: assert 3 == 3.5..."}

[TOOL CALL: read_file] {"path":"calculator.py"}
[TOOL CALL: write_file] {"path":"calculator.py", "content":"...return a / b..."}

[TOOL CALL: run_tests]
{"passed":true,"output":"3 passed in 0.23s"}

[SUCCESS] Tests passed on attempt 5.
[PR] https://github.com/abhimaancs/converge-test-repo/pull/1
```

## Architecture

```
 Web UI (Next.js)  ──┐
                      ├──▶  agent-core.js  ──▶  Docker sandbox (run_tests)
 CLI (Node.js)     ──┘         │                  network-isolated,
                                │                  resource-capped,
                                ▼                  30s timeout
                         GitHub API
                    (clone / branch / PR)
```

One agent loop (`agent-core.js`), two front ends. The CLI prints its events
to stdout; the web UI streams the same events to a browser over
Server-Sent Events. Neither duplicates the actual logic — retry handling,
tool dispatch, provider selection all live in one place.

## Engineering highlights

- **Sandboxed execution, not just prompting.** File reads/writes happen on
  the host (trusted — it's just text); only *running* code goes through a
  Docker container with `--network none`, memory/CPU/pid caps, and a hard
  timeout — because that's the actual point where an LLM-authored "fix"
  could do real damage.
- **Provider-agnostic via the OpenAI-compatible API shape.** Works against
  Anthropic (via OpenRouter), OpenRouter's free-model router, or Gemini's
  OpenAI-compatible endpoint — a `baseURL`/`apiKey` swap, not a rewrite.
- **Retry logic that distinguishes failure types.** Rate limits (429) get
  patient backoff (~65s, since per-minute quotas reset on that cadence);
  connection drops get short exponential backoff; genuine errors (bad auth,
  malformed request) are not retried, since waiting won't fix those.
- **Defensive tool-call validation.** `write_file` rejects content that
  looks double-escaped (literal `\n` text instead of real newlines) — a
  real failure mode observed with a free-tier model — before it can corrupt
  a file and surface as a confusing downstream syntax error.

## Tech stack

Node.js, Next.js (App Router, Server-Sent Events), Docker, GitHub REST API
(via Octokit), LLM tool-calling (OpenAI-compatible function-calling schema)
against Claude / OpenRouter / Gemini.

---

## What's here

```
toy-repo/            a small Python package with one intentional bug
toy-repo-2/          multi-file fixture with a vague issue (tests navigation)
sandbox/Dockerfile    the isolated container image tests run inside
orchestrator/
  agent-core.js        the shared agent loop (tools, retry, event emission)
  index.js              thin CLI wrapper over agent-core.js
  tools.js               read_file/write_file/list_files/run_tests + schemas
  docker-sandbox.js        spins up the sandbox container per test run
  github.js                 clone / branch / commit+push / open PR helpers
  run-full.js                full CLI pipeline: clone -> agent loop -> push -> PR
web/                  Next.js UI — same agent-core.js, streamed to a browser
  app/page.js            form + live trace panel
  app/api/run/route.js    streams agent-core.js events as Server-Sent Events
```

## Setup

1. Install Docker Desktop (or Docker Engine) if you don't have it.
2. Build the sandbox image once:
   ```
   cd sandbox
   docker build -t converge-sandbox .
   ```
3. Install orchestrator deps:
   ```
   cd orchestrator
   npm install
   ```
4. Set an API key for one of the two supported providers:

   **Gemini** (has a genuine free tier, no card required):
   ```
   export GEMINI_API_KEY=your-gemini-key
   ```
   Model defaults to `gemini-flash-latest` (an alias Google keeps pointed
   at their current stable Flash model). Override with `GEMINI_MODEL` if needed.

   **OpenRouter** (only used if `GEMINI_API_KEY` isn't set):
   ```
   export OPENROUTER_API_KEY=sk-or-...
   ```
   Defaults to `openrouter/free` (an auto-router that picks a currently
   available free tool-calling model). For Claude specifically, once you've
   added credits:
   ```
   export OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
   ```

## Run it (local repo, no GitHub)

```
cd orchestrator
node index.js ../toy-repo "The divide() function in calculator.py is returning \
the wrong value for non-exact division — e.g. divide(7, 2) should be 3.5 but \
returns 3. The full test suite is in test_calculator.py."
```

## Harder test: multi-file repo, vague issue

`toy-repo` is single-file, so the agent never has to search for the bug —
it's a weak test of navigation. `toy-repo-2` is a small multi-module package
(`src/stringutils/`) with tests across two files, only one of which is
actually broken. The issue below deliberately does *not* name the file, so
this exercises `list_files`/`read_file` for real:

```
cd orchestrator
node index.js ../toy-repo-2 "Some string formatting is producing hyphen-less \
output when it shouldn't. Run the test suite to see which tests are failing \
and figure out which function is responsible."
```

If it goes straight to `formatting.py` without wasting several turns poking
at unrelated files, that's a good sign the context/navigation strategy holds
up. If it burns most of its retry budget just finding the file, that's a
concrete signal you need real search (embeddings, or at least a grep-based
relevance tool) before pointing this at anything bigger.

## Run it end-to-end (clone real repo → fix → push → open PR)

```
export GITHUB_TOKEN=ghp_...   # needs repo scope (or fine-grained: contents + pull-requests write)
cd orchestrator
node run-full.js owner/some-small-repo "Description of the failing test or issue" [issueNumber]
```

This clones the repo to a temp dir, runs the same agent loop, and — only if
`run_tests` actually reports a pass — creates a branch, commits, pushes, and
opens a PR via the GitHub API. If the agent doesn't converge, nothing gets
pushed; the temp clone is left on disk (path is printed) so you can inspect
what it tried.

`GITHUB_TOKEN` needs a token with `repo` scope (classic) or `contents:write` +
`pull_requests:write` (fine-grained), scoped to whatever repo you're testing
against — don't hand it a token with broader access than that.

Either way, you'll see printed live to the terminal:
- The model calling `list_files` / `read_file` to look around
- The model calling `write_file` with its proposed fix
- The model calling `run_tests` — which spins up a fresh, network-isolated,
  resource-capped container, runs pytest inside it, and returns the result
- If it fails, the error output gets fed back and it tries again (capped at 10 attempts)
- On success: which attempt it took (and, for `run-full.js`, the PR URL)

## Web UI (live trace, streamed to the browser)

```
cd web
npm install
```

Set the same env vars as before, in the same terminal you'll run `npm run dev` from:
```
set GEMINI_API_KEY=your-gemini-key
set GITHUB_TOKEN=ghp_...          # only needed if you'll check "open a PR"
```

Then:
```
npm run dev
```
Open http://localhost:3000. Enter a repo (`owner/repo`) and an issue description,
optionally check "open a PR", and hit Run — you'll see the same live trace
as the CLI (`[PROVIDER]`, `[ATTEMPT 1/10]`, `[TOOL CALL: ...]`, etc.) streamed
into the browser as it happens, ending in a success/failure banner (with a
PR link if one was opened).

Note: `web/` isn't a standalone app — its API route imports directly from
`../orchestrator/agent-core.js`, `tools.js`, `docker-sandbox.js`, and
`github.js`, so `orchestrator/node_modules` needs to exist too (run
`npm install` there if you haven't). This was a deliberate choice to avoid
duplicating the agent loop between the CLI and the web UI — one core,
two front ends.

## Why the sandbox is a real container and not just a subprocess

The repo folder is the only thing bind-mounted in, and it's the only writable
path. The container has `--network none` (nothing it runs can reach the
internet or your LAN), memory/CPU/pid caps (a bad fix that forks or infinite-loops
can't take down your machine), and gets killed outright after 30s. Read/write
of files happens on the host directly — only *executing* untrusted code goes
through the sandbox, since that's the actual risk surface.

## Known rough edges (expected at this stage)

- Only Python/pytest is supported — no language/test-runner detection yet
- `write_file` fully overwrites a file rather than diffing/patching, which is
  fine for small fixes but will get expensive on large files
- No file-search/embedding — the agent relies on `list_files` + `read_file`,
  which won't scale to large repos before hitting context limits
- PRs are opened with no review/approval gate — treat every PR as needing
  human review, not as ready-to-merge
- Temp clone directories (both CLI's `run-full.js` and the web route) are
  never cleaned up automatically — they'll accumulate in your OS temp folder
  over repeated runs; clean them out manually occasionally
- The web UI has no auth and no concurrency control — one run at a time,
  local use only; don't deploy this publicly as-is

## Next steps (not yet built)

1. Test against more real repos with actual GitHub issues, not just planted bugs
2. Add basic file-search (embeddings or even just grep-based relevance
   ranking) so it scales past tiny repos
3. Add auth + per-user isolation to the web UI if you ever want to share it
   beyond your own machine

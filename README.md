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

[SUCCESS] Checks passed on attempt 5.
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
  app/page.js            landing page ("/")
  app/login/page.js       sign-in form
  app/signup/page.js       create-account form
  app/app/page.js            auth-gated: redirects to /login if no valid session
  app/app/ConvergeApp.js       the actual tool (form + live trace panel)
  app/api/auth/                signup / login / logout route handlers
  app/api/run/route.js          streams agent-core.js events as SSE; requires a valid session
  lib/auth.js                    HMAC-signed session tokens
  lib/users.js                    bcrypt-hashed user store (local JSON file, gitignored)
```

## Setup

1. Install Docker Desktop (or Docker Engine) if you don't have it.
2. Build the sandbox image once:
   ```
   cd sandbox
   docker build -t converge-sandbox .
   ```
   Rebuild this image after updating Converge so it includes Node.js and the
   Python test tools used by the current runner.
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
- The model calling `run_tests` — which runs Python `pytest`, or for npm
  projects runs `npm test` (falling back to `npm run build`) in a resource-
  capped container, then returns the result
- If it fails, the error output gets fed back and it tries again (capped at 10 attempts)
- On success: which attempt it took (and, for `run-full.js`, the PR URL)

## Web UI (landing page, login/signup, live trace streamed to the browser)

```
cd web
npm install
```

Set env vars in the same terminal you'll run `npm run dev` from:
```
set GEMINI_API_KEY=your-gemini-key
set GITHUB_TOKEN=ghp_...          # optional; used by the CLI PR workflow only
set SESSION_SECRET=any-long-random-string
set GITHUB_APP_CLIENT_ID=your-github-app-client-id
set GITHUB_APP_CLIENT_SECRET=your-github-app-client-secret
set GITHUB_APP_CALLBACK_URL=http://localhost:3000/api/github/callback
```
`SESSION_SECRET` is what signs session cookies — pick any long random string
(it doesn't need to be memorable, just not guessable). Without it the server
throws on the first login/signup attempt, on purpose, rather than silently
issuing forgeable sessions. It also encrypts GitHub user tokens in the local
user store, so changing it requires users to reconnect their GitHub accounts.

To enable per-user repository access, create a **GitHub App** and set its
callback URL to the value above (use your deployed HTTPS URL in production).
Give it only **Contents: read and write** and **Pull requests: read and
write** repository permissions, enable expiring user access tokens, and
install it only on repositories users want Converge to access. Copy its
client ID and client secret into the server environment; never expose the
secret in browser code or commit it. Converge
uses GitHub App user access tokens, refreshes expiring tokens, encrypts them
at rest, and revokes them when a user disconnects. GitHub recommends GitHub
Apps for fine-grained access; its user tokens are limited by both the app's
permissions and each user's access. See [GitHub App authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
and [GitHub App security practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app).

Then:
```
npm run dev
```
Open http://localhost:3000 — you'll land on a marketing-style landing page.
**Sign up** (creates an account — bcrypt-hashed password, stored in
`web/data/users.json`, which is gitignored) or **sign in**, which takes you
to `/app`: the actual tool, now behind a real session check (both the page
*and* the `/api/run` endpoint itself reject unauthenticated requests — not
just the page).

At `/app`, enter a public repo (`owner/repo`) and an issue description, then
hit Run — you'll see the same live trace as the CLI (`[PROVIDER]`,
`[ATTEMPT 1/10]`, `[TOOL CALL: ...]`, etc.) streamed into the browser. Web
runs do not use the deployment's GitHub token to clone repositories.
Users can connect their GitHub account from the dashboard. Connected users
can access repositories selected when installing the GitHub App, and may ask
Converge to open a pull request when they have write access. Web runs never
use the deployment's `GITHUB_TOKEN`; the CLI's `run-full.js` continues to use
that optional token.

Note: `web/` isn't a standalone app — its API route imports directly from
`../orchestrator/agent-core.js`, `tools.js`, `docker-sandbox.js`, and
`github.js`, so `orchestrator/node_modules` needs to exist too (run
`npm install` there if you haven't). This was a deliberate choice to avoid
duplicating the agent loop between the CLI and the web UI — one core,
two front ends.

## Why the sandbox is a real container and not just a subprocess

The checkout is bind-mounted for checks, while `.git` is mounted read-only
so untrusted test code cannot rewrite remotes or Git hooks before a host-side
push. Python tests and npm test/build commands run with `--network none`.
For npm projects, dependencies are first installed from `package-lock.json`
in a temporary, resource-capped container; npm lifecycle scripts are disabled
during installation, and the actual check runs offline. Node projects need an
npm lockfile. The containers have read-only root filesystems, resource caps,
and hard timeouts. Agent file edits happen on the host; only *executing*
repository code goes through the sandbox.

## Known rough edges (expected at this stage)

- Python/pytest and npm projects are supported. npm projects use `npm test`
  when available, otherwise `npm run build`; they need `package-lock.json`.
  Other JavaScript package managers and other languages are not detected yet.
- `write_file` fully overwrites a file rather than diffing/patching, which is
  fine for small fixes but will get expensive on large files
- No file-search/embedding — the agent relies on `list_files` + `read_file`,
  which won't scale to large repos before hitting context limits
- Web GitHub authorization needs a configured GitHub App and each user must
  install/authorize it for the repositories they want to use
- The CLI's `run-full.js` temp clone is left on disk so you can inspect it;
  web run directories are removed automatically after each run
- The web UI's auth is real (bcrypt, HMAC-signed sessions, `/api/run`
  itself checks the session) but is intentionally minimal — no password
  reset, no rate limiting on login attempts, no email verification, and
  the user store is a single JSON file, not a real database. Fine for a
  personal/portfolio deployment; wouldn't scale to real multi-user traffic.
- The web app allows one run per account and caps each server process at two
  active runs, three runs per account per hour, and ten total runs per hour.
  These in-memory limits are intended for a single instance, not a
  multi-instance public deployment

## Next steps (not yet built)

1. Test against more real repos with actual GitHub issues, not just planted bugs
2. Add basic file-search (embeddings or even just grep-based relevance
   ranking) so it scales past tiny repos
3. Replace the local JSON user store and per-process run limits with a shared
   database and job queue before running multiple web instances

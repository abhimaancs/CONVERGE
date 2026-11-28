import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRepoSlug } from "../github.js";
import { makeTools } from "../tools.js";
import { isRetryable, requiresBehavioralTests } from "../agent-core.js";
import { detectProjectCheck, isPackageLockOutOfSync, resolveTestDirectory } from "../docker-sandbox.js";
import { createGithubAuthorizationFlow, verifyGithubAuthorizationFlow } from "../../web/lib/github-auth.js";

test("model retries transient provider errors such as Gemini 503", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryable({ status }), true, `status ${status} should be retried`);
  }
  for (const status of [400, 401, 404]) {
    assert.equal(isRetryable({ status }), false, `status ${status} should fail immediately`);
  }
});

test("behavioral bug reports require a regression test, not only a build", () => {
  assert.equal(
    requiresBehavioralTests("The shopping cart clears when the page is refreshed. Save and restore it."),
    true
  );
  assert.equal(
    requiresBehavioralTests("Fix divide so divide(7, 2) returns 3.5 instead of 3."),
    true
  );
  assert.equal(requiresBehavioralTests("Update the production build configuration."), false);
});

test("test directory stays inside the repository and resolves subprojects", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "converge-test-path-"));
  const projectRoot = path.join(tempRoot, "toy-repo");
  fs.mkdirSync(projectRoot);
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  assert.equal(resolveTestDirectory(tempRoot, "toy-repo"), "toy-repo");
  assert.equal(resolveTestDirectory(tempRoot), ".");
  assert.throws(() => resolveTestDirectory(tempRoot, "../outside"), /stay inside/);
});

test("project checks select pytest or the locked npm test/build command", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "converge-project-check-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const pythonProject = path.join(tempRoot, "python");
  const npmTestProject = path.join(tempRoot, "npm-test");
  const npmBuildProject = path.join(tempRoot, "npm-build");
  for (const directory of [pythonProject, npmTestProject, npmBuildProject]) fs.mkdirSync(directory);

  assert.deepEqual(detectProjectCheck(pythonProject), {
    kind: "pytest",
    command: ["pytest", "-q"],
    verification: "tests",
  });

  fs.writeFileSync(path.join(npmTestProject, "package.json"), JSON.stringify({ scripts: { test: "vitest run", build: "vite build" } }));
  fs.writeFileSync(path.join(npmTestProject, "package-lock.json"), "{}");
  assert.deepEqual(detectProjectCheck(npmTestProject), {
    kind: "npm-test",
    command: ["npm", "run", "test"],
    verification: "tests",
  });

  fs.writeFileSync(path.join(npmBuildProject, "package.json"), JSON.stringify({ scripts: { build: "next build" } }));
  fs.writeFileSync(path.join(npmBuildProject, "package-lock.json"), "{}");
  assert.deepEqual(detectProjectCheck(npmBuildProject), {
    kind: "npm-build",
    command: ["npm", "run", "build"],
    verification: "build",
  });
});

test("npm checks require a lockfile and valid package metadata", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "converge-project-check-error-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
  assert.equal(detectProjectCheck(tempRoot).kind, "error");

  fs.writeFileSync(path.join(tempRoot, "package.json"), "{");
  assert.equal(detectProjectCheck(tempRoot).kind, "error");
});

test("npm lockfile mismatches are recognized for safe regeneration", () => {
  assert.equal(
    isPackageLockOutOfSync("npm ci can only install packages when your package.json and package-lock.json are in sync."),
    true
  );
  assert.equal(isPackageLockOutOfSync("npm registry is temporarily unavailable"), false);
});

test("parseRepoSlug accepts canonical GitHub slugs and HTTPS URLs", () => {
  assert.deepEqual(parseRepoSlug("abhimaancs/CONVERGE"), {
    owner: "abhimaancs",
    repo: "CONVERGE",
  });
  assert.deepEqual(parseRepoSlug("https://github.com/abhimaancs/CONVERGE.git"), {
    owner: "abhimaancs",
    repo: "CONVERGE",
  });
});

test("parseRepoSlug rejects non-GitHub URLs and path traversal", () => {
  for (const value of [
    "https://example.com/owner/repo",
    "https://github.com/owner/repo/issues/1",
    "owner/../outside",
    "owner/..",
    "owner/repo?redirect=example.com",
    "x".repeat(301),
  ]) {
    assert.throws(() => parseRepoSlug(value), value);
  }
});

test("GitHub authorization flow binds state to the signed-in account and PKCE verifier", () => {
  const previous = {
    secret: process.env.SESSION_SECRET,
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_APP_CALLBACK_URL,
  };
  process.env.SESSION_SECRET = "test-session-secret-with-enough-entropy";
  process.env.GITHUB_APP_CLIENT_ID = "test-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
  process.env.GITHUB_APP_CALLBACK_URL = "http://localhost:3000/api/github/callback";

  try {
    const flow = createGithubAuthorizationFlow("test-user");
    const authorizeUrl = new URL(flow.authorizeUrl);
    const state = authorizeUrl.searchParams.get("state");
    const verified = verifyGithubAuthorizationFlow(flow.signedCookie, state);

    assert.equal(verified.username, "test-user");
    assert.ok(verified.verifier);
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizeUrl.searchParams.get("scope"), "offline_access");
    assert.equal(verifyGithubAuthorizationFlow(flow.signedCookie, "attacker-state"), null);
    assert.equal(verifyGithubAuthorizationFlow(`${flow.signedCookie}tampered`, state), null);
  } finally {
    for (const [key, value] of Object.entries({
      SESSION_SECRET: previous.secret,
      GITHUB_APP_CLIENT_ID: previous.clientId,
      GITHUB_APP_CLIENT_SECRET: previous.clientSecret,
      GITHUB_APP_CALLBACK_URL: previous.callbackUrl,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("repository tools allow in-root files and reject escaping paths and symlinks", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "converge-security-test-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outsideRoot = path.join(tempRoot, "outside");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(outsideRoot);
  fs.mkdirSync(path.join(repoRoot, ".git"));
  fs.writeFileSync(path.join(repoRoot, ".git", "config"), "[remote \"origin\"]\n");
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside data");
  t.after(() => {
    const linkPath = path.join(repoRoot, "outside-link");
    if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  fs.symlinkSync(outsideRoot, path.join(repoRoot, "outside-link"), process.platform === "win32" ? "junction" : "dir");
  const tools = makeTools(repoRoot);

  assert.deepEqual(tools.write_file({ path: "src/fix.py", content: "print('ok')\n" }), {
    ok: true,
    path: "src/fix.py",
  });
  assert.equal(tools.read_file({ path: "src/fix.py" }).content, "print('ok')\n");
  assert.throws(() => tools.read_file({ path: "outside-link/secret.txt" }), /escapes repo root/);
  assert.throws(() => tools.write_file({ path: "outside-link/new.txt", content: "bad" }), /escapes repo root/);
  assert.throws(() => tools.write_file({ path: "../outside/new.txt", content: "bad" }), /escapes repo root/);
  assert.throws(() => tools.read_file({ path: ".git/config" }), /Git metadata is protected/);
  assert.throws(() => tools.write_file({ path: ".git/config", content: "malicious" }), /Git metadata is protected/);
  assert.equal(fs.existsSync(path.join(outsideRoot, "new.txt")), false);
});

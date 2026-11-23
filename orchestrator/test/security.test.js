import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRepoSlug } from "../github.js";
import { makeTools } from "../tools.js";
import { createGithubAuthorizationFlow, verifyGithubAuthorizationFlow } from "../../web/lib/github-auth.js";

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

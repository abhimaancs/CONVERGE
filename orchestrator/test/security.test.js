import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRepoSlug } from "../github.js";
import { makeTools } from "../tools.js";

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

test("repository tools allow in-root files and reject escaping paths and symlinks", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "converge-security-test-"));
  const repoRoot = path.join(tempRoot, "repo");
  const outsideRoot = path.join(tempRoot, "outside");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(outsideRoot);
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
  assert.equal(fs.existsSync(path.join(outsideRoot, "new.txt")), false);
});

import { pathToFileURL } from "node:url";
import { runAgent } from "./agent-core.js";

export { runAgent };

function printEvent({ label, detail }) {
  console.log(`\n[${label}]`);
  if (detail) console.log(detail);
}

// CLI entry point: node index.js <repoPath> "<issue text>"
// process.argv[1] is a plain OS path (backslashes on Windows); import.meta.url
// is always a file:// URL with forward slashes and percent-encoded characters
// (spaces, etc). Comparing them as raw strings — the old `file://${argv[1]}`
// approach — silently fails on Windows (especially with spaces in the path,
// e.g. usernames like "First Last"), so the script does nothing with no
// error at all. pathToFileURL() normalizes argv[1] the same way so the
// comparison actually works cross-platform.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , repoRoot, issue] = process.argv;
  if (!repoRoot || !issue) {
    console.error('Usage: node index.js <repoPath> "<issue description>"');
    process.exit(1);
  }
  const result = await runAgent({ repoRoot, issue, onEvent: printEvent });
  console.log("\n=== RESULT ===");
  console.log(result.success ? `✅ Fixed in ${result.attempts} attempt(s)` : `❌ ${result.reason}`);
  process.exit(result.success ? 0 : 1);
}

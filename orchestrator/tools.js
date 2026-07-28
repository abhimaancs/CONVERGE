import fs from "node:fs";
import path from "node:path";
import { runTestsInSandbox } from "./docker-sandbox.js";

/**
 * read_file / write_file operate directly on the host filesystem, not
 * inside the container. That's a deliberate choice: the repo checkout
 * itself is trusted (it's just text files), and doing file I/O over a
 * docker exec round-trip for every read/write adds latency for no
 * safety benefit. The thing that actually needs isolation is *running*
 * the code — arbitrary imports, loops, syscalls — which is why only
 * run_tests goes through the sandbox.
 *
 * Every path is resolved against repoRoot and checked to prevent the
 * LLM from writing outside the repo (e.g. "../../etc/passwd").
 */
function resolveSafe(repoRoot, relPath) {
  const resolved = path.resolve(repoRoot, relPath);
  if (!resolved.startsWith(path.resolve(repoRoot) + path.sep) && resolved !== path.resolve(repoRoot)) {
    throw new Error(`Path escapes repo root: ${relPath}`);
  }
  return resolved;
}

export function makeTools(repoRoot) {
  return {
    read_file({ path: relPath }) {
      const full = resolveSafe(repoRoot, relPath);
      if (!fs.existsSync(full)) {
        return { error: `File not found: ${relPath}` };
      }
      return { content: fs.readFileSync(full, "utf-8") };
    },

    write_file({ path: relPath, content }) {
      const full = resolveSafe(repoRoot, relPath);

      // Guard against a real failure mode seen with weaker/free models:
      // emitting literal backslash-n text instead of actual newline
      // characters, so a multi-line file becomes one broken line. If the
      // content has no real newlines but does contain literal "\n" text,
      // it's almost certainly double-escaped — reject early with a message
      // the model can act on, rather than letting it surface later as a
      // confusing Python syntax error from run_tests.
      const hasRealNewlines = content.includes("\n");
      const looksDoubleEscaped = !hasRealNewlines && /\\n/.test(content);
      if (looksDoubleEscaped) {
        return {
          error:
            "Rejected: content contains literal backslash-n sequences instead of real line breaks (it looks double-escaped). " +
            "Write the file's actual text with real newlines in the content field — do not escape them yourself.",
        };
      }

      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
      return { ok: true, path: relPath };
    },

    // Recursive on purpose: the first version only listed one directory
    // level per call, which meant a multi-directory repo (src/pkg/tests/...)
    // could burn several whole attempts just walking the tree before the
    // agent ever got to read a real file. One call now returns every file
    // path in the repo (skipping noise dirs), so exploration costs one
    // attempt regardless of repo depth.
    list_files({ dir = "." } = {}) {
      const start = resolveSafe(repoRoot, dir);
      const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".pytest_cache", "venv", ".venv"]);
      const results = [];

      function walk(current, relPrefix) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walk(path.join(current, e.name), relPrefix ? `${relPrefix}/${e.name}` : e.name);
          } else {
            results.push(relPrefix ? `${relPrefix}/${e.name}` : e.name);
          }
        }
      }

      walk(start, dir === "." ? "" : dir);
      return { files: results.sort() };
    },

    async run_tests() {
      const result = await runTestsInSandbox(repoRoot);
      return result;
    },
  };
}

// OpenAI/OpenRouter function-calling schema: each tool is wrapped in
// { type: "function", function: { name, description, parameters } }
// (Anthropic's native API uses a flatter { name, input_schema } shape instead —
// this project talks to OpenRouter, so we use the OpenAI-style shape.)
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file in the repo, given a path relative to the repo root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to repo root, e.g. calculator.py" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Overwrite a file in the repo with new content, given a path relative to the repo root. Creates the file if it doesn't exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "The full new content of the file." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Recursively list every file in the repo (or under a given subdirectory), as relative paths. One call returns the whole tree — no need to call it once per directory.",
      parameters: {
        type: "object",
        properties: { dir: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description: "Run the test suite inside an isolated sandbox container and return pass/fail plus full output (stdout+stderr).",
      parameters: { type: "object", properties: {} },
    },
  },
];

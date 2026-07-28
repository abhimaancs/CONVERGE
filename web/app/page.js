"use client";

import { useState, useRef } from "react";

const styles = {
  page: { maxWidth: 900, margin: "0 auto", padding: "32px 20px" },
  h1: { fontSize: 22, marginBottom: 4 },
  sub: { color: "#8b949e", marginBottom: 28, fontSize: 14 },
  label: { display: "block", fontSize: 13, color: "#8b949e", marginBottom: 4, marginTop: 16 },
  input: {
    width: "100%",
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 6,
    color: "#e6edf3",
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 14,
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    minHeight: 80,
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 6,
    color: "#e6edf3",
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 14,
    boxSizing: "border-box",
    resize: "vertical",
  },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 16 },
  button: {
    marginTop: 20,
    background: "#238636",
    border: "none",
    borderRadius: 6,
    color: "white",
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
  trace: {
    marginTop: 28,
    background: "#010409",
    border: "1px solid #30363d",
    borderRadius: 6,
    padding: 16,
    maxHeight: 480,
    overflowY: "auto",
    fontSize: 13,
    lineHeight: 1.5,
  },
  traceLabel: { color: "#79c0ff", fontWeight: 700, marginTop: 10 },
  traceDetail: { color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  result: { marginTop: 16, padding: 12, borderRadius: 6, fontSize: 14 },
  resultSuccess: { background: "#0d2818", border: "1px solid #238636", color: "#7ee787" },
  resultFail: { background: "#2d0f13", border: "1px solid #da3633", color: "#ffa198" },
  link: { color: "#58a6ff" },
};

export default function Home() {
  const [repoSlug, setRepoSlug] = useState("");
  const [issue, setIssue] = useState("");
  const [openPr, setOpenPr] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [result, setResult] = useState(null);
  const traceRef = useRef(null);

  async function handleRun(e) {
    e.preventDefault();
    if (!repoSlug.trim() || !issue.trim() || running) return;

    setRunning(true);
    setEvents([]);
    setResult(null);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoSlug: repoSlug.trim(), issue: issue.trim(), openPr }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop(); // last chunk may be incomplete, keep it for next read

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "heartbeat") {
            // keep-alive ping only — nothing to render
          } else if (payload.type === "result") {
            setResult(payload);
          } else {
            setEvents((prev) => [...prev, payload]);
          }
        }

        // auto-scroll to bottom as new events arrive
        requestAnimationFrame(() => {
          if (traceRef.current) traceRef.current.scrollTop = traceRef.current.scrollHeight;
        });
      }
    } catch (err) {
      setResult({ success: false, reason: err.message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Converge</h1>
      <p style={styles.sub}>Autonomous code-fixing agent — point it at a repo and an issue, watch it work.</p>

      <form onSubmit={handleRun}>
        <label style={styles.label}>GitHub repo (owner/repo)</label>
        <input
          style={styles.input}
          value={repoSlug}
          onChange={(e) => setRepoSlug(e.target.value)}
          placeholder="yourusername/converge-test-repo"
          disabled={running}
        />

        <label style={styles.label}>Issue description</label>
        <textarea
          style={styles.textarea}
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="Describe the bug or failing test..."
          disabled={running}
        />

        <div style={styles.checkboxRow}>
          <input
            type="checkbox"
            id="openPr"
            checked={openPr}
            onChange={(e) => setOpenPr(e.target.checked)}
            disabled={running}
          />
          <label htmlFor="openPr" style={{ fontSize: 13, color: "#8b949e" }}>
            Open a real PR if the fix succeeds (requires GITHUB_TOKEN on the server)
          </label>
        </div>

        <button
          type="submit"
          style={{ ...styles.button, ...(running ? styles.buttonDisabled : {}) }}
          disabled={running}
        >
          {running ? "Running..." : "Run Converge"}
        </button>
      </form>

      {events.length > 0 && (
        <div style={styles.trace} ref={traceRef}>
          {events.map((e, i) => (
            <div key={i}>
              <div style={styles.traceLabel}>[{e.label}]</div>
              {e.detail && <div style={styles.traceDetail}>{e.detail}</div>}
            </div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ ...styles.result, ...(result.success ? styles.resultSuccess : styles.resultFail) }}>
          {result.success ? (
            <>
              ✅ Fixed in {result.attempts} attempt(s).
              {result.prUrl && (
                <>
                  {" "}
                  PR:{" "}
                  <a href={result.prUrl} target="_blank" rel="noreferrer" style={styles.link}>
                    {result.prUrl}
                  </a>
                </>
              )}
            </>
          ) : (
            <>❌ {result.reason}</>
          )}
        </div>
      )}
    </div>
  );
}

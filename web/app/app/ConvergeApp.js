"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle.js";

/* ── Trace icon mapper ── */
function traceIcon(label = "") {
  const l = label.toUpperCase();
  if (l.includes("CLONE"))                               return Clone;
  if (l.includes("AGENT"))                               return Agent;
  if (l.includes("READ"))                                return Read;
  if (l.includes("WRITE"))                               return Write;
  if (l.includes("LIST"))                                return List;
  if (l.includes("TEST"))                                return Test;
  if (l.includes("TOOL"))                                return Tool;
  if (l.includes("ATTEMPT"))                             return Retry;
  if (l.includes("BRANCH"))                              return Branch;
  if (l.includes("COMMIT") || l.includes("PUSH"))        return Push;
  if (l.includes("PR"))                                  return PR;
  if (l.includes("DONE") || l.includes("PASS"))          return Check;
  if (l.includes("FAIL") || l.includes("FATAL") || l.includes("STOP")) return X;
  return Dot;
}

/* ── Inline SVG icon set ── */
const Clone  = () => <SVG d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>;
const Agent  = () => <SVG d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zM2 20a10 10 0 0 1 20 0"/>;
const Read   = () => <SVG d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>;
const Write  = () => <SVG d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>;
const List   = () => <SVG d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>;
const Test   = () => <SVG d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z M14 2v6h6 M9 13l2 2 4-4"/>;
const Tool   = () => <SVG d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>;
const Retry  = () => <SVG d="M1 4v6h6 M3.51 15a9 9 0 1 0 .49-3.55"/>;
const Branch = () => <SVG d="M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9"/>;
const Push   = () => <SVG d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12"/>;
const PR     = () => <SVG d="M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 9v6 M18 12v3"/>;
const Check  = () => <SVG d="M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3"/>;
const X      = () => <SVG d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01"/>;
const Dot    = () => <SVG d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/>;

function SVG({ d }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : "M" + seg} />
      ))}
    </svg>
  );
}

/* ── Main component ── */
export default function ConvergeApp({ username }) {
  const router = useRouter();
  const [repoSlug, setRepoSlug]   = useState("");
  const [issue, setIssue]         = useState("");
  const [openPr, setOpenPr]       = useState(false);
  const [running, setRunning]     = useState(false);
  const [events, setEvents]       = useState([]);
  const [result, setResult]       = useState(null);
  const [runCount, setRunCount]   = useState(0);
  const traceRef = useRef(null);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function handleRun(e) {
    e.preventDefault();
    if (!repoSlug.trim() || !issue.trim() || running) return;

    setRunning(true);
    setEvents([]);
    setResult(null);
    setRunCount((c) => c + 1);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoSlug: repoSlug.trim(), issue: issue.trim(), openPr }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `Run request failed (${res.status}).`);
      }
      if (!res.body) throw new Error("The server did not start the run stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "heartbeat") {
            // keep-alive — nothing to render
          } else if (payload.type === "result") {
            setResult(payload);
          } else {
            setEvents((prev) => [...prev, payload]);
          }
        }

        requestAnimationFrame(() => {
          if (traceRef.current)
            traceRef.current.scrollTop = traceRef.current.scrollHeight;
        });
      }
    } catch (err) {
      setResult({ success: false, reason: err.message });
    } finally {
      setRunning(false);
    }
  }

  const canRun = repoSlug.trim() && issue.trim() && !running;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── Navbar ── */}
      <header className="navbar">
        <Link href="/" className="navbar-brand">
          <div className="logo-mark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          Converge
        </Link>

        <div className="navbar-actions">
          {/* User pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 10px 5px 7px",
            borderRadius: "var(--r-full)",
            border: "1px solid var(--border)",
            background: "var(--surface-raised)",
            fontSize: 13, color: "var(--text-secondary)",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "var(--primary-subtle)",
              border: "1px solid var(--primary-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "var(--primary)",
              flexShrink: 0,
            }}>
              {username[0]?.toUpperCase()}
            </div>
            <span className="hide-mobile">{username}</span>
          </div>

          <ThemeToggle />

          <button
            onClick={handleLogout}
            className="btn btn-ghost btn-sm"
            aria-label="Sign out"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span className="hide-mobile">Sign out</span>
          </button>
        </div>
      </header>

      {/* ── Page content ── */}
      <div style={{ flex: 1, padding: "28px 24px 48px", maxWidth: 1160, margin: "0 auto", width: "100%" }}>

        {/* Page header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{
            fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px",
            color: "var(--text)", margin: "0 0 5px",
          }}>
            Agent Dashboard
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
            Point the agent at a repository and describe the issue.
          </p>
        </div>

        {/* Dashboard grid */}
        <div className="dashboard-grid">

          {/* ── Left panel: Run form ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ padding: "22px 20px" }}>
              <div style={{ marginBottom: 20 }}>
                <p className="section-eyebrow">New run</p>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                  Configure the agent
                </h2>
              </div>

              <form onSubmit={handleRun} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

                {/* Repo input */}
                <div>
                  <label htmlFor="repo-input" className="label">
                    GitHub repository
                  </label>
                  <div style={{ position: "relative" }}>
                    <div style={{
                      position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                      color: "var(--muted)", pointerEvents: "none",
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                      </svg>
                    </div>
                    <input
                      id="repo-input"
                      className="input"
                      style={{ paddingLeft: 34 }}
                      value={repoSlug}
                      onChange={(e) => setRepoSlug(e.target.value)}
                      placeholder="owner/repository"
                      maxLength={300}
                      disabled={running}
                      aria-label="GitHub repository slug"
                    />
                  </div>
                  <p className="hint">e.g. torvalds/linux or yourusername/my-project</p>
                </div>

                {/* Issue textarea */}
                <div>
                  <label htmlFor="issue-input" className="label">Issue description</label>
                  <textarea
                    id="issue-input"
                    className="input textarea"
                    style={{ minHeight: 120 }}
                    value={issue}
                    onChange={(e) => setIssue(e.target.value)}
                    placeholder="Describe the bug or failing test in plain English. Be specific — include function names, expected vs. actual behavior, error messages if you have them."
                    maxLength={6000}
                    disabled={running}
                    aria-label="Issue description"
                  />
                </div>

                {/* PR toggle */}
                <label
                  className={`toggle-card${openPr ? " active" : ""}`}
                  htmlFor="open-pr-toggle"
                  style={{ cursor: running ? "not-allowed" : "pointer" }}
                >
                  <input
                    type="checkbox"
                    id="open-pr-toggle"
                    checked={openPr}
                    onChange={(e) => setOpenPr(e.target.checked)}
                    disabled
                  />
                  <div>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3,
                    }}>
                      Open a pull request on success (temporarily unavailable)
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                      Pull requests will be available after each user connects their own GitHub account.
                    </div>
                  </div>
                </label>

                {/* Submit */}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!canRun}
                  style={{ height: 44, fontSize: 15, width: "100%", marginTop: 2 }}
                >
                  {running ? (
                    <><span className="spinner" />Running agent…</>
                  ) : (
                    <>
                      Run Converge
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Run stats card — only shown after at least one run */}
            {runCount > 0 && (
              <div className="card animate-fade-up" style={{
                padding: "16px 20px",
                display: "flex", gap: 0,
              }}>
                <div style={{ flex: 1, textAlign: "center", paddingRight: 16, borderRight: "1px solid var(--border)" }}>
                  <div className="stat-value" style={{ fontSize: 22 }}>{runCount}</div>
                  <div className="stat-label">Run{runCount !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ flex: 1, textAlign: "center", paddingLeft: 16 }}>
                  <div className="stat-value" style={{ fontSize: 22, color: result?.success ? "var(--success)" : result ? "var(--danger)" : "var(--text)" }}>
                    {result ? (result.success ? "✓" : "✗") : "—"}
                  </div>
                  <div className="stat-label">Last result</div>
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel: Trace + Result ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Empty state */}
            {events.length === 0 && !result && !running && (
              <div className="empty-state animate-fade-in">
                <div className="empty-state-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <p className="empty-state-title">No runs yet</p>
                <p className="empty-state-desc">
                  Fill in the form and run the agent. The live trace will appear here as it works.
                </p>
              </div>
            )}

            {/* Trace panel */}
            {(events.length > 0 || running) && (
              <div className="trace-panel animate-fade-up">
                {/* Header */}
                <div className="trace-header">
                  <div className="trace-title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                    Agent trace
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {events.length} event{events.length !== 1 ? "s" : ""}
                    </span>
                    {running && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pulse-dot" />
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Live
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="trace-body" ref={traceRef}>
                  {events.map((ev, i) => {
                    const Icon = traceIcon(ev.label);
                    return (
                      <div key={i} className="trace-row">
                        <span className="trace-icon" style={{ color: "var(--primary)", opacity: 0.8 }}>
                          <Icon />
                        </span>
                        <div>
                          <span className="trace-label">[{ev.label}]</span>
                          {ev.detail && (
                            <div className="trace-detail">{ev.detail}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {running && (
                    <div style={{ paddingTop: 4, color: "var(--muted)", fontSize: 12, display: "flex", alignItems: "center", gap: 6, paddingLeft: 22 }}>
                      waiting<span className="cursor-blink" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Result banner */}
            {result && (
              <div className={`alert ${result.success ? "alert-success" : "alert-danger"} animate-fade-up`}>
                <span className="alert-icon">
                  {result.success ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                  )}
                </span>
                <div>
                  {result.success ? (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Fixed in {result.attempts} attempt{result.attempts !== 1 ? "s" : ""}
                      </div>
                      {result.prUrl ? (
                        <div style={{ fontSize: 13 }}>
                          Pull request opened:{" "}
                          <a
                            href={result.prUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--success-text)", textDecoration: "underline", fontWeight: 500, wordBreak: "break-all" }}
                          >
                            {result.prUrl}
                          </a>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13 }}>Tests are passing. No PR was requested.</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Agent did not converge</div>
                      <div style={{ fontSize: 13 }}>{result.reason}</div>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

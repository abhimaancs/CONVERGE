"use client";

import Link from "next/link";
import ThemeToggle from "./components/ThemeToggle.js";

const STEPS = [
  { label: "Read", icon: "◎", desc: "Navigates and reads relevant files" },
  { label: "Fix",  icon: "◈", desc: "Writes a targeted patch" },
  { label: "Test", icon: "◇", desc: "Runs Python or npm checks in an isolated container" },
  { label: "Retry", icon: "↻", desc: "Retries until checks pass" },
];

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
    title: "Intelligent navigation",
    desc: "Reads and understands your codebase structure before making any changes.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
    title: "Targeted patches",
    desc: "Writes precise fixes — not rewrites. Only changes what needs to change.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: "Sandboxed execution",
    desc: "Tests run in a network-isolated, resource-capped Docker container.",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
    title: "Opens the PR",
    desc: "On success, creates a branch, commits the fix, and opens a pull request.",
  },
];

export default function Landing() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ─── Navbar ─── */}
      <header className="navbar">
        <Link href="/" className="navbar-brand">
          <div className="logo-mark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          Converge
        </Link>
        <nav className="navbar-actions">
          <a
            href="https://github.com/abhimaancs/CONVERGE"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
            aria-label="View source on GitHub"
            title="View on GitHub"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
            <span className="hide-mobile">GitHub</span>
          </a>
          <ThemeToggle />
          <Link href="/login" className="btn btn-ghost btn-sm">Sign in</Link>
          <Link href="/signup" className="btn btn-primary btn-sm">Get Started</Link>
        </nav>
      </header>

      {/* ─── Hero ─── */}
      <main style={{ flex: 1 }}>
        <section style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          padding: "88px 24px 72px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Background radial — subtle accent lighting */}
          <div style={{
            position: "absolute",
            top: "-60px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "700px",
            height: "400px",
            background: "radial-gradient(ellipse at center, var(--primary-glow) 0%, transparent 70%)",
            pointerEvents: "none",
            zIndex: 0,
          }} />

          <div style={{ position: "relative", zIndex: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* Eyebrow badge */}
            <div className="badge badge-primary" style={{ marginBottom: 20 }}>
              <span className="pulse-dot" style={{ width: 6, height: 6 }} />
              Autonomous Code-Fixing Agent
            </div>

            {/* Product name label */}
            <div style={{
              fontSize: "clamp(22px, 3vw, 32px)",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--primary)",
              marginBottom: 16,
            }}>
              Converge
            </div>

            {/* Headline */}
            <h1 style={{
              fontSize: "clamp(36px, 5.5vw, 62px)",
              fontWeight: 700,
              letterSpacing: "-1.5px",
              lineHeight: 1.1,
              maxWidth: 720,
              margin: "0 0 22px",
              color: "var(--text)",
            }}>
              Fix bugs.{" "}
              <span style={{
                color: "var(--primary)",
                position: "relative",
                display: "inline-block",
              }}>
                Ship faster.
              </span>
            </h1>

            {/* Subheadline */}
            <p style={{
              fontSize: "clamp(16px, 2vw, 18px)",
              color: "var(--text-secondary)",
              maxWidth: 520,
              lineHeight: 1.75,
              margin: "0 0 40px",
              fontWeight: 400,
            }}>
              Point Converge at a GitHub repo and describe the issue.
              It reads the code, writes a fix, runs the tests in an isolated
              container, retries until green, then opens a PR.
            </p>

            {/* CTAs */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <Link href="/signup" className="btn btn-primary btn-lg">
                Get Started
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </Link>
              <Link href="/login" className="btn btn-secondary btn-lg">Sign in</Link>
            </div>

            {/* Agent loop flow */}
            <div style={{ marginTop: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
              {/* Step pill row */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 0,
                flexWrap: "wrap",
                justifyContent: "center",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-xl)",
                padding: "6px",
                boxShadow: "var(--shadow-sm)",
              }}>
                {STEPS.map((step, i) => (
                  <div key={step.label} style={{ display: "flex", alignItems: "center" }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "8px 14px",
                      borderRadius: "var(--r-md)",
                      fontSize: 13,
                      fontWeight: 500,
                      color: step.label === "Retry" ? "var(--primary)" : "var(--text-secondary)",
                    }}>
                      <span style={{
                        width: 24, height: 24,
                        borderRadius: "var(--r-sm)",
                        background: step.label === "Retry" ? "var(--primary-subtle)" : "var(--surface-overlay)",
                        border: `1px solid ${step.label === "Retry" ? "var(--primary-border)" : "var(--border)"}`,
                        color: step.label === "Retry" ? "var(--primary)" : "var(--muted)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {i + 1}
                      </span>
                      {step.label}
                    </div>
                    {i < STEPS.length - 1 && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    )}
                  </div>
                ))}
              </div>

              {/* Loop-back indicator */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginTop: 6,
                gap: 0,
              }}>
                {/* Curved arrow path */}
                <svg width="320" height="36" viewBox="0 0 320 36" fill="none" aria-hidden="true"
                  style={{ overflow: "visible" }}>
                  {/* Line curving back from right (Retry) to left (Fix) */}
                  <path
                    d="M 290 4 C 290 28, 30 28, 30 4"
                    stroke="var(--primary-border)"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    fill="none"
                  />
                  {/* Arrowhead pointing up-right, near Fix (step 2) */}
                  <polyline
                    points="22,10 30,4 38,10"
                    stroke="var(--primary)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
                {/* Label sitting under the arc */}
                <span style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--primary)",
                  letterSpacing: "0.03em",
                  marginTop: -20,
                  background: "var(--bg)",
                  padding: "0 8px",
                  borderRadius: "var(--r-full)",
                }}>
                  if tests fail → retry from Fix
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Feature cards ─── */}
        <section style={{ padding: "0 24px 96px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <p className="section-eyebrow">How it works</p>
              <h2 style={{
                fontSize: "clamp(22px, 3vw, 30px)",
                fontWeight: 700, letterSpacing: "-0.5px",
                color: "var(--text)", margin: "0 auto",
                maxWidth: 480,
              }}>
                The full loop, fully autonomous
              </h2>
            </div>

            <div className="feature-grid">
              {FEATURES.map((f, i) => (
                <div key={f.title} className="card animate-fade-up" style={{
                  padding: "22px 20px",
                  animationDelay: `${i * 60}ms`,
                }}>
                  <div style={{
                    width: 38, height: 38,
                    borderRadius: "var(--r-md)",
                    background: "var(--primary-subtle)",
                    border: "1px solid var(--primary-border)",
                    color: "var(--primary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 14,
                  }}>
                    {f.icon}
                  </div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 7px", color: "var(--text)" }}>
                    {f.title}
                  </h3>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65, margin: 0 }}>
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── CTA strip ─── */}
        <section style={{ padding: "0 24px 96px" }}>
          <div style={{
            maxWidth: 760, margin: "0 auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-xl)",
            padding: "44px 40px",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
            boxShadow: "var(--shadow-md)",
          }}>
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse at 50% 0%, var(--primary-glow) 0%, transparent 60%)",
              pointerEvents: "none",
            }} />
            <div style={{ position: "relative" }}>
              <h2 style={{
                fontSize: "clamp(22px, 3vw, 28px)",
                fontWeight: 700, letterSpacing: "-0.5px",
                margin: "0 0 12px", color: "var(--text)",
              }}>
                Ready to automate your bug fixes?
              </h2>
              <p style={{
                fontSize: 15, color: "var(--text-secondary)",
                margin: "0 0 28px", lineHeight: 1.65,
              }}>
                Point Converge at any GitHub repo and let the agent do the work.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/signup" className="btn btn-primary btn-lg">Get Started</Link>
                <Link href="/login" className="btn btn-secondary btn-lg">Sign in</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer style={{
        borderTop: "1px solid var(--border)",
        padding: "20px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div className="navbar-brand" style={{ fontSize: 14 }}>
          <div className="logo-mark" style={{ width: 22, height: 22, borderRadius: 6, fontSize: 10 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          Converge
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          Autonomous code-fixing agent · No human in the loop until review time
        </p>
      </footer>
    </div>
  );
}

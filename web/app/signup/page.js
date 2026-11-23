"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle.js";

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong."); return; }
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const pwStrength = password.length === 0 ? null : password.length < 8 ? "weak" : password.length < 12 ? "ok" : "strong";
  const strengthColor = { weak: "var(--danger)", ok: "var(--warning)", strong: "var(--success)" };
  const strengthLabel = { weak: "Too short", ok: "Acceptable", strong: "Strong" };

  return (
    <div className="auth-page">
      {/* Ambient background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 0%, var(--primary-glow) 0%, transparent 55%)",
      }} />

      <div style={{ position: "fixed", top: 14, right: 16, display: "flex", gap: 8, zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div className="card animate-fade-up" style={{
        width: "100%", maxWidth: 400,
        padding: "36px 32px",
        boxShadow: "var(--shadow-lg)",
        position: "relative", zIndex: 1,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <Link href="/" style={{ marginBottom: 20 }}>
            <div className="logo-mark" style={{ width: 40, height: 40, borderRadius: 10, fontSize: 17 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
          </Link>
          <h1 style={{
            fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px",
            margin: "0 0 6px", color: "var(--text)", textAlign: "center",
          }}>
            Create your account
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, textAlign: "center" }}>
            Get started with Converge for free
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label htmlFor="signup-username" className="label">Username</label>
            <input
              id="signup-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="your-username"
              disabled={submitting}
              aria-label="Username"
            />
            <p className="hint">At least 3 characters. Letters, numbers, hyphens.</p>
          </div>

          <div>
            <label htmlFor="signup-password" className="label">Password</label>
            <input
              id="signup-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={submitting}
              aria-label="Password"
            />
            {/* Password strength meter */}
            {pwStrength && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 3, flex: 1 }}>
                  {["weak", "ok", "strong"].map((level) => (
                    <div key={level} style={{
                      height: 3, flex: 1, borderRadius: 2,
                      background: ["weak","ok","strong"].indexOf(pwStrength) >= ["weak","ok","strong"].indexOf(level)
                        ? strengthColor[level]
                        : "var(--border-strong)",
                      transition: "background 0.2s",
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 11, color: strengthColor[pwStrength], fontWeight: 600, minWidth: 60, textAlign: "right" }}>
                  {strengthLabel[pwStrength]}
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="alert alert-danger animate-fade-in" role="alert">
              <span className="alert-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !username.trim() || !password.trim()}
            style={{ width: "100%", height: 42, fontSize: 15, marginTop: 2 }}
          >
            {submitting ? (
              <><span className="spinner" />Creating account…</>
            ) : (
              "Create account"
            )}
          </button>
        </form>

        <hr className="divider" style={{ margin: "24px 0" }} />

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--primary)", fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

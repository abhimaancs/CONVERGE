"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "../components/ThemeToggle.js";

export default function LoginPage() {
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
      const res = await fetch("/api/auth/login", {
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

  return (
    <div className="auth-page">
      {/* Ambient background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 0%, var(--primary-glow) 0%, transparent 55%)",
      }} />

      {/* Top-right actions */}
      <div style={{ position: "fixed", top: 14, right: 16, display: "flex", gap: 8, zIndex: 10 }}>
        <ThemeToggle />
      </div>

      {/* Card */}
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
            Welcome back
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, textAlign: "center" }}>
            Sign in to your Converge account
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label htmlFor="login-username" className="label">Username</label>
            <input
              id="login-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="your-username"
              disabled={submitting}
              aria-label="Username"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="label">Password</label>
            <input
              id="login-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={submitting}
              aria-label="Password"
            />
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
              <><span className="spinner" />Signing in…</>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <hr className="divider" style={{ margin: "24px 0" }} />

        <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          Don't have an account?{" "}
          <Link href="/signup" style={{ color: "var(--primary)", fontWeight: 600 }}>
            Create one free
          </Link>
        </p>
      </div>
    </div>
  );
}

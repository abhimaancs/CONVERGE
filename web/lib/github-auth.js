import crypto from "node:crypto";
import { getGithubConnection, setGithubConnection } from "./users.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";
const OAUTH_COOKIE_MAX_AGE = 10 * 60;
const GITHUB_TIMEOUT_MS = 10_000;
const refreshes = new Map();

export function isGithubAppConfigured() {
  return Boolean(
    process.env.GITHUB_APP_CLIENT_ID &&
    process.env.GITHUB_APP_CLIENT_SECRET &&
    process.env.GITHUB_APP_CALLBACK_URL &&
    process.env.SESSION_SECRET,
  );
}

function getAppConfig() {
  if (!isGithubAppConfigured()) {
    throw new Error("GitHub App is not configured. Add the GitHub App client ID, secret, and callback URL.");
  }
  return {
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_APP_CALLBACK_URL,
  };
}

function signPayload(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for GitHub authorization.");
  return crypto.createHmac("sha256", secret).update(`github-oauth:${payload}`).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createGithubAuthorizationFlow(username) {
  const { clientId, callbackUrl } = getAppConfig();
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const payload = Buffer.from(JSON.stringify({ username, state, verifier, expiresAt: Date.now() + OAUTH_COOKIE_MAX_AGE * 1000 })).toString("base64url");
  const signedCookie = `${payload}.${signPayload(payload)}`;

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "offline_access");
  authorizeUrl.searchParams.set("allow_signup", "false");
  return { authorizeUrl: authorizeUrl.toString(), signedCookie, cookieMaxAge: OAUTH_COOKIE_MAX_AGE };
}

export function verifyGithubAuthorizationFlow(signedCookie, state) {
  if (!signedCookie || !state) return null;
  const separator = signedCookie.lastIndexOf(".");
  if (separator < 0) return null;
  const payload = signedCookie.slice(0, separator);
  const signature = signedCookie.slice(separator + 1);
  if (!safeEqual(signature, signPayload(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.username !== "string" || !data.username || typeof data.verifier !== "string") return null;
    if (typeof data.expiresAt !== "number" || data.expiresAt < Date.now()) return null;
    if (!safeEqual(data.state, state)) return null;
    return data;
  } catch {
    return null;
  }
}

async function exchangeToken(form) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || !data.access_token) {
    throw new Error("GitHub authorization failed. Please reconnect and try again.");
  }
  return data;
}

function expiryFrom(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? Date.now() + value * 1000 : null;
}

export async function finishGithubAuthorization({ code, verifier, username }) {
  const { clientId, clientSecret, callbackUrl } = getAppConfig();
  const token = await exchangeToken({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: callbackUrl,
    code_verifier: verifier,
  });
  if (!token.refresh_token || !token.expires_in || !token.refresh_token_expires_in) {
    throw new Error("Enable expiring GitHub App user tokens so Converge can store short-lived access credentials.");
  }

  const response = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.access_token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Converge",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("GitHub did not return a valid account. Please reconnect and try again.");
  const profile = await response.json();
  if (!profile?.id || !profile?.login) throw new Error("GitHub returned an incomplete account profile.");

  setGithubConnection(username, {
    id: profile.id,
    login: profile.login,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiryFrom(token.expires_in),
    refreshExpiresAt: expiryFrom(token.refresh_token_expires_in),
  });
  return { id: String(profile.id), login: profile.login };
}

async function refreshGithubConnection(username, connection) {
  const { clientId, clientSecret } = getAppConfig();
  if (!connection.refreshToken || (connection.refreshExpiresAt && connection.refreshExpiresAt <= Date.now())) {
    throw new Error("Your GitHub authorization expired. Reconnect GitHub to continue.");
  }
  const token = await exchangeToken({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
  });
  if (!token.refresh_token || !token.expires_in || !token.refresh_token_expires_in) {
    throw new Error("GitHub did not return a refreshed expiring token. Reconnect your account.");
  }
  setGithubConnection(username, {
    id: connection.id,
    login: connection.login,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiryFrom(token.expires_in),
    refreshExpiresAt: expiryFrom(token.refresh_token_expires_in),
  });
  return token.access_token;
}

export async function getGithubAccessToken(username) {
  const connection = getGithubConnection(username);
  if (!connection) return null;
  if (!connection.expiresAt || connection.expiresAt > Date.now() + 60_000) return connection.accessToken;
  if (!refreshes.has(username)) {
    const refresh = refreshGithubConnection(username, connection).finally(() => refreshes.delete(username));
    refreshes.set(username, refresh);
  }
  return refreshes.get(username);
}

export async function revokeGithubToken(clientId, clientSecret, accessToken) {
  if (!clientId || !clientSecret || !accessToken) return false;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${GITHUB_API}/applications/${encodeURIComponent(clientId)}/token`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Converge",
    },
    body: JSON.stringify({ access_token: accessToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  return response.ok;
}

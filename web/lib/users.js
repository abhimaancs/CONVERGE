import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

// A JSON file is enough for a single-user/small-group portfolio project —
// no real concurrent-write concerns at this scale. bcryptjs specifically
// (not the native `bcrypt` package) because it's pure JS: no native
// compilation step, which matters a lot on Windows where a missing C++
// build toolchain is a common source of broken `npm install`s.
const DB_PATH = path.join(process.cwd(), "data", "users.json");

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return {}; // no file yet, or corrupted — treat as empty
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tempPath = `${DB_PATH}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempPath, DB_PATH);
}

function tokenKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured to encrypt GitHub tokens.");
  return Buffer.from(crypto.hkdfSync(
    "sha256",
    Buffer.from(secret),
    Buffer.from("converge-v1"),
    Buffer.from("github-token-storage"),
    32,
  ));
}

function encryptToken(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptToken(value) {
  if (!value) return null;
  const [version, ivText, tagText, encryptedText] = value.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Stored GitHub credentials are invalid. Disconnect and reconnect GitHub.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt stored GitHub credentials. Check SESSION_SECRET or reconnect GitHub.");
  }
}

export function getUser(username) {
  return readUsers()[username] || null;
}

export function getGithubConnectionInfo(username) {
  const connection = getUser(username)?.github;
  if (!connection) return null;
  return {
    id: connection.id,
    login: connection.login,
    connectedAt: connection.connectedAt,
    expiresAt: connection.expiresAt,
    refreshExpiresAt: connection.refreshExpiresAt,
  };
}

export function getGithubConnection(username) {
  const connection = getUser(username)?.github;
  if (!connection) return null;
  return {
    ...getGithubConnectionInfo(username),
    accessToken: decryptToken(connection.accessToken),
    refreshToken: decryptToken(connection.refreshToken),
  };
}

export function setGithubConnection(username, connection) {
  const users = readUsers();
  if (!users[username]) throw new Error("Your Converge account no longer exists. Sign in and try again.");
  const githubId = String(connection.id);
  const linkedAccount = Object.entries(users).find(([otherUsername, user]) =>
    otherUsername !== username && user.github?.id === githubId
  );
  if (linkedAccount) throw new Error("That GitHub account is already connected to another Converge account.");

  users[username].github = {
    id: githubId,
    login: connection.login,
    accessToken: encryptToken(connection.accessToken),
    refreshToken: encryptToken(connection.refreshToken),
    expiresAt: connection.expiresAt,
    refreshExpiresAt: connection.refreshExpiresAt,
    connectedAt: new Date().toISOString(),
  };
  writeUsers(users);
}

export function clearGithubConnection(username) {
  const users = readUsers();
  if (!users[username]?.github) return null;
  const connection = users[username].github;
  let accessToken = null;
  try {
    accessToken = decryptToken(connection.accessToken);
  } catch {
    // Still clear the local encrypted credential if its key is unavailable.
  }
  delete users[username].github;
  writeUsers(users);
  return {
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    accessToken,
  };
}

export async function createUser(username, password) {
  const users = readUsers();
  if (users[username]) {
    throw new Error("That username is already taken.");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  users[username] = { passwordHash, createdAt: new Date().toISOString() };
  writeUsers(users);
}

export async function verifyPassword(username, password) {
  const user = getUser(username);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

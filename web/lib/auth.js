import crypto from "node:crypto";

// Simple HMAC-signed session tokens instead of a full session-store or a
// JWT library — this app has exactly one claim to carry (the username), so
// a signed "username.signature" string is enough: the signature proves the
// server issued it, without needing a database lookup per request.
const SECRET = process.env.SESSION_SECRET;

function sign(value) {
  if (!SECRET) {
    throw new Error(
      "SESSION_SECRET is not set. Set it to any long random string before starting the server " +
        "(e.g. `set SESSION_SECRET=some-long-random-string`) — it's what makes session cookies unforgeable."
    );
  }
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

export function createSessionToken(username) {
  return `${username}.${sign(username)}`;
}

export function verifySessionToken(token) {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx === -1) return null;

  const username = token.slice(0, idx);
  const providedSig = token.slice(idx + 1);
  const expectedSig = sign(username);

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  // timingSafeEqual requires equal-length buffers, and throws otherwise —
  // check length first rather than letting a mismatched length throw,
  // since that's also just "not a valid token."
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return username;
}

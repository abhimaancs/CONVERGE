import fs from "node:fs";
import path from "node:path";
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
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2), "utf-8");
}

export function getUser(username) {
  return readUsers()[username] || null;
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

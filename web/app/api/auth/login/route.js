import { NextResponse } from "next/server";
import { verifyPassword } from "../../../../lib/users.js";
import { createSessionToken } from "../../../../lib/auth.js";

export const runtime = "nodejs";

export async function POST(request) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const valid = await verifyPassword(username, password);
  if (!valid) {
    // Deliberately vague — doesn't reveal whether the username exists,
    // just that this combination didn't work.
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

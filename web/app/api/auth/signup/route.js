import { NextResponse } from "next/server";
import { createUser } from "../../../../lib/users.js";
import { createSessionToken } from "../../../../lib/auth.js";

export const runtime = "nodejs";

export async function POST(request) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }
  if (username.length < 3) {
    return NextResponse.json({ error: "Username must be at least 3 characters." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    await createUser(username, password);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

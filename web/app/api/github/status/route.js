import { NextResponse } from "next/server";
import { verifySessionToken } from "../../../../lib/auth.js";
import { isGithubAppConfigured } from "../../../../lib/github-auth.js";
import { getGithubConnectionInfo } from "../../../../lib/users.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const username = verifySessionToken(request.cookies.get("session")?.value);
  if (!username) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({
    configured: isGithubAppConfigured(),
    connection: getGithubConnectionInfo(username),
  }, { headers: { "Cache-Control": "no-store" } });
}

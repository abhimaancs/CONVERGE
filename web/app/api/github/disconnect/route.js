import { NextResponse } from "next/server";
import { verifySessionToken } from "../../../../lib/auth.js";
import { revokeGithubToken } from "../../../../lib/github-auth.js";
import { clearGithubConnection } from "../../../../lib/users.js";

export const runtime = "nodejs";

export async function POST(request) {
  const username = verifySessionToken(request.cookies.get("session")?.value);
  if (!username) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let revoked = null;
  try {
    revoked = clearGithubConnection(username);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let tokenRevoked = !revoked?.accessToken;
  if (revoked?.accessToken) {
    try {
      tokenRevoked = await revokeGithubToken(revoked.clientId, process.env.GITHUB_APP_CLIENT_SECRET, revoked.accessToken);
    } catch (error) {
      console.error("Could not revoke GitHub token:", error.message);
    }
  }
  return NextResponse.json({ ok: true, tokenRevoked });
}

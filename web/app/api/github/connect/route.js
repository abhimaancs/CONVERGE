import { NextResponse } from "next/server";
import { verifySessionToken } from "../../../../lib/auth.js";
import { createGithubAuthorizationFlow, isGithubAppConfigured } from "../../../../lib/github-auth.js";

export const runtime = "nodejs";

export async function GET(request) {
  const username = verifySessionToken(request.cookies.get("session")?.value);
  if (!username) return NextResponse.redirect(new URL("/login", request.url));
  if (!isGithubAppConfigured()) return NextResponse.redirect(new URL("/app?github=setup-required", request.url));

  try {
    const flow = createGithubAuthorizationFlow(username);
    const response = NextResponse.redirect(flow.authorizeUrl);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set("github_oauth", flow.signedCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/github",
      maxAge: flow.cookieMaxAge,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/app?github=setup-required", request.url));
  }
}

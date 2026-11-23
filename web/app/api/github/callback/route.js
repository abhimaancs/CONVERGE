import { NextResponse } from "next/server";
import { verifySessionToken } from "../../../../lib/auth.js";
import { finishGithubAuthorization, isGithubAppConfigured, verifyGithubAuthorizationFlow } from "../../../../lib/github-auth.js";

export const runtime = "nodejs";

function appUrl(request, result) {
  const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL;
  const base = callbackUrl ? new URL(callbackUrl) : new URL(request.url);
  const target = new URL("/app", base.origin);
  target.searchParams.set("github", result);
  return target;
}

function clearFlowCookie(response) {
  response.cookies.set("github_oauth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github",
    maxAge: 0,
  });
  return response;
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const flow = isGithubAppConfigured()
    ? verifyGithubAuthorizationFlow(request.cookies.get("github_oauth")?.value, state)
    : null;
  const sessionUser = verifySessionToken(request.cookies.get("session")?.value);

  let result = "failed";
  if (flow && sessionUser === flow.username && params.get("error") === "access_denied") {
    result = "denied";
  } else if (flow && sessionUser === flow.username && code && code.length <= 512) {
    try {
      await finishGithubAuthorization({ code, verifier: flow.verifier, username: flow.username });
      result = "connected";
    } catch (error) {
      console.error("GitHub connection failed:", error.message);
      result = "failed";
    }
  }

  const response = clearFlowCookie(NextResponse.redirect(appUrl(request, result)));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

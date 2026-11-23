import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "../../lib/auth.js";
import ConvergeApp from "./ConvergeApp.js";
import { getGithubConnectionInfo } from "../../lib/users.js";
import { isGithubAppConfigured } from "../../lib/github-auth.js";

export default async function AppPage({ searchParams }) {
  const cookieStore = await cookies();
  const username = verifySessionToken(cookieStore.get("session")?.value);
  const query = await searchParams;

  if (!username) {
    redirect("/login");
  }

  return (
    <ConvergeApp
      username={username}
      githubConnection={getGithubConnectionInfo(username)}
      githubConfigured={isGithubAppConfigured()}
      githubNotice={query?.github || null}
    />
  );
}

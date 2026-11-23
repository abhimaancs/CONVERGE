import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "../../lib/auth.js";
import ConvergeApp from "./ConvergeApp.js";

export default async function AppPage() {
  const cookieStore = await cookies();
  const username = verifySessionToken(cookieStore.get("session")?.value);

  if (!username) {
    redirect("/login");
  }

  return <ConvergeApp username={username} />;
}

import { expireSessionCookieHeader } from "@/auth/session";

export async function POST() {
  return Response.json(
    {
      session: null
    },
    {
      headers: {
        "Set-Cookie": expireSessionCookieHeader()
      }
    }
  );
}

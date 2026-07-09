import { authErrorResponse, requireSession } from "@/auth/session";

export async function GET() {
  try {
    const session = await requireSession();

    return Response.json({
      session
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

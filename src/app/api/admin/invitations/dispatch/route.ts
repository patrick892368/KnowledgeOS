import { handleInvitationEmailDispatch } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return handleInvitationEmailDispatch(request);
}

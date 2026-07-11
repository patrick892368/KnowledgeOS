import { handleInvitationEmailDispatch } from "./handler";
import { handleInvitationDispatchReview } from "./review-handler";

export async function GET(request: Request): Promise<Response> {
  return handleInvitationDispatchReview(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleInvitationEmailDispatch(request);
}

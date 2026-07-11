import { handleInvitationDeliveryEvidenceReview } from "./handler";

export async function GET(request: Request): Promise<Response> {
  return handleInvitationDeliveryEvidenceReview(request);
}

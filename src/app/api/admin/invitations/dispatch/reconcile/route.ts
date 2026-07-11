import { handleInvitationDeliveryReconciliation } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return handleInvitationDeliveryReconciliation(request);
}

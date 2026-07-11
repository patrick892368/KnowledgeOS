import { handleInvitationProviderWebhook } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return handleInvitationProviderWebhook(request);
}

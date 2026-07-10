import { authErrorResponse, requireSession } from "@/auth/session";
import {
  createInvitationPlan,
  InvitationLifecycleError,
  invitationLifecycleErrorResponse,
  parseInvitationPlanPayload
} from "@/invitations/lifecycle";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new InvitationLifecycleError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    const invitation = createInvitationPlan({
      session,
      payload: parseInvitationPlanPayload(payload)
    });

    return Response.json(
      {
        invitation: {
          id: invitation.id,
          organizationId: invitation.organizationId,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          createdAt: invitation.createdAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString()
        },
        auditIntent: invitation.auditIntent
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InvitationLifecycleError) {
      return invitationLifecycleErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

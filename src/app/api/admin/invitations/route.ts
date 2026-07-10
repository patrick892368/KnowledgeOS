import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  persistInvitation,
  type PersistedInvitation
} from "@/db/invitation-repository";
import {
  createInvitationPlan,
  InvitationLifecycleError,
  invitationLifecycleErrorResponse,
  parseInvitationPersistFlag,
  type InvitationPlan,
  parseInvitationPlanPayload
} from "@/invitations/lifecycle";

function toDatabaseUnavailableError(error: unknown): InvitationLifecycleError {
  return new InvitationLifecycleError(
    "database_unavailable",
    error instanceof Error ? error.message : "Invitation database is unavailable."
  );
}

function serializeInvitation(invitation: InvitationPlan | PersistedInvitation) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString()
  };
}

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

    const invitationPayload = parseInvitationPlanPayload(payload);
    const shouldPersist = parseInvitationPersistFlag(payload);

    if (shouldPersist) {
      try {
        const result = await persistInvitation(createDatabaseClient(), {
          session,
          payload: invitationPayload
        });

        return Response.json(
          {
            mode: result.mode,
            invitation: serializeInvitation(result.invitation),
            auditIntent: result.auditIntent,
            auditEvent: result.auditEvent
          },
          { status: result.mode === "created" ? 201 : 200 }
        );
      } catch (error) {
        if (error instanceof InvitationLifecycleError) {
          throw error;
        }

        throw toDatabaseUnavailableError(error);
      }
    }

    const invitation = createInvitationPlan({
      session,
      payload: invitationPayload
    });

    return Response.json(
      {
        mode: "planned",
        invitation: serializeInvitation(invitation),
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

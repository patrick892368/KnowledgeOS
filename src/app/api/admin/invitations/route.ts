import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  listOrganizationInvitations,
  persistInvitation,
  revokeInvitation,
  type PersistedInvitation
} from "@/db/invitation-repository";
import {
  createInvitationPlan,
  InvitationLifecycleError,
  invitationLifecycleErrorResponse,
  parseInvitationPersistFlag,
  type InvitationPlan,
  parseInvitationPlanPayload,
  parseInvitationRevocationPayload
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
    ...("updatedAt" in invitation
      ? { updatedAt: invitation.updatedAt.toISOString() }
      : {}),
    expiresAt: invitation.expiresAt.toISOString(),
    ...("revokedAt" in invitation && invitation.revokedAt
      ? { revokedAt: invitation.revokedAt.toISOString() }
      : {})
  };
}

export async function GET() {
  try {
    const session = await requireSession();

    try {
      const persistedInvitations = await listOrganizationInvitations(
        createDatabaseClient(),
        session
      );

      return Response.json({
        invitations: persistedInvitations.map(serializeInvitation)
      });
    } catch (error) {
      if (error instanceof InvitationLifecycleError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof InvitationLifecycleError) {
      return invitationLifecycleErrorResponse(error);
    }

    return authErrorResponse(error);
  }
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

export async function DELETE(request: Request) {
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

    const revoke = parseInvitationRevocationPayload(payload);

    try {
      const result = await revokeInvitation(createDatabaseClient(), {
        session,
        invitationId: revoke.invitationId
      });

      return Response.json({
        invitation: serializeInvitation(result.invitation),
        auditEvent: result.auditEvent
      });
    } catch (error) {
      if (error instanceof InvitationLifecycleError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof InvitationLifecycleError) {
      return invitationLifecycleErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

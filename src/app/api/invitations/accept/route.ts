import {
  AuthError,
  authErrorResponse,
  createSessionCookieHeader,
  createSignedSessionToken
} from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  acceptInvitation,
  type InvitationAcceptanceResult,
  type PersistedInvitation
} from "@/db/invitation-repository";
import {
  parseInvitationAcceptancePayload
} from "@/invitations/acceptance";
import {
  InvitationLifecycleError,
  invitationLifecycleErrorResponse
} from "@/invitations/lifecycle";

function toDatabaseUnavailableError(error: unknown): InvitationLifecycleError {
  return new InvitationLifecycleError(
    "database_unavailable",
    error instanceof Error
      ? error.message
      : "Invitation acceptance database is unavailable."
  );
}

function serializeInvitation(invitation: PersistedInvitation) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    ...(invitation.acceptedAt
      ? { acceptedAt: invitation.acceptedAt.toISOString() }
      : {}),
    ...(invitation.revokedAt
      ? { revokedAt: invitation.revokedAt.toISOString() }
      : {})
  };
}

function serializeAcceptance(result: InvitationAcceptanceResult) {
  return {
    mode: "accepted",
    invitation: serializeInvitation(result.invitation),
    membership: {
      id: result.membership.id,
      organizationId: result.membership.organizationId,
      userId: result.membership.userId,
      role: result.membership.role,
      createdAt: result.membership.createdAt.toISOString(),
      updatedAt: result.membership.updatedAt.toISOString()
    },
    session: {
      ...result.session,
      source: "signed-cookie" as const
    },
    auditEvent: result.auditEvent
  };
}

export async function POST(request: Request) {
  try {
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new InvitationLifecycleError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    const acceptancePayload = parseInvitationAcceptancePayload(payload);

    try {
      const result = await acceptInvitation(createDatabaseClient(), {
        payload: acceptancePayload
      });
      const token = createSignedSessionToken(
        result.session,
        process.env.KNOWLEDGEOS_SESSION_SECRET ?? ""
      );

      return Response.json(serializeAcceptance(result), {
        headers: {
          "Set-Cookie": createSessionCookieHeader(token)
        }
      });
    } catch (error) {
      if (error instanceof InvitationLifecycleError) {
        throw error;
      }

      if (error instanceof AuthError) {
        return authErrorResponse(error);
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

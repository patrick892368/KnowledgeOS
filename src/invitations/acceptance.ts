import type { InvitationStatus } from "@/db/model";
import type { auditEvents } from "@/db/schema";

import {
  InvitationLifecycleError,
  isValidInvitationEmail,
  normalizeInvitationEmail,
  type InvitableMembershipRole
} from "./lifecycle";
import { hashInvitationToken } from "./tokens";

export interface InvitationAcceptancePayload {
  invitationId: string;
  token: string;
  email: string;
  organizationId?: string;
}

export interface InvitationAcceptanceTarget {
  id: string;
  organizationId: string;
  email: string;
  role: InvitableMembershipRole;
  status: InvitationStatus;
  tokenHash: string;
  expiresAt: Date;
}

export interface InvitationAcceptancePlan {
  invitationId: string;
  organizationId: string;
  email: string;
  role: InvitableMembershipRole;
  previousStatus: "pending";
  nextStatus: "accepted";
  acceptedAt: Date;
  auditIntent: typeof auditEvents.$inferInsert;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseInvitationAcceptancePayload(
  payload: unknown
): InvitationAcceptancePayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new InvitationLifecycleError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  const candidate = payload as Partial<
    Record<"invitationId" | "token" | "email" | "organizationId", unknown>
  >;
  const invitationId = readTrimmedString(candidate.invitationId);
  const token = readTrimmedString(candidate.token);
  const email =
    typeof candidate.email === "string"
      ? normalizeInvitationEmail(candidate.email)
      : "";
  const organizationId = readTrimmedString(candidate.organizationId);

  if (!invitationId) {
    throw new InvitationLifecycleError(
      "invalid_payload",
      "invitationId is required."
    );
  }

  if (!token) {
    throw new InvitationLifecycleError(
      "invalid_token",
      "Invitation token is required."
    );
  }

  if (!isValidInvitationEmail(email)) {
    throw new InvitationLifecycleError(
      "invalid_email",
      "email must be a valid address."
    );
  }

  return {
    invitationId,
    token,
    email,
    organizationId: organizationId || undefined
  };
}

export function createInvitationAcceptancePlan(input: {
  payload: InvitationAcceptancePayload;
  target: InvitationAcceptanceTarget;
  now?: Date;
}): InvitationAcceptancePlan {
  const acceptedAt = input.now ?? new Date();

  if (
    input.payload.organizationId &&
    input.payload.organizationId !== input.target.organizationId
  ) {
    throw new InvitationLifecycleError(
      "not_found",
      "Invitation was not found."
    );
  }

  if (
    input.payload.invitationId !== input.target.id ||
    input.payload.email !== input.target.email
  ) {
    throw new InvitationLifecycleError(
      "not_found",
      "Invitation was not found."
    );
  }

  if (input.target.status === "accepted") {
    throw new InvitationLifecycleError(
      "accepted_invitation",
      "Invitation has already been accepted."
    );
  }

  if (input.target.status === "revoked") {
    throw new InvitationLifecycleError(
      "revoked_invitation",
      "Invitation has been revoked."
    );
  }

  if (
    input.target.status === "expired" ||
    input.target.expiresAt.getTime() <= acceptedAt.getTime()
  ) {
    throw new InvitationLifecycleError(
      "expired_invitation",
      "Invitation has expired."
    );
  }

  if (hashInvitationToken(input.payload.token) !== input.target.tokenHash) {
    throw new InvitationLifecycleError(
      "invalid_token",
      "Invitation token is invalid."
    );
  }

  return {
    invitationId: input.target.id,
    organizationId: input.target.organizationId,
    email: input.target.email,
    role: input.target.role,
    previousStatus: "pending",
    nextStatus: "accepted",
    acceptedAt,
    auditIntent: {
      organizationId: input.target.organizationId,
      actorUserId: null,
      action: "invitation.acceptance_planned",
      resourceType: "organization",
      resourceId: input.target.organizationId,
      metadata: {
        invitationId: input.target.id,
        email: input.target.email,
        role: input.target.role,
        previousStatus: "pending",
        nextStatus: "accepted",
        acceptedAt: acceptedAt.toISOString()
      }
    }
  };
}

import { randomUUID } from "node:crypto";

import type { AuthSession } from "@/auth/session";
import {
  isMembershipRole,
  type MembershipRole
} from "@/db/model";
import type { auditEvents } from "@/db/schema";

export type InvitationStatus = "pending";
export type InvitableMembershipRole = Exclude<MembershipRole, "owner">;

export type InvitationLifecycleErrorCode =
  | "invalid_payload"
  | "invalid_email"
  | "invalid_role"
  | "forbidden"
  | "not_found";

export class InvitationLifecycleError extends Error {
  constructor(
    public readonly code: InvitationLifecycleErrorCode,
    message: string,
    public readonly status =
      code === "forbidden" ? 403 : code === "not_found" ? 404 : 400
  ) {
    super(message);
    this.name = "InvitationLifecycleError";
  }
}

export interface InvitationPlanPayload {
  email: string;
  role: MembershipRole;
  organizationId?: string;
  expiresInDays: number;
}

export interface InvitationPlan {
  id: string;
  organizationId: string;
  email: string;
  role: InvitableMembershipRole;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  auditIntent: typeof auditEvents.$inferInsert;
}

const defaultExpirationDays = 7;
const maxExpirationDays = 30;
const dayInMs = 24 * 60 * 60 * 1000;

export function canPlanInvitations(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return (
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function parseExpirationDays(value: unknown): number {
  if (value === undefined) {
    return defaultExpirationDays;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maxExpirationDays
  ) {
    throw new InvitationLifecycleError(
      "invalid_payload",
      "expiresInDays must be an integer between 1 and 30."
    );
  }

  return value;
}

export function parseInvitationPlanPayload(
  payload: unknown
): InvitationPlanPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new InvitationLifecycleError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  const candidate = payload as Partial<
    Record<"email" | "role" | "organizationId" | "expiresInDays", unknown>
  >;
  const email =
    typeof candidate.email === "string" ? normalizeEmail(candidate.email) : "";
  const role = typeof candidate.role === "string" ? candidate.role.trim() : "";
  const organizationId =
    typeof candidate.organizationId === "string"
      ? candidate.organizationId.trim()
      : undefined;

  if (!isValidEmail(email)) {
    throw new InvitationLifecycleError(
      "invalid_email",
      "email must be a valid address."
    );
  }

  if (!isMembershipRole(role)) {
    throw new InvitationLifecycleError(
      "invalid_role",
      "role must be one of owner, admin, editor, or viewer."
    );
  }

  return {
    email,
    role,
    organizationId: organizationId || undefined,
    expiresInDays: parseExpirationDays(candidate.expiresInDays)
  };
}

export function createInvitationPlan(input: {
  session: AuthSession;
  payload: InvitationPlanPayload;
  now?: Date;
  invitationId?: string;
}): InvitationPlan {
  if (!canPlanInvitations(input.session.role)) {
    throw new InvitationLifecycleError(
      "forbidden",
      "Only owner or admin members can plan organization invitations."
    );
  }

  if (
    input.payload.organizationId &&
    input.payload.organizationId !== input.session.organizationId
  ) {
    throw new InvitationLifecycleError(
      "not_found",
      "Organization invitation target was not found."
    );
  }

  if (input.payload.role === "owner") {
    throw new InvitationLifecycleError(
      "forbidden",
      "Owner invitations require a dedicated owner transfer workflow."
    );
  }

  const createdAt = input.now ?? new Date();
  const expiresAt = new Date(
    createdAt.getTime() + input.payload.expiresInDays * dayInMs
  );
  const id = input.invitationId ?? randomUUID();

  return {
    id,
    organizationId: input.session.organizationId,
    email: input.payload.email,
    role: input.payload.role,
    status: "pending",
    createdAt,
    expiresAt,
    auditIntent: {
      organizationId: input.session.organizationId,
      actorUserId: input.session.userId,
      action: "invitation.planned",
      resourceType: "organization",
      resourceId: input.session.organizationId,
      metadata: {
        invitationId: id,
        email: input.payload.email,
        role: input.payload.role,
        status: "pending",
        expiresAt: expiresAt.toISOString()
      }
    }
  };
}

export function invitationLifecycleErrorResponse(error: unknown): Response {
  if (error instanceof InvitationLifecycleError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected invitation lifecycle failure."
      }
    },
    { status: 500 }
  );
}

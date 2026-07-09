import { and, asc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";

import type { Database } from "./client";
import {
  isMembershipRole,
  type MembershipRole
} from "./model";
import { auditEvents, memberships, users } from "./schema";

export type MembershipManagementErrorCode =
  | "invalid_payload"
  | "invalid_role"
  | "forbidden"
  | "not_found"
  | "database_unavailable";

export class MembershipManagementError extends Error {
  constructor(
    public readonly code: MembershipManagementErrorCode,
    message: string,
    public readonly status =
      code === "forbidden"
        ? 403
        : code === "not_found"
          ? 404
          : code === "database_unavailable"
            ? 503
            : 400
  ) {
    super(message);
    this.name = "MembershipManagementError";
  }
}

export interface ManagedMembership {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  name: string;
  role: MembershipRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRoleUpdatePayload {
  membershipId: string;
  role: MembershipRole;
}

export interface MembershipRoleUpdateTarget {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
}

export interface MembershipRoleUpdatePlan {
  membershipId: string;
  previousRole: MembershipRole;
  nextRole: MembershipRole;
  updatedAt: Date;
  auditEvent: typeof auditEvents.$inferInsert;
}

export function canManageMemberships(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

export function parseMembershipRoleUpdatePayload(
  payload: unknown
): MembershipRoleUpdatePayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new MembershipManagementError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  const candidate = payload as Partial<Record<"membershipId" | "role", unknown>>;
  const membershipId =
    typeof candidate.membershipId === "string"
      ? candidate.membershipId.trim()
      : "";
  const role = typeof candidate.role === "string" ? candidate.role.trim() : "";

  if (!membershipId) {
    throw new MembershipManagementError(
      "invalid_payload",
      "membershipId is required."
    );
  }

  if (!isMembershipRole(role)) {
    throw new MembershipManagementError(
      "invalid_role",
      "role must be one of owner, admin, editor, or viewer."
    );
  }

  return {
    membershipId,
    role
  };
}

export function createMembershipRoleUpdatePlan(input: {
  session: AuthSession;
  target: MembershipRoleUpdateTarget;
  role: MembershipRole;
  now?: Date;
}): MembershipRoleUpdatePlan {
  if (!canManageMemberships(input.session.role)) {
    throw new MembershipManagementError(
      "forbidden",
      "Only owner or admin members can manage organization memberships."
    );
  }

  if (input.target.organizationId !== input.session.organizationId) {
    throw new MembershipManagementError("not_found", "Membership was not found.");
  }

  if (
    input.session.role === "admin" &&
    (input.target.role === "owner" || input.role === "owner")
  ) {
    throw new MembershipManagementError(
      "forbidden",
      "Admins cannot assign or modify owner memberships."
    );
  }

  if (
    input.target.id === input.session.membershipId &&
    input.target.role === "owner" &&
    input.role !== "owner"
  ) {
    throw new MembershipManagementError(
      "forbidden",
      "Owners cannot change their own owner role through this endpoint."
    );
  }

  const updatedAt = input.now ?? new Date();

  return {
    membershipId: input.target.id,
    previousRole: input.target.role,
    nextRole: input.role,
    updatedAt,
    auditEvent: {
      organizationId: input.session.organizationId,
      actorUserId: input.session.userId,
      action: "membership.role_updated",
      resourceType: "organization",
      resourceId: input.session.organizationId,
      metadata: {
        membershipId: input.target.id,
        targetUserId: input.target.userId,
        previousRole: input.target.role,
        nextRole: input.role
      }
    }
  };
}

export async function listOrganizationMemberships(
  db: Database,
  session: AuthSession
): Promise<ManagedMembership[]> {
  if (!canManageMemberships(session.role)) {
    throw new MembershipManagementError(
      "forbidden",
      "Only owner or admin members can view organization memberships."
    );
  }

  return db
    .select({
      id: memberships.id,
      organizationId: memberships.organizationId,
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
      updatedAt: memberships.updatedAt
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, session.organizationId))
    .orderBy(asc(users.email));
}

export async function updateOrganizationMembershipRole(
  db: Database,
  input: {
    session: AuthSession;
    membershipId: string;
    role: MembershipRole;
    now?: Date;
  }
): Promise<ManagedMembership> {
  const [current] = await db
    .select({
      id: memberships.id,
      organizationId: memberships.organizationId,
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
      updatedAt: memberships.updatedAt
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.id, input.membershipId),
        eq(memberships.organizationId, input.session.organizationId)
      )
    )
    .limit(1);

  if (!current) {
    throw new MembershipManagementError("not_found", "Membership was not found.");
  }

  const plan = createMembershipRoleUpdatePlan({
    session: input.session,
    target: current,
    role: input.role,
    now: input.now
  });

  const [updated] = await db
    .update(memberships)
    .set({
      role: plan.nextRole,
      updatedAt: plan.updatedAt
    })
    .where(
      and(
        eq(memberships.id, plan.membershipId),
        eq(memberships.organizationId, input.session.organizationId)
      )
    )
    .returning({
      id: memberships.id,
      organizationId: memberships.organizationId,
      userId: memberships.userId,
      role: memberships.role,
      createdAt: memberships.createdAt,
      updatedAt: memberships.updatedAt
    });

  if (!updated) {
    throw new MembershipManagementError("not_found", "Membership was not found.");
  }

  await db.insert(auditEvents).values(plan.auditEvent);

  return {
    ...updated,
    email: current.email,
    name: current.name
  };
}

export function membershipManagementErrorResponse(error: unknown): Response {
  if (error instanceof MembershipManagementError) {
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
        message: "Unexpected membership management failure."
      }
    },
    { status: 500 }
  );
}

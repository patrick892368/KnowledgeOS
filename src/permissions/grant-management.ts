import type { AuthSession } from "@/auth/session";
import {
  canRoleManagePermissionGrants,
  membershipRoles,
  permissionActions,
  permissionResourceTypes,
  permissionSubjectTypes,
  type MembershipRole,
  type PermissionAction,
  type PermissionResourceType,
  type PermissionSubjectType
} from "@/db/model";
import type { auditEvents } from "@/db/schema";

export type PermissionGrantManagementErrorCode =
  | "invalid_payload"
  | "invalid_subject"
  | "invalid_resource"
  | "invalid_action"
  | "forbidden"
  | "not_found"
  | "database_unavailable";

export class PermissionGrantManagementError extends Error {
  constructor(
    public readonly code: PermissionGrantManagementErrorCode,
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
    this.name = "PermissionGrantManagementError";
  }
}

export interface PermissionGrantPlanPayload {
  organizationId?: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionAction;
}

export interface PermissionGrantPlan {
  organizationId: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionAction;
  createdAt: Date;
  auditIntent: typeof auditEvents.$inferInsert;
}

export interface PermissionGrantRevocationPayload {
  grantId: string;
}

export function parsePermissionGrantPersistFlag(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new PermissionGrantManagementError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  const candidate = payload as Partial<Record<"persist", unknown>>;

  if (candidate.persist === undefined) {
    return false;
  }

  if (typeof candidate.persist !== "boolean") {
    throw new PermissionGrantManagementError(
      "invalid_payload",
      "persist must be a boolean when provided."
    );
  }

  return candidate.persist;
}

function isPermissionSubjectType(value: string): value is PermissionSubjectType {
  return permissionSubjectTypes.includes(value as PermissionSubjectType);
}

function isPermissionResourceType(value: string): value is PermissionResourceType {
  return permissionResourceTypes.includes(value as PermissionResourceType);
}

function isPermissionAction(value: string): value is PermissionAction {
  return permissionActions.includes(value as PermissionAction);
}

function isMembershipRole(value: string): value is MembershipRole {
  return membershipRoles.includes(value as MembershipRole);
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parsePermissionGrantPlanPayload(
  payload: unknown
): PermissionGrantPlanPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new PermissionGrantManagementError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  const candidate = payload as Partial<
    Record<
      | "organizationId"
      | "subjectType"
      | "subjectId"
      | "resourceType"
      | "resourceId"
      | "action",
      unknown
    >
  >;
  const organizationId = readTrimmedString(candidate.organizationId);
  const subjectType = readTrimmedString(candidate.subjectType);
  const subjectId = readTrimmedString(candidate.subjectId);
  const resourceType = readTrimmedString(candidate.resourceType);
  const resourceId = readTrimmedString(candidate.resourceId);
  const action = readTrimmedString(candidate.action);

  if (!isPermissionSubjectType(subjectType)) {
    throw new PermissionGrantManagementError(
      "invalid_subject",
      "subjectType must be one of user, membership, or role."
    );
  }

  if (!subjectId) {
    throw new PermissionGrantManagementError(
      "invalid_subject",
      "subjectId is required."
    );
  }

  if (subjectType === "role" && !isMembershipRole(subjectId)) {
    throw new PermissionGrantManagementError(
      "invalid_subject",
      "role subjectId must be one of owner, admin, editor, or viewer."
    );
  }

  if (!isPermissionResourceType(resourceType)) {
    throw new PermissionGrantManagementError(
      "invalid_resource",
      "resourceType must be one of organization, source, document, or workflow."
    );
  }

  if (!resourceId) {
    throw new PermissionGrantManagementError(
      "invalid_resource",
      "resourceId is required."
    );
  }

  if (!isPermissionAction(action)) {
    throw new PermissionGrantManagementError(
      "invalid_action",
      "action must be one of read, write, or admin."
    );
  }

  return {
    organizationId: organizationId || undefined,
    subjectType,
    subjectId,
    resourceType,
    resourceId,
    action
  };
}

export function parsePermissionGrantRevocationPayload(
  payload: unknown
): PermissionGrantRevocationPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new PermissionGrantManagementError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  const candidate = payload as Partial<Record<"grantId", unknown>>;
  const grantId = readTrimmedString(candidate.grantId);

  if (!grantId) {
    throw new PermissionGrantManagementError(
      "invalid_payload",
      "grantId is required."
    );
  }

  return {
    grantId
  };
}

export function createPermissionGrantPlan(input: {
  session: AuthSession;
  payload: PermissionGrantPlanPayload;
  now?: Date;
}): PermissionGrantPlan {
  if (!canRoleManagePermissionGrants(input.session.role)) {
    throw new PermissionGrantManagementError(
      "forbidden",
      "Only owner or admin members can manage permission grants."
    );
  }

  if (
    input.payload.organizationId &&
    input.payload.organizationId !== input.session.organizationId
  ) {
    throw new PermissionGrantManagementError(
      "not_found",
      "Permission grant organization target was not found."
    );
  }

  if (
    input.payload.resourceType === "organization" &&
    input.payload.resourceId !== input.session.organizationId
  ) {
    throw new PermissionGrantManagementError(
      "not_found",
      "Organization permission resource was not found."
    );
  }

  if (
    input.session.role === "admin" &&
    (input.payload.action === "admin" ||
      (input.payload.subjectType === "role" &&
        ["owner", "admin"].includes(input.payload.subjectId)))
  ) {
    throw new PermissionGrantManagementError(
      "forbidden",
      "Admins cannot plan admin-level or owner/admin role permission grants."
    );
  }

  const createdAt = input.now ?? new Date();

  return {
    organizationId: input.session.organizationId,
    subjectType: input.payload.subjectType,
    subjectId: input.payload.subjectId,
    resourceType: input.payload.resourceType,
    resourceId: input.payload.resourceId,
    action: input.payload.action,
    createdAt,
    auditIntent: {
      organizationId: input.session.organizationId,
      actorUserId: input.session.userId,
      action: "permission_grant.planned",
      resourceType: input.payload.resourceType,
      resourceId: input.payload.resourceId,
      metadata: {
        subjectType: input.payload.subjectType,
        subjectId: input.payload.subjectId,
        resourceType: input.payload.resourceType,
        resourceId: input.payload.resourceId,
        action: input.payload.action,
        plannedAt: createdAt.toISOString()
      }
    }
  };
}

export function permissionGrantManagementErrorResponse(
  error: unknown
): Response {
  if (error instanceof PermissionGrantManagementError) {
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
        message: "Unexpected permission grant management failure."
      }
    },
    { status: 500 }
  );
}

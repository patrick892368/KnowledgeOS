import {
  type MembershipRole,
  type PermissionAction,
  type PermissionResourceType,
  type PermissionSubjectType
} from "@/db/model";

import type { AuthSession } from "./session";

const roleRank: Record<MembershipRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3
};

const actionRank: Record<PermissionAction, number> = {
  read: 0,
  write: 1,
  admin: 2
};

export interface PermissionGrantInput {
  organizationId: string;
  subjectType: PermissionSubjectType;
  subjectId: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionAction;
}

export interface PermissionRequest {
  organizationId: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  action: PermissionAction;
}

export function roleAtLeast(
  actualRole: MembershipRole,
  requiredRole: MembershipRole
): boolean {
  return roleRank[actualRole] >= roleRank[requiredRole];
}

export function roleAllowsAction(
  role: MembershipRole,
  action: PermissionAction
): boolean {
  if (action === "read") {
    return roleAtLeast(role, "viewer");
  }

  if (action === "write") {
    return roleAtLeast(role, "editor");
  }

  return roleAtLeast(role, "admin");
}

export function actionCovers(
  grantedAction: PermissionAction,
  requestedAction: PermissionAction
): boolean {
  return actionRank[grantedAction] >= actionRank[requestedAction];
}

export function grantMatchesSessionSubject(
  session: AuthSession,
  grant: PermissionGrantInput
): boolean {
  if (grant.subjectType === "user") {
    return grant.subjectId === session.userId;
  }

  if (grant.subjectType === "membership") {
    return Boolean(session.membershipId && grant.subjectId === session.membershipId);
  }

  return grant.subjectId === session.role;
}

export function grantMatchesRequest(
  grant: PermissionGrantInput,
  request: PermissionRequest
): boolean {
  return (
    grant.organizationId === request.organizationId &&
    grant.resourceType === request.resourceType &&
    grant.resourceId === request.resourceId &&
    actionCovers(grant.action, request.action)
  );
}

export function hasExplicitPermissionGrant(
  session: AuthSession,
  request: PermissionRequest,
  grants: readonly PermissionGrantInput[]
): boolean {
  return grants.some(
    (grant) =>
      grantMatchesSessionSubject(session, grant) &&
      grantMatchesRequest(grant, request)
  );
}

export function canAccessResource(
  session: AuthSession,
  request: PermissionRequest,
  grants: readonly PermissionGrantInput[] = []
): boolean {
  if (session.organizationId !== request.organizationId) {
    return false;
  }

  return (
    roleAllowsAction(session.role, request.action) ||
    hasExplicitPermissionGrant(session, request, grants)
  );
}

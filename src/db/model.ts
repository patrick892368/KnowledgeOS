export const embeddingDimensions = 1536 as const;

export const membershipRoles = ["owner", "admin", "editor", "viewer"] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export const invitationStatuses = [
  "pending",
  "accepted",
  "revoked",
  "expired"
] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];

export const sourceTypes = [
  "document",
  "url",
  "repository",
  "note",
  "integration"
] as const;
export type SourceType = (typeof sourceTypes)[number];

export const sourceStatuses = [
  "pending",
  "indexing",
  "ready",
  "failed",
  "archived"
] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

export const documentStatuses = [
  "pending",
  "indexed",
  "failed",
  "archived"
] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

export const permissionSubjectTypes = [
  "user",
  "membership",
  "role"
] as const;
export type PermissionSubjectType = (typeof permissionSubjectTypes)[number];

export const permissionResourceTypes = [
  "organization",
  "source",
  "document",
  "workflow"
] as const;
export type PermissionResourceType = (typeof permissionResourceTypes)[number];

export const permissionActions = ["read", "write", "admin"] as const;
export type PermissionAction = (typeof permissionActions)[number];

export const workflowStatuses = ["draft", "active", "archived"] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

export const workflowRunStatuses = [
  "queued",
  "running",
  "needs_review",
  "completed",
  "failed",
  "canceled"
] as const;
export type WorkflowRunStatus = (typeof workflowRunStatuses)[number];

export const databaseTableNames = [
  "organizations",
  "users",
  "memberships",
  "invitations",
  "sources",
  "documents",
  "chunks",
  "embeddings",
  "permission_grants",
  "citations",
  "workflows",
  "workflow_runs",
  "audit_events"
] as const;

export type DatabaseTableName = (typeof databaseTableNames)[number];

export function isMembershipRole(value: string): value is MembershipRole {
  return membershipRoles.includes(value as MembershipRole);
}

export function canRoleManagePermissionGrants(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

export function isTerminalWorkflowRunStatus(
  status: WorkflowRunStatus
): boolean {
  return ["completed", "failed", "canceled"].includes(status);
}

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

export const invitationDeliveryAttemptStatuses = [
  "prepared",
  "accepted_by_provider",
  "provider_failed"
] as const;
export type InvitationDeliveryAttemptStatus =
  (typeof invitationDeliveryAttemptStatuses)[number];

export const invitationProviderEvidenceTypes = [
  "sent_by_provider",
  "delivered_to_recipient_server",
  "delivery_delayed",
  "bounced",
  "delivery_failed",
  "suppressed",
  "complained"
] as const;
export type InvitationProviderEvidenceType =
  (typeof invitationProviderEvidenceTypes)[number];

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

export const kpiTelemetryCategories = [
  "business",
  "product",
  "ai",
  "governance",
  "workflow",
  "reliability"
] as const;
export type KpiTelemetryCategory = (typeof kpiTelemetryCategories)[number];

export const kpiTelemetryUnits = [
  "count",
  "percent",
  "ratio",
  "milliseconds",
  "seconds",
  "minutes",
  "score"
] as const;
export type KpiTelemetryUnit = (typeof kpiTelemetryUnits)[number];

export const kpiTelemetrySources = [
  "local_summary",
  "quality_summary",
  "governance_summary",
  "workflow_plan",
  "manual_review"
] as const;
export type KpiTelemetrySource = (typeof kpiTelemetrySources)[number];

export const databaseTableNames = [
  "organizations",
  "users",
  "memberships",
  "invitations",
  "invitation_delivery_attempts",
  "invitation_delivery_evidence",
  "sources",
  "documents",
  "chunks",
  "embeddings",
  "permission_grants",
  "citations",
  "workflows",
  "workflow_runs",
  "audit_events",
  "kpi_telemetry_events"
] as const;

export type DatabaseTableName = (typeof databaseTableNames)[number];

export function isMembershipRole(value: string): value is MembershipRole {
  return membershipRoles.includes(value as MembershipRole);
}

export function canRoleManagePermissionGrants(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

export function canManageKpiTelemetry(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

export function isTerminalWorkflowRunStatus(
  status: WorkflowRunStatus
): boolean {
  return ["completed", "failed", "canceled"].includes(status);
}

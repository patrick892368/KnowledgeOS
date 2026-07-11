import { describe, expect, it } from "vitest";

import {
  canManageKpiTelemetry,
  canRoleManagePermissionGrants,
  databaseTableNames,
  embeddingDimensions,
  externalConnectorCapabilities,
  externalConnectorScopeKinds,
  externalConnectorStatuses,
  externalConnectorSyncStrategies,
  externalConnectorTypes,
  invitationDeliveryAttemptStatuses,
  invitationProviderEvidenceTypes,
  invitationStatuses,
  isMembershipRole,
  isTerminalWorkflowRunStatus,
  kpiTelemetryCategories,
  kpiTelemetrySources,
  kpiTelemetryUnits,
  membershipRoles,
  permissionActions,
  permissionResourceTypes,
  permissionSubjectTypes
} from "./model";

describe("database model constants", () => {
  it("tracks the required KnowledgeOS tables", () => {
    expect(databaseTableNames).toEqual([
      "organizations",
      "users",
      "memberships",
      "invitations",
      "invitation_delivery_attempts",
      "invitation_delivery_evidence",
      "external_connectors",
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
    ]);
  });

  it("defines credential-safe external connector taxonomy", () => {
    expect(externalConnectorTypes).toEqual([
      "github",
      "slack",
      "google_drive",
      "notion"
    ]);
    expect(externalConnectorScopeKinds).toEqual([
      "repository",
      "channel",
      "folder",
      "page"
    ]);
    expect(externalConnectorCapabilities).toContain("permission_sync");
    expect(externalConnectorSyncStrategies).toEqual(["full", "incremental"]);
    expect(externalConnectorStatuses).toEqual(["configured", "disabled"]);
  });

  it("defines permission primitives for retrieval boundaries", () => {
    expect(permissionSubjectTypes).toEqual(["user", "membership", "role"]);
    expect(permissionResourceTypes).toContain("document");
    expect(permissionActions).toEqual(["read", "write", "admin"]);
  });

  it("defines invitation lifecycle statuses", () => {
    expect(invitationStatuses).toEqual([
      "pending",
      "accepted",
      "revoked",
      "expired"
    ]);
  });

  it("defines token-free invitation delivery attempt states", () => {
    expect(invitationDeliveryAttemptStatuses).toEqual([
      "prepared",
      "accepted_by_provider",
      "provider_failed"
    ]);
    expect(invitationDeliveryAttemptStatuses).not.toContain("delivered");
  });

  it("defines Provider delivery evidence without inbox-delivered state", () => {
    expect(invitationProviderEvidenceTypes).toEqual([
      "sent_by_provider",
      "delivered_to_recipient_server",
      "delivery_delayed",
      "bounced",
      "delivery_failed",
      "suppressed",
      "complained"
    ]);
    expect(invitationProviderEvidenceTypes).not.toContain("inbox_delivered");
  });

  it("keeps owner and admin as permission administrators", () => {
    expect(membershipRoles.filter(canRoleManagePermissionGrants)).toEqual([
      "owner",
      "admin"
    ]);
  });

  it("keeps owner and admin as KPI telemetry administrators", () => {
    expect(membershipRoles.filter(canManageKpiTelemetry)).toEqual([
      "owner",
      "admin"
    ]);
  });

  it("defines KPI telemetry taxonomy", () => {
    expect(kpiTelemetryCategories).toContain("governance");
    expect(kpiTelemetryUnits).toContain("ratio");
    expect(kpiTelemetrySources).toContain("local_summary");
  });

  it("validates membership roles", () => {
    expect(isMembershipRole("owner")).toBe(true);
    expect(isMembershipRole("guest")).toBe(false);
  });

  it("defines terminal workflow run statuses", () => {
    expect(isTerminalWorkflowRunStatus("completed")).toBe(true);
    expect(isTerminalWorkflowRunStatus("failed")).toBe(true);
    expect(isTerminalWorkflowRunStatus("running")).toBe(false);
  });

  it("uses a fixed embedding dimension for the first vector index", () => {
    expect(embeddingDimensions).toBe(1536);
  });
});

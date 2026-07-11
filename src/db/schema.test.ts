import { describe, expect, it } from "vitest";

import { databaseTableNames, embeddingDimensions } from "./model";
import {
  documentStatusEnum,
  embeddings,
  invitationDeliveryEvidence,
  invitationDeliveryAttempts,
  invitationDeliveryAttemptStatusEnum,
  invitationProviderEvidenceTypeEnum,
  invitationStatusEnum,
  kpiTelemetryCategoryEnum,
  kpiTelemetrySourceEnum,
  kpiTelemetryUnitEnum,
  membershipRoleEnum,
  permissionActionEnum,
  permissionResourceTypeEnum,
  permissionSubjectTypeEnum,
  schemaTables,
  sourceStatusEnum,
  sourceTypeEnum,
  workflowRunStatusEnum,
  workflowStatusEnum
} from "./schema";

describe("database schema", () => {
  it("exports every required table", () => {
    expect(Object.keys(schemaTables).sort()).toEqual(
      [...databaseTableNames].sort()
    );
  });

  it("keeps Drizzle enum values aligned with domain constants", () => {
    expect(membershipRoleEnum.enumValues).toEqual([
      "owner",
      "admin",
      "editor",
      "viewer"
    ]);
    expect(invitationStatusEnum.enumValues).toEqual([
      "pending",
      "accepted",
      "revoked",
      "expired"
    ]);
    expect(invitationDeliveryAttemptStatusEnum.enumValues).toEqual([
      "prepared",
      "accepted_by_provider",
      "provider_failed"
    ]);
    expect(invitationProviderEvidenceTypeEnum.enumValues).toEqual([
      "sent_by_provider",
      "delivered_to_recipient_server",
      "delivery_delayed",
      "bounced",
      "delivery_failed",
      "suppressed",
      "complained"
    ]);
    expect(sourceTypeEnum.enumValues).toContain("repository");
    expect(sourceStatusEnum.enumValues).toContain("indexing");
    expect(documentStatusEnum.enumValues).toContain("indexed");
    expect(permissionSubjectTypeEnum.enumValues).toEqual([
      "user",
      "membership",
      "role"
    ]);
    expect(permissionResourceTypeEnum.enumValues).toContain("workflow");
    expect(permissionActionEnum.enumValues).toEqual(["read", "write", "admin"]);
    expect(workflowStatusEnum.enumValues).toEqual([
      "draft",
      "active",
      "archived"
    ]);
    expect(workflowRunStatusEnum.enumValues).toContain("needs_review");
    expect(kpiTelemetryCategoryEnum.enumValues).toContain("governance");
    expect(kpiTelemetryUnitEnum.enumValues).toContain("ratio");
    expect(kpiTelemetrySourceEnum.enumValues).toContain("local_summary");
  });

  it("sets the embedding vector column to the configured dimensions", () => {
    expect(embeddings.embedding.getSQLType()).toBe(
      `vector(${embeddingDimensions})`
    );
  });

  it("keeps invitation delivery attempts free of secret-bearing columns", () => {
    expect(invitationDeliveryAttempts).not.toHaveProperty("token");
    expect(invitationDeliveryAttempts).not.toHaveProperty("rawToken");
    expect(invitationDeliveryAttempts).not.toHaveProperty("tokenHash");
    expect(invitationDeliveryAttempts).not.toHaveProperty("providerPayload");
  });

  it("keeps invitation delivery evidence immutable and data-minimized", () => {
    expect(invitationDeliveryEvidence).not.toHaveProperty("recipient");
    expect(invitationDeliveryEvidence).not.toHaveProperty("email");
    expect(invitationDeliveryEvidence).not.toHaveProperty("token");
    expect(invitationDeliveryEvidence).not.toHaveProperty("tokenHash");
    expect(invitationDeliveryEvidence).not.toHaveProperty("rawPayload");
    expect(invitationDeliveryEvidence).not.toHaveProperty("signature");
    expect(invitationDeliveryEvidence).not.toHaveProperty("signingSecret");
    expect(invitationDeliveryEvidence).not.toHaveProperty("rawError");
    expect(invitationDeliveryEvidence).not.toHaveProperty("updatedAt");
  });
});

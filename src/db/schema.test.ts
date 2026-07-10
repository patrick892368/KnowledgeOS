import { describe, expect, it } from "vitest";

import { databaseTableNames, embeddingDimensions } from "./model";
import {
  documentStatusEnum,
  embeddings,
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
});

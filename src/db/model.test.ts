import { describe, expect, it } from "vitest";

import {
  canRoleManagePermissionGrants,
  databaseTableNames,
  embeddingDimensions,
  isMembershipRole,
  isTerminalWorkflowRunStatus,
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
      "sources",
      "documents",
      "chunks",
      "embeddings",
      "permission_grants",
      "citations",
      "workflows",
      "workflow_runs",
      "audit_events"
    ]);
  });

  it("defines permission primitives for retrieval boundaries", () => {
    expect(permissionSubjectTypes).toEqual(["user", "membership", "role"]);
    expect(permissionResourceTypes).toContain("document");
    expect(permissionActions).toEqual(["read", "write", "admin"]);
  });

  it("keeps owner and admin as permission administrators", () => {
    expect(membershipRoles.filter(canRoleManagePermissionGrants)).toEqual([
      "owner",
      "admin"
    ]);
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

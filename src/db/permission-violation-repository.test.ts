import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import { AuditEventViewerError } from "./audit-repository";
import type { Database } from "./client";
import {
  classifyPermissionViolation,
  listPermissionViolations
} from "./permission-violation-repository";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const baseAuditEvent = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: session.organizationId,
  actorUserId: session.userId,
  actorEmail: "owner@knowledgeos.local",
  actorName: "KnowledgeOS Owner",
  action: "permission.denied",
  resourceType: "document" as const,
  resourceId: "doc_1",
  metadata: {
    action: "read",
    token: "secret-token"
  },
  createdAt: new Date("2026-07-09T00:00:00.000Z")
};

describe("classifyPermissionViolation", () => {
  it("classifies permission denied audit events and redacts metadata", () => {
    const signal = classifyPermissionViolation(baseAuditEvent);

    expect(signal).toMatchObject({
      id: `permission_violation_${baseAuditEvent.id}`,
      violationType: "permission_denied",
      severity: "low",
      sourceAction: "permission.denied",
      metadata: {
        action: "read",
        token: "[redacted]"
      }
    });
  });

  it("classifies forbidden metadata codes as high severity for organization resources", () => {
    const signal = classifyPermissionViolation({
      ...baseAuditEvent,
      action: "auth.request_rejected",
      resourceType: "organization",
      resourceId: session.organizationId,
      metadata: {
        code: "forbidden"
      }
    });

    expect(signal).toMatchObject({
      violationType: "forbidden_access",
      severity: "high"
    });
  });

  it("ignores normal audit events", () => {
    expect(
      classifyPermissionViolation({
        ...baseAuditEvent,
        action: "membership.role_updated",
        metadata: {
          nextRole: "admin"
        }
      })
    ).toBeNull();
  });
});

describe("listPermissionViolations", () => {
  it("rejects non-manager sessions before querying the database", async () => {
    await expect(
      listPermissionViolations({} as Database, {
        ...session,
        role: "viewer"
      })
    ).rejects.toThrow(AuditEventViewerError);
  });
});

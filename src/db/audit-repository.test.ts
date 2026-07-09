import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import {
  AuditEventViewerError,
  canViewAuditEvents,
  listOrganizationAuditEvents,
  sanitizeAuditMetadata
} from "./audit-repository";
import type { Database } from "./client";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

describe("canViewAuditEvents", () => {
  it("allows only owner and admin roles", () => {
    expect(canViewAuditEvents("owner")).toBe(true);
    expect(canViewAuditEvents("admin")).toBe(true);
    expect(canViewAuditEvents("editor")).toBe(false);
    expect(canViewAuditEvents("viewer")).toBe(false);
  });
});

describe("sanitizeAuditMetadata", () => {
  it("redacts unsafe metadata keys and bounds large values", () => {
    const metadata = sanitizeAuditMetadata({
      token: "secret-token",
      safe: "visible",
      longText: "a".repeat(600),
      nested: {
        apiKey: "secret-key",
        targetUserId: "user_1"
      },
      history: [
        {
          password: "secret-password",
          action: "membership.role_updated"
        }
      ]
    });

    expect(metadata).toMatchObject({
      token: "[redacted]",
      safe: "visible",
      nested: {
        apiKey: "[redacted]",
        targetUserId: "user_1"
      },
      history: [
        {
          password: "[redacted]",
          action: "membership.role_updated"
        }
      ]
    });
    expect(String(metadata.longText)).toHaveLength(500);
  });
});

describe("listOrganizationAuditEvents", () => {
  it("rejects non-manager sessions before querying the database", async () => {
    await expect(
      listOrganizationAuditEvents({} as Database, {
        ...session,
        role: "editor"
      })
    ).rejects.toThrow(AuditEventViewerError);
  });
});

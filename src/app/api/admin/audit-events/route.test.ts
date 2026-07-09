import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { AuditEventViewerError } from "@/db/audit-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  listOrganizationAuditEvents: vi.fn()
}));

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();

  return {
    ...actual,
    requireSession: mocks.requireSession
  };
});

vi.mock("@/db/client", () => ({
  createDatabaseClient: mocks.createDatabaseClient
}));

vi.mock("@/db/audit-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/audit-repository")>();

  return {
    ...actual,
    listOrganizationAuditEvents: mocks.listOrganizationAuditEvents
  };
});

import { GET } from "./route";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const auditEvent = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: session.organizationId,
  actorUserId: session.userId,
  actorEmail: "owner@knowledgeos.local",
  actorName: "KnowledgeOS Owner",
  action: "membership.role_updated",
  resourceType: "organization",
  resourceId: session.organizationId,
  metadata: {
    membershipId: "33333333-3333-4333-8333-333333333333",
    nextRole: "admin"
  },
  createdAt: new Date("2026-07-09T00:00:00.000Z")
};

describe("GET /api/admin/audit-events", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists organization audit events for the current manager session", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationAuditEvents.mockResolvedValue([auditEvent]);

    const response = await GET();
    const payload = (await response.json()) as {
      auditEvents: Array<{
        id: string;
        action: string;
        metadata: Record<string, unknown>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.auditEvents).toHaveLength(1);
    expect(payload.auditEvents[0]).toMatchObject({
      id: auditEvent.id,
      action: "membership.role_updated",
      metadata: {
        nextRole: "admin"
      }
    });
    expect(mocks.listOrganizationAuditEvents).toHaveBeenCalledWith(db, session);
  });

  it("rejects non-manager sessions before opening the database", async () => {
    mocks.requireSession.mockResolvedValue({
      ...session,
      role: "viewer"
    });

    const response = await GET();
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("forbidden");
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.listOrganizationAuditEvents).not.toHaveBeenCalled();
  });

  it("returns repository authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationAuditEvents.mockRejectedValue(
      new AuditEventViewerError(
        "forbidden",
        "Only owner or admin members can view organization audit events."
      )
    );

    const response = await GET();
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("forbidden");
  });
});

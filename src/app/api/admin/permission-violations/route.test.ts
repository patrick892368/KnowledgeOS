import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { AuditEventViewerError } from "@/db/audit-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  listPermissionViolations: vi.fn()
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

vi.mock("@/db/permission-violation-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/permission-violation-repository")>();

  return {
    ...actual,
    listPermissionViolations: mocks.listPermissionViolations
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

const violation = {
  id: "permission_violation_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: session.organizationId,
  auditEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorUserId: session.userId,
  actorEmail: "owner@knowledgeos.local",
  actorName: "KnowledgeOS Owner",
  violationType: "permission_denied",
  severity: "low",
  sourceAction: "permission.denied",
  resourceType: "document",
  resourceId: "doc_1",
  metadata: {
    action: "read"
  },
  occurredAt: new Date("2026-07-09T00:00:00.000Z")
};

describe("GET /api/admin/permission-violations", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists permission violation signals for the current manager session", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listPermissionViolations.mockResolvedValue([violation]);

    const response = await GET();
    const payload = (await response.json()) as {
      permissionViolations: Array<{
        id: string;
        violationType: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.permissionViolations).toHaveLength(1);
    expect(payload.permissionViolations[0]).toMatchObject({
      id: violation.id,
      violationType: "permission_denied"
    });
    expect(mocks.listPermissionViolations).toHaveBeenCalledWith(db, session);
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
    expect(mocks.listPermissionViolations).not.toHaveBeenCalled();
  });

  it("returns repository authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listPermissionViolations.mockRejectedValue(
      new AuditEventViewerError(
        "forbidden",
        "Only owner or admin members can view permission violations."
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

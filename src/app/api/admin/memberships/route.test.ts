import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { MembershipManagementError } from "@/db/membership-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  listOrganizationMemberships: vi.fn(),
  updateOrganizationMembershipRole: vi.fn()
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

vi.mock("@/db/membership-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/membership-repository")>();

  return {
    ...actual,
    listOrganizationMemberships: mocks.listOrganizationMemberships,
    updateOrganizationMembershipRole: mocks.updateOrganizationMembershipRole
  };
});

import { GET, PATCH } from "./route";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const membership = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: session.organizationId,
  userId: "55555555-5555-4555-8555-555555555555",
  email: "member@knowledgeos.local",
  name: "KnowledgeOS Member",
  role: "editor",
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
  updatedAt: new Date("2026-07-09T00:00:00.000Z")
};

function request(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/admin/memberships", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

describe("/api/admin/memberships", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists organization memberships for the current session", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationMemberships.mockResolvedValue([membership]);

    const response = await GET();
    const payload = (await response.json()) as {
      memberships: Array<{
        id: string;
        email: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.memberships).toHaveLength(1);
    expect(payload.memberships[0]).toMatchObject({
      id: membership.id,
      email: "member@knowledgeos.local"
    });
    expect(mocks.listOrganizationMemberships).toHaveBeenCalledWith(db, session);
  });

  it("updates a membership role", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.updateOrganizationMembershipRole.mockResolvedValue({
      ...membership,
      role: "viewer"
    });

    const response = await PATCH(
      request({
        membershipId: membership.id,
        role: "viewer"
      })
    );
    const payload = (await response.json()) as {
      membership: {
        id: string;
        role: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.membership).toMatchObject({
      id: membership.id,
      role: "viewer"
    });
    expect(mocks.updateOrganizationMembershipRole).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        session,
        membershipId: membership.id,
        role: "viewer"
      })
    );
  });

  it("rejects invalid roles before updating", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await PATCH(
      request({
        membershipId: membership.id,
        role: "superadmin"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_role");
    expect(mocks.updateOrganizationMembershipRole).not.toHaveBeenCalled();
  });

  it("returns repository authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.updateOrganizationMembershipRole.mockRejectedValue(
      new MembershipManagementError("forbidden", "Only owner or admin members can manage organization memberships.")
    );

    const response = await PATCH(
      request({
        membershipId: membership.id,
        role: "viewer"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("forbidden");
  });
});

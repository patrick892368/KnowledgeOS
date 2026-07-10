import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn()
}));

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();

  return {
    ...actual,
    requireSession: mocks.requireSession
  };
});

import { POST } from "./route";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

function request(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/admin/invitations", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/invitations", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a governed invitation plan for owner or admin sessions", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      request({
        email: "New.Member@Example.com",
        role: "editor",
        expiresInDays: 3
      })
    );
    const payload = (await response.json()) as {
      invitation: {
        organizationId: string;
        email: string;
        role: string;
        status: string;
        expiresAt: string;
      };
      auditIntent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.invitation).toMatchObject({
      organizationId: session.organizationId,
      email: "new.member@example.com",
      role: "editor",
      status: "pending"
    });
    expect(payload.invitation.expiresAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );
    expect(payload.auditIntent).toMatchObject({
      action: "invitation.planned",
      metadata: {
        email: "new.member@example.com",
        role: "editor",
        status: "pending"
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|password/i);
  });

  it("rejects invalid invitation roles before planning", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      request({
        email: "member@example.com",
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
  });

  it("rejects non-manager sessions", async () => {
    mocks.requireSession.mockResolvedValue({
      ...session,
      role: "viewer"
    });

    const response = await POST(
      request({
        email: "member@example.com",
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

  it("rejects unauthenticated requests", async () => {
    mocks.requireSession.mockRejectedValue(
      new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    );

    const response = await POST(
      request({
        email: "member@example.com",
        role: "viewer"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthenticated");
  });
});

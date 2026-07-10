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
  return new Request("http://knowledgeos.local/api/admin/permission-grants", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

const grantRequest = {
  subjectType: "role",
  subjectId: "editor",
  resourceType: "workflow",
  resourceId: "workflow_1",
  action: "write"
};

describe("POST /api/admin/permission-grants", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a governed permission grant plan for owner or admin sessions", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(request(grantRequest));
    const payload = (await response.json()) as {
      grant: {
        organizationId: string;
        subjectType: string;
        subjectId: string;
        resourceType: string;
        resourceId: string;
        action: string;
      };
      auditIntent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.grant).toMatchObject({
      organizationId: session.organizationId,
      subjectType: "role",
      subjectId: "editor",
      resourceType: "workflow",
      resourceId: "workflow_1",
      action: "write"
    });
    expect(payload.auditIntent).toMatchObject({
      action: "permission_grant.planned",
      metadata: {
        subjectType: "role",
        subjectId: "editor",
        resourceType: "workflow",
        resourceId: "workflow_1",
        action: "write"
      }
    });
  });

  it("rejects invalid actions before planning", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      request({
        ...grantRequest,
        action: "delete"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_action");
  });

  it("rejects non-manager sessions", async () => {
    mocks.requireSession.mockResolvedValue({
      ...session,
      role: "viewer"
    });

    const response = await POST(request(grantRequest));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("forbidden");
  });

  it("rejects admin escalation paths", async () => {
    mocks.requireSession.mockResolvedValue({
      ...session,
      role: "admin"
    });

    const response = await POST(
      request({
        ...grantRequest,
        action: "admin"
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

    const response = await POST(request(grantRequest));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthenticated");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { authCookieName } from "@/auth/session";
import { InvitationLifecycleError } from "@/invitations/lifecycle";

const mocks = vi.hoisted(() => ({
  createDatabaseClient: vi.fn(),
  acceptInvitation: vi.fn()
}));

vi.mock("@/db/client", () => ({
  createDatabaseClient: mocks.createDatabaseClient
}));

vi.mock("@/db/invitation-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/invitation-repository")>();

  return {
    ...actual,
    acceptInvitation: mocks.acceptInvitation
  };
});

import { POST } from "./route";

const acceptedAt = new Date("2026-07-10T03:00:00.000Z");
const acceptedResult = {
  invitation: {
    id: "44444444-4444-4444-8444-444444444444",
    organizationId: "11111111-1111-4111-8111-111111111111",
    email: "member@example.com",
    role: "editor",
    status: "accepted",
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    updatedAt: acceptedAt,
    expiresAt: new Date("2026-07-17T00:00:00.000Z"),
    acceptedAt,
    revokedAt: null
  },
  membership: {
    id: "66666666-6666-4666-8666-666666666666",
    organizationId: "11111111-1111-4111-8111-111111111111",
    userId: "55555555-5555-4555-8555-555555555555",
    role: "editor",
    createdAt: acceptedAt,
    updatedAt: acceptedAt
  },
  user: {
    id: "55555555-5555-4555-8555-555555555555",
    email: "member@example.com",
    name: "member"
  },
  session: {
    userId: "55555555-5555-4555-8555-555555555555",
    organizationId: "11111111-1111-4111-8111-111111111111",
    membershipId: "66666666-6666-4666-8666-666666666666",
    role: "editor",
    email: "member@example.com",
    name: "member"
  },
  auditEvent: {
    organizationId: "11111111-1111-4111-8111-111111111111",
    actorUserId: "55555555-5555-4555-8555-555555555555",
    action: "invitation.accepted",
    resourceType: "organization",
    resourceId: "11111111-1111-4111-8111-111111111111",
    metadata: {
      invitationId: "44444444-4444-4444-8444-444444444444",
      membershipId: "66666666-6666-4666-8666-666666666666",
      userId: "55555555-5555-4555-8555-555555555555",
      previousStatus: "pending",
      nextStatus: "accepted"
    }
  }
};

function stubSessionEnvironment() {
  vi.stubEnv(
    "KNOWLEDGEOS_SESSION_SECRET",
    "test-secret-123456789012345678901234"
  );
}

function request(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/invitations/accept", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/invitations/accept", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("accepts an invitation and issues a signed session cookie", async () => {
    const db = { name: "db" };
    stubSessionEnvironment();
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.acceptInvitation.mockResolvedValue(acceptedResult);

    const response = await POST(
      request({
        invitationId: acceptedResult.invitation.id,
        token: "invite-token",
        email: " Member@Example.COM ",
        organizationId: acceptedResult.invitation.organizationId
      })
    );
    const payload = (await response.json()) as {
      mode: string;
      invitation: {
        status: string;
        acceptedAt: string;
      };
      membership: {
        id: string;
      };
      session: {
        source: string;
        role: string;
      };
      auditEvent: {
        action: string;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(authCookieName);
    expect(payload).toMatchObject({
      mode: "accepted",
      invitation: {
        status: "accepted",
        acceptedAt: "2026-07-10T03:00:00.000Z"
      },
      membership: {
        id: acceptedResult.membership.id
      },
      session: {
        source: "signed-cookie",
        role: "editor"
      },
      auditEvent: {
        action: "invitation.accepted"
      }
    });
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(db, {
      payload: {
        invitationId: acceptedResult.invitation.id,
        token: "invite-token",
        email: "member@example.com",
        organizationId: acceptedResult.invitation.organizationId
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/invite-token|tokenHash/i);
  });

  it("rejects missing tokens before database access", async () => {
    stubSessionEnvironment();

    const response = await POST(
      request({
        invitationId: acceptedResult.invitation.id,
        token: "",
        email: acceptedResult.invitation.email
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_token");
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("returns invalid token errors safely", async () => {
    stubSessionEnvironment();
    mocks.createDatabaseClient.mockReturnValue({});
    mocks.acceptInvitation.mockRejectedValue(
      new InvitationLifecycleError(
        "invalid_token",
        "Invitation token is invalid."
      )
    );

    const response = await POST(
      request({
        invitationId: acceptedResult.invitation.id,
        token: "wrong-token",
        email: acceptedResult.invitation.email
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_token");
    expect(JSON.stringify(payload)).not.toMatch(/wrong-token|tokenHash/i);
  });

  it("returns expired invitation errors safely", async () => {
    stubSessionEnvironment();
    mocks.createDatabaseClient.mockReturnValue({});
    mocks.acceptInvitation.mockRejectedValue(
      new InvitationLifecycleError(
        "expired_invitation",
        "Invitation has expired."
      )
    );

    const response = await POST(
      request({
        invitationId: acceptedResult.invitation.id,
        token: "invite-token",
        email: acceptedResult.invitation.email
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(410);
    expect(payload.error.code).toBe("expired_invitation");
  });

  it("returns not found for missing or cross-organization invitations", async () => {
    stubSessionEnvironment();
    mocks.createDatabaseClient.mockReturnValue({});
    mocks.acceptInvitation.mockRejectedValue(
      new InvitationLifecycleError("not_found", "Invitation was not found.")
    );

    const response = await POST(
      request({
        invitationId: "missing",
        token: "invite-token",
        email: acceptedResult.invitation.email,
        organizationId: "99999999-9999-4999-8999-999999999999"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("not_found");
  });

  it("returns database unavailable when acceptance cannot open the database", async () => {
    stubSessionEnvironment();
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await POST(
      request({
        invitationId: acceptedResult.invitation.id,
        token: "invite-token",
        email: acceptedResult.invitation.email
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("database_unavailable");
    expect(payload.error.message).not.toMatch(/invite-token|tokenHash/i);
  });
});

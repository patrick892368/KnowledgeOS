import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import { InvitationLifecycleError } from "@/invitations/lifecycle";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  persistInvitation: vi.fn()
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

vi.mock("@/db/invitation-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/invitation-repository")>();

  return {
    ...actual,
    persistInvitation: mocks.persistInvitation
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

const persistedInvitation = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: session.organizationId,
  email: "new.member@example.com",
  role: "editor",
  status: "pending",
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  expiresAt: new Date("2026-07-17T00:00:00.000Z")
};

const auditIntent = {
  organizationId: session.organizationId,
  actorUserId: session.userId,
  action: "invitation.planned",
  resourceType: "organization",
  resourceId: session.organizationId,
  metadata: {
    invitationId: persistedInvitation.id,
    email: "new.member@example.com",
    role: "editor",
    status: "pending"
  }
};

const auditEvent = {
  ...auditIntent,
  action: "invitation.created",
  metadata: {
    ...auditIntent.metadata,
    persistenceMode: "created",
    plannedAction: "invitation.planned"
  }
};

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
      mode: string;
    };

    expect(response.status).toBe(201);
    expect(payload.mode).toBe("planned");
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
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.persistInvitation).not.toHaveBeenCalled();
  });

  it("persists a governed invitation when requested", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistInvitation.mockResolvedValue({
      mode: "created",
      invitation: persistedInvitation,
      auditIntent,
      auditEvent
    });

    const response = await POST(
      request({
        email: "New.Member@Example.com",
        role: "editor",
        expiresInDays: 7,
        persist: true
      })
    );
    const payload = (await response.json()) as {
      mode: string;
      invitation: {
        id: string;
        createdAt: string;
        expiresAt: string;
      };
      auditEvent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.mode).toBe("created");
    expect(payload.invitation).toMatchObject({
      id: persistedInvitation.id,
      createdAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2026-07-17T00:00:00.000Z"
    });
    expect(payload.auditEvent).toMatchObject({
      action: "invitation.created",
      metadata: {
        persistenceMode: "created",
        plannedAction: "invitation.planned"
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|password/i);
    expect(mocks.persistInvitation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        session,
        payload: expect.objectContaining({
          email: "new.member@example.com",
          role: "editor"
        })
      })
    );
  });

  it("returns existing mode for duplicate pending invitations", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistInvitation.mockResolvedValue({
      mode: "existing",
      invitation: persistedInvitation,
      auditIntent,
      auditEvent: {
        ...auditEvent,
        action: "invitation.existing",
        metadata: {
          ...auditEvent.metadata,
          persistenceMode: "existing"
        }
      }
    });

    const response = await POST(
      request({
        email: "New.Member@Example.com",
        role: "editor",
        persist: true
      })
    );
    const payload = (await response.json()) as {
      mode: string;
      auditEvent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("existing");
    expect(payload.auditEvent).toMatchObject({
      action: "invitation.existing",
      metadata: {
        persistenceMode: "existing"
      }
    });
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
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.persistInvitation).not.toHaveBeenCalled();
  });

  it("rejects invalid persistence flags before database access", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      request({
        email: "member@example.com",
        role: "viewer",
        persist: "yes"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_payload");
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.persistInvitation).not.toHaveBeenCalled();
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

  it("returns persistence authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistInvitation.mockRejectedValue(
      new InvitationLifecycleError(
        "forbidden",
        "Only owner or admin members can plan organization invitations."
      )
    );

    const response = await POST(
      request({
        email: "member@example.com",
        role: "viewer",
        persist: true
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

  it("returns database unavailable when durable persistence cannot open the database", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await POST(
      request({
        email: "member@example.com",
        role: "viewer",
        persist: true
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("database_unavailable");
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

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import { PermissionGrantManagementError } from "@/permissions/grant-management";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  persistPermissionGrant: vi.fn()
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

vi.mock("@/db/permission-grant-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/permission-grant-repository")>();

  return {
    ...actual,
    persistPermissionGrant: mocks.persistPermissionGrant
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

const persistedGrant = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: session.organizationId,
  subjectType: "role",
  subjectId: "editor",
  resourceType: "workflow",
  resourceId: "workflow_1",
  action: "write",
  createdAt: new Date("2026-07-10T00:00:00.000Z")
};

const auditIntent = {
  organizationId: session.organizationId,
  actorUserId: session.userId,
  action: "permission_grant.planned",
  resourceType: "workflow",
  resourceId: "workflow_1",
  metadata: {
    subjectType: "role",
    subjectId: "editor",
    resourceType: "workflow",
    resourceId: "workflow_1",
    action: "write"
  }
};

const auditEvent = {
  ...auditIntent,
  action: "permission_grant.created",
  metadata: {
    ...auditIntent.metadata,
    grantId: persistedGrant.id,
    persistenceMode: "created",
    plannedAction: "permission_grant.planned"
  }
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
      mode: string;
    };

    expect(response.status).toBe(201);
    expect(payload.mode).toBe("planned");
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
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.persistPermissionGrant).not.toHaveBeenCalled();
  });

  it("persists a governed permission grant when requested", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistPermissionGrant.mockResolvedValue({
      mode: "created",
      grant: persistedGrant,
      auditIntent,
      auditEvent
    });

    const response = await POST(
      request({
        ...grantRequest,
        persist: true
      })
    );
    const payload = (await response.json()) as {
      mode: string;
      grant: {
        id: string;
        createdAt: string;
      };
      auditIntent: {
        action: string;
      };
      auditEvent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.mode).toBe("created");
    expect(payload.grant).toMatchObject({
      id: persistedGrant.id,
      createdAt: "2026-07-10T00:00:00.000Z"
    });
    expect(payload.auditIntent.action).toBe("permission_grant.planned");
    expect(payload.auditEvent).toMatchObject({
      action: "permission_grant.created",
      metadata: {
        grantId: persistedGrant.id,
        persistenceMode: "created",
        plannedAction: "permission_grant.planned"
      }
    });
    expect(mocks.persistPermissionGrant).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        session,
        payload: expect.objectContaining(grantRequest)
      })
    );
  });

  it("returns existing mode for duplicate persisted permission grants", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistPermissionGrant.mockResolvedValue({
      mode: "existing",
      grant: persistedGrant,
      auditIntent,
      auditEvent: {
        ...auditEvent,
        action: "permission_grant.existing",
        metadata: {
          ...auditEvent.metadata,
          persistenceMode: "existing"
        }
      }
    });

    const response = await POST(
      request({
        ...grantRequest,
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
      action: "permission_grant.existing",
      metadata: {
        persistenceMode: "existing"
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
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.persistPermissionGrant).not.toHaveBeenCalled();
  });

  it("rejects invalid persistence flags before database access", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      request({
        ...grantRequest,
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
    expect(mocks.persistPermissionGrant).not.toHaveBeenCalled();
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

  it("returns persistence authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistPermissionGrant.mockRejectedValue(
      new PermissionGrantManagementError(
        "forbidden",
        "Only owner or admin members can manage permission grants."
      )
    );

    const response = await POST(
      request({
        ...grantRequest,
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

  it("returns database unavailable when durable persistence cannot open the database", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await POST(
      request({
        ...grantRequest,
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

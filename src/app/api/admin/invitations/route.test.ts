import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import { InvitationLifecycleError } from "@/invitations/lifecycle";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  listOrganizationInvitations: vi.fn(),
  prepareInvitationResend: vi.fn(),
  revokeInvitation: vi.fn(),
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
    listOrganizationInvitations: mocks.listOrganizationInvitations,
    prepareInvitationResend: mocks.prepareInvitationResend,
    revokeInvitation: mocks.revokeInvitation,
    persistInvitation: mocks.persistInvitation
  };
});

import { DELETE, GET, PATCH, POST } from "./route";

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

function deleteRequest(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/admin/invitations", {
    method: "DELETE",
    body: JSON.stringify(body)
  });
}

function patchRequest(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/admin/invitations", {
    method: "PATCH",
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
  updatedAt: new Date("2026-07-10T00:00:00.000Z"),
  expiresAt: new Date("2026-07-17T00:00:00.000Z"),
  revokedAt: null
};

const revokedInvitation = {
  ...persistedInvitation,
  status: "revoked",
  updatedAt: new Date("2026-07-10T02:00:00.000Z"),
  revokedAt: new Date("2026-07-10T02:00:00.000Z")
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

const deliveryPlan = {
  invitationId: persistedInvitation.id,
  organizationId: session.organizationId,
  email: persistedInvitation.email,
  role: persistedInvitation.role,
  status: "pending",
  acceptanceRoute: "/api/invitations/accept",
  deliveryExpiresAt: new Date("2026-07-10T12:00:00.000Z"),
  invitationExpiresAt: persistedInvitation.expiresAt,
  tokenExposure: "not_exposed",
  auditIntent: {
    organizationId: session.organizationId,
    actorUserId: null,
    action: "invitation.delivery_planned",
    resourceType: "organization",
    resourceId: session.organizationId,
    metadata: {
      invitationId: persistedInvitation.id,
      email: persistedInvitation.email,
      role: persistedInvitation.role,
      deliveryExpiresAt: "2026-07-10T12:00:00.000Z",
      invitationExpiresAt: "2026-07-17T00:00:00.000Z",
      tokenExposure: "not_exposed"
    }
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

describe("GET /api/admin/invitations", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists current-organization invitations for manager sessions", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationInvitations.mockResolvedValue([persistedInvitation]);

    const response = await GET();
    const payload = (await response.json()) as {
      invitations: Array<{
        id: string;
        organizationId: string;
        createdAt: string;
        updatedAt: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.invitations).toEqual([
      expect.objectContaining({
        id: persistedInvitation.id,
        organizationId: session.organizationId,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z"
      })
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|password/i);
    expect(mocks.listOrganizationInvitations).toHaveBeenCalledWith(db, session);
  });

  it("returns list authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationInvitations.mockRejectedValue(
      new InvitationLifecycleError(
        "forbidden",
        "Only owner or admin members can manage organization invitations."
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

  it("returns database unavailable when invitations cannot be listed", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await GET();
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("database_unavailable");
  });
});

describe("PATCH /api/admin/invitations", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prepares a resend delivery plan for manager sessions", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.prepareInvitationResend.mockResolvedValue({
      invitation: persistedInvitation,
      delivery: deliveryPlan,
      auditEvent: {
        ...auditIntent,
        action: "invitation.resend_prepared",
        metadata: {
          invitationId: persistedInvitation.id,
          email: persistedInvitation.email,
          plannedAction: "invitation.delivery_planned",
          tokenExposure: "not_exposed"
        }
      }
    });

    const response = await PATCH(
      patchRequest({
        invitationId: persistedInvitation.id,
        deliveryTtlHours: 12
      })
    );
    const payload = (await response.json()) as {
      mode: string;
      delivery: {
        invitationId: string;
        deliveryExpiresAt: string;
        tokenExposure: string;
        auditIntent: {
          action: string;
        };
      };
      auditEvent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("resend_prepared");
    expect(payload.delivery).toMatchObject({
      invitationId: persistedInvitation.id,
      deliveryExpiresAt: "2026-07-10T12:00:00.000Z",
      tokenExposure: "not_exposed",
      auditIntent: {
        action: "invitation.delivery_planned"
      }
    });
    expect(payload.auditEvent).toMatchObject({
      action: "invitation.resend_prepared",
      metadata: {
        invitationId: persistedInvitation.id,
        plannedAction: "invitation.delivery_planned",
        tokenExposure: "not_exposed"
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /rawToken|tokenHash|resend-token|secret|password/i
    );
    expect(mocks.prepareInvitationResend).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        session,
        invitationId: persistedInvitation.id,
        deliveryTtlHours: 12
      })
    );
  });

  it("rejects invalid resend payloads before database access", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await PATCH(patchRequest({ deliveryTtlHours: 12 }));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_payload");
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.prepareInvitationResend).not.toHaveBeenCalled();
  });

  it("returns resend authorization and not-found failures safely", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.prepareInvitationResend.mockRejectedValue(
      new InvitationLifecycleError(
        "not_found",
        "Invitation was not found."
      )
    );

    const response = await PATCH(
      patchRequest({
        invitationId: "99999999-9999-4999-8999-999999999999"
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

  it("returns forbidden resend preparation failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue({
      ...session,
      role: "viewer"
    });
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.prepareInvitationResend.mockRejectedValue(
      new InvitationLifecycleError(
        "forbidden",
        "Only owner or admin members can manage organization invitations."
      )
    );

    const response = await PATCH(
      patchRequest({
        invitationId: persistedInvitation.id
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

  it("returns unsafe invitation status failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.prepareInvitationResend.mockRejectedValue(
      new InvitationLifecycleError(
        "accepted_invitation",
        "Accepted invitations cannot be delivered again."
      )
    );

    const response = await PATCH(
      patchRequest({
        invitationId: persistedInvitation.id
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(410);
    expect(payload.error.code).toBe("accepted_invitation");
  });

  it("returns database unavailable when resend preparation cannot open the database", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await PATCH(
      patchRequest({
        invitationId: persistedInvitation.id
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

  it("rejects unauthenticated resend preparation requests", async () => {
    mocks.requireSession.mockRejectedValue(
      new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    );

    const response = await PATCH(
      patchRequest({
        invitationId: persistedInvitation.id
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

describe("DELETE /api/admin/invitations", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("revokes a current-organization pending invitation", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.revokeInvitation.mockResolvedValue({
      invitation: revokedInvitation,
      auditEvent: {
        ...auditIntent,
        action: "invitation.revoked",
        metadata: {
          invitationId: persistedInvitation.id,
          email: persistedInvitation.email,
          previousStatus: "pending",
          nextStatus: "revoked"
        }
      }
    });

    const response = await DELETE(
      deleteRequest({
        invitationId: persistedInvitation.id
      })
    );
    const payload = (await response.json()) as {
      invitation: {
        id: string;
        status: string;
        revokedAt: string;
      };
      auditEvent: {
        action: string;
        metadata: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.invitation).toMatchObject({
      id: persistedInvitation.id,
      status: "revoked",
      revokedAt: "2026-07-10T02:00:00.000Z"
    });
    expect(payload.auditEvent).toMatchObject({
      action: "invitation.revoked",
      metadata: {
        invitationId: persistedInvitation.id,
        nextStatus: "revoked"
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|secret|password/i);
    expect(mocks.revokeInvitation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        session,
        invitationId: persistedInvitation.id
      })
    );
  });

  it("rejects invalid revocation payloads before database access", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await DELETE(deleteRequest({}));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_payload");
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
  });

  it("returns not found for missing, cross-organization, or non-pending invitations", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.revokeInvitation.mockRejectedValue(
      new InvitationLifecycleError(
        "not_found",
        "Pending invitation was not found."
      )
    );

    const response = await DELETE(
      deleteRequest({
        invitationId: "99999999-9999-4999-8999-999999999999"
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

  it("returns database unavailable when revocation cannot open the database", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await DELETE(
      deleteRequest({
        invitationId: persistedInvitation.id
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
});

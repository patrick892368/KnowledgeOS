import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { createInvitationAcceptancePlan } from "@/invitations/acceptance";
import { InvitationLifecycleError } from "@/invitations/lifecycle";

import type { Database } from "./client";
import {
  acceptInvitation,
  createInvitationPersistenceAuditEvent,
  createInvitationResendAuditEvent,
  createInvitationRevocationAuditEvent,
  createInvitationTokenRotationAuditEvent,
  hashInvitationToken,
  listOrganizationInvitations,
  prepareInvitationResend,
  rotateInvitationDeliveryToken,
  revokeInvitation,
  persistInvitation
} from "./invitation-repository";
import { auditEvents, invitations, memberships, users } from "./schema";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const invitationPayload = {
  email: "member@example.com",
  role: "editor" as const,
  expiresInDays: 7
};

const invitationRow = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: ownerSession.organizationId,
  email: "member@example.com",
  role: "editor" as const,
  status: "pending" as const,
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  updatedAt: new Date("2026-07-10T00:00:00.000Z"),
  expiresAt: new Date("2026-07-17T00:00:00.000Z"),
  revokedAt: null
};

const revokedInvitationRow = {
  ...invitationRow,
  status: "revoked" as const,
  updatedAt: new Date("2026-07-10T02:00:00.000Z"),
  revokedAt: new Date("2026-07-10T02:00:00.000Z")
};

const acceptedInvitationRow = {
  ...invitationRow,
  status: "accepted" as const,
  updatedAt: new Date("2026-07-10T03:00:00.000Z"),
  acceptedAt: new Date("2026-07-10T03:00:00.000Z")
};

const acceptanceCandidate = {
  ...invitationRow,
  tokenHash: hashInvitationToken("invite-token")
};

const acceptedUserRow = {
  id: "55555555-5555-4555-8555-555555555555",
  email: invitationRow.email,
  name: "member"
};

const acceptedMembershipRow = {
  id: "66666666-6666-4666-8666-666666666666",
  organizationId: ownerSession.organizationId,
  userId: acceptedUserRow.id,
  role: invitationRow.role,
  createdAt: new Date("2026-07-10T03:00:00.000Z"),
  updatedAt: new Date("2026-07-10T03:00:00.000Z")
};

function createDatabaseDouble(input: {
  insertedRows: unknown[];
  existingRows?: unknown[];
}) {
  const auditWrites: unknown[] = [];
  const insertReturning = vi.fn(async () => input.insertedRows);
  const onConflictDoNothing = vi.fn(() => ({
    returning: insertReturning
  }));
  const invitationValues = vi.fn(() => ({
    onConflictDoNothing
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const limit = vi.fn(async () => input.existingRows ?? []);
  const where = vi.fn(() => ({
    limit
  }));
  const from = vi.fn(() => ({
    where
  }));
  const select = vi.fn(() => ({
    from
  }));
  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === invitations) {
        return {
          values: invitationValues
        };
      }

      if (table === auditEvents) {
        return {
          values: auditValues
        };
      }

      throw new Error("Unexpected insert table.");
    }),
    select
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    auditWrites,
    invitationValues,
    select
  };
}

function createListDatabaseDouble(rows: unknown[]) {
  const orderBy = vi.fn(async () => rows);
  const where = vi.fn(() => ({
    orderBy
  }));
  const from = vi.fn(() => ({
    where
  }));
  const select = vi.fn(() => ({
    from
  }));

  return {
    db: {
      select
    } as unknown as Database,
    select,
    where,
    orderBy
  };
}

function createRevocationDatabaseDouble(rows: unknown[]) {
  const auditWrites: unknown[] = [];
  const updateReturning = vi.fn(async () => rows);
  const updateWhere = vi.fn(() => ({
    returning: updateReturning
  }));
  const updateSet = vi.fn(() => ({
    where: updateWhere
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const tx = {
    update: vi.fn((table: unknown) => {
      if (table !== invitations) {
        throw new Error("Unexpected update table.");
      }

      return {
        set: updateSet
      };
    }),
    insert: vi.fn((table: unknown) => {
      if (table !== auditEvents) {
        throw new Error("Unexpected insert table.");
      }

      return {
        values: auditValues
      };
    })
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    auditWrites,
    auditValues,
    updateReturning,
    updateSet
  };
}

function createResendDatabaseDouble(rows: unknown[]) {
  const auditWrites: unknown[] = [];
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({
    limit
  }));
  const from = vi.fn(() => ({
    where
  }));
  const select = vi.fn(() => ({
    from
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const tx = {
    select,
    insert: vi.fn((table: unknown) => {
      if (table !== auditEvents) {
        throw new Error("Unexpected insert table.");
      }

      return {
        values: auditValues
      };
    })
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    auditWrites,
    auditValues,
    select
  };
}

function createRotationDatabaseDouble(input: {
  invitationRows: unknown[];
  updatedRows: unknown[];
}) {
  const auditWrites: unknown[] = [];
  const selectLimit = vi.fn(async () => input.invitationRows);
  const selectWhere = vi.fn(() => ({
    limit: selectLimit
  }));
  const selectFrom = vi.fn(() => ({
    where: selectWhere
  }));
  const select = vi.fn(() => ({
    from: selectFrom
  }));
  const updateReturning = vi.fn(async () => input.updatedRows);
  const updateWhere = vi.fn(() => ({
    returning: updateReturning
  }));
  const updateSet = vi.fn(() => ({
    where: updateWhere
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const tx = {
    select,
    update: vi.fn((table: unknown) => {
      if (table !== invitations) {
        throw new Error("Unexpected update table.");
      }

      return {
        set: updateSet
      };
    }),
    insert: vi.fn((table: unknown) => {
      if (table !== auditEvents) {
        throw new Error("Unexpected insert table.");
      }

      return {
        values: auditValues
      };
    })
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    auditWrites,
    auditValues,
    updateReturning,
    updateSet
  };
}

function createAcceptanceDatabaseDouble(input: {
  invitationRows: unknown[];
  insertedUserRows: unknown[];
  existingUserRows?: unknown[];
  membershipRows: unknown[];
  acceptedInvitationRows: unknown[];
}) {
  const auditWrites: unknown[] = [];
  const userReturning = vi.fn(async () => input.insertedUserRows);
  const userOnConflictDoNothing = vi.fn(() => ({
    returning: userReturning
  }));
  const userValues = vi.fn(() => ({
    onConflictDoNothing: userOnConflictDoNothing
  }));
  const membershipReturning = vi.fn(async () => input.membershipRows);
  const membershipOnConflictDoUpdate = vi.fn(() => ({
    returning: membershipReturning
  }));
  const membershipValues = vi.fn(() => ({
    onConflictDoUpdate: membershipOnConflictDoUpdate
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const limit = vi.fn(async () => input.existingUserRows ?? []);
  const where = vi.fn(() => ({
    limit
  }));
  const from = vi.fn((table: unknown) => {
    if (table === invitations) {
      return {
        where: vi.fn(() => ({
          limit: vi.fn(async () => input.invitationRows)
        }))
      };
    }

    return {
      where
    };
  });
  const select = vi.fn(() => ({
    from
  }));
  const updateReturning = vi.fn(async () => input.acceptedInvitationRows);
  const updateWhere = vi.fn(() => ({
    returning: updateReturning
  }));
  const updateSet = vi.fn(() => ({
    where: updateWhere
  }));
  const tx = {
    select,
    insert: vi.fn((table: unknown) => {
      if (table === users) {
        return {
          values: userValues
        };
      }

      if (table === memberships) {
        return {
          values: membershipValues
        };
      }

      if (table === auditEvents) {
        return {
          values: auditValues
        };
      }

      throw new Error("Unexpected insert table.");
    }),
    update: vi.fn((table: unknown) => {
      if (table !== invitations) {
        throw new Error("Unexpected update table.");
      }

      return {
        set: updateSet
      };
    })
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    auditWrites,
    userValues,
    membershipValues,
    updateSet,
    select
  };
}

describe("hashInvitationToken", () => {
  it("hashes invitation tokens without exposing the raw token", () => {
    const hash = hashInvitationToken("invite-token");

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("invite-token");
  });
});

describe("createInvitationPersistenceAuditEvent", () => {
  it("preserves planned audit intent while recording persistence mode", () => {
    const event = createInvitationPersistenceAuditEvent({
      mode: "created",
      plan: {
        ...invitationRow,
        auditIntent: {
          organizationId: ownerSession.organizationId,
          actorUserId: ownerSession.userId,
          action: "invitation.planned",
          resourceType: "organization",
          resourceId: ownerSession.organizationId,
          metadata: {
            invitationId: invitationRow.id,
            email: invitationRow.email
          }
        }
      }
    });

    expect(event).toMatchObject({
      action: "invitation.created",
      metadata: {
        invitationId: invitationRow.id,
        email: invitationRow.email,
        persistenceMode: "created",
        plannedAction: "invitation.planned"
      }
    });
  });
});

describe("createInvitationRevocationAuditEvent", () => {
  it("records revocation metadata without exposing token material", () => {
    const event = createInvitationRevocationAuditEvent({
      session: ownerSession,
      invitation: invitationRow,
      now: new Date("2026-07-10T02:00:00.000Z")
    });

    expect(event).toMatchObject({
      action: "invitation.revoked",
      resourceType: "organization",
      resourceId: ownerSession.organizationId,
      metadata: {
        invitationId: invitationRow.id,
        email: "member@example.com",
        role: "editor",
        previousStatus: "pending",
        nextStatus: "revoked",
        revokedAt: "2026-07-10T02:00:00.000Z"
      }
    });
    expect(JSON.stringify(event)).not.toMatch(/token|secret|password/i);
  });
});

describe("createInvitationResendAuditEvent", () => {
  it("records resend preparation metadata without exposing delivery secrets", () => {
    const event = createInvitationResendAuditEvent({
      session: ownerSession,
      delivery: {
        invitationId: invitationRow.id,
        organizationId: ownerSession.organizationId,
        email: invitationRow.email,
        role: invitationRow.role,
        status: "pending",
        acceptanceRoute: "/api/invitations/accept",
        deliveryExpiresAt: new Date("2026-07-10T12:00:00.000Z"),
        invitationExpiresAt: invitationRow.expiresAt,
        tokenExposure: "not_exposed",
        auditIntent: {
          organizationId: ownerSession.organizationId,
          actorUserId: null,
          action: "invitation.delivery_planned",
          resourceType: "organization",
          resourceId: ownerSession.organizationId,
          metadata: {
            invitationId: invitationRow.id,
            email: invitationRow.email,
            tokenExposure: "not_exposed"
          }
        }
      }
    });

    expect(event).toMatchObject({
      action: "invitation.resend_prepared",
      actorUserId: ownerSession.userId,
      metadata: {
        invitationId: invitationRow.id,
        email: invitationRow.email,
        plannedAction: "invitation.delivery_planned",
        tokenExposure: "not_exposed"
      }
    });
    expect(JSON.stringify(event)).not.toMatch(/rawToken|tokenHash|secret/i);
  });
});

describe("createInvitationTokenRotationAuditEvent", () => {
  it("records token-safe rotation metadata", () => {
    const event = createInvitationTokenRotationAuditEvent({
      session: ownerSession,
      delivery: {
        invitationId: invitationRow.id,
        organizationId: ownerSession.organizationId,
        email: invitationRow.email,
        role: invitationRow.role,
        status: "pending",
        acceptanceRoute: "/api/invitations/accept",
        deliveryExpiresAt: new Date("2026-07-11T12:00:00.000Z"),
        invitationExpiresAt: invitationRow.expiresAt,
        tokenExposure: "not_exposed",
        auditIntent: {
          organizationId: ownerSession.organizationId,
          actorUserId: null,
          action: "invitation.delivery_planned",
          resourceType: "organization",
          resourceId: ownerSession.organizationId,
          metadata: {
            invitationId: invitationRow.id,
            tokenExposure: "not_exposed"
          }
        }
      },
      rotatedAt: new Date("2026-07-11T00:00:00.000Z")
    });

    expect(event).toMatchObject({
      action: "invitation.delivery_token_rotated",
      actorUserId: ownerSession.userId,
      metadata: {
        invitationId: invitationRow.id,
        plannedAction: "invitation.delivery_planned",
        rotatedAt: "2026-07-11T00:00:00.000Z",
        previousTokenInvalidated: true,
        tokenExposure: "not_exposed"
      }
    });
    expect(JSON.stringify(event)).not.toMatch(/rawToken|tokenHash|secret/i);
  });
});

describe("persistInvitation", () => {
  it("inserts a validated invitation and writes a create audit event", async () => {
    const db = createDatabaseDouble({
      insertedRows: [invitationRow]
    });

    const result = await persistInvitation(db.db, {
      session: ownerSession,
      payload: invitationPayload,
      now: invitationRow.createdAt,
      token: "invite-token"
    });

    expect(result).toMatchObject({
      mode: "created",
      invitation: invitationRow,
      auditIntent: {
        action: "invitation.planned"
      },
      auditEvent: {
        action: "invitation.created",
        metadata: {
          invitationId: invitationRow.id,
          persistenceMode: "created",
          plannedAction: "invitation.planned"
        }
      }
    });
    expect(db.invitationValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ownerSession.organizationId,
        email: "member@example.com",
        role: "editor",
        status: "pending",
        tokenHash: hashInvitationToken("invite-token"),
        invitedBy: ownerSession.userId
      })
    );
    expect(JSON.stringify(result)).not.toMatch(/invite-token|tokenHash/i);
  });

  it("handles duplicate pending invitations idempotently", async () => {
    const db = createDatabaseDouble({
      insertedRows: [],
      existingRows: [invitationRow]
    });

    const result = await persistInvitation(db.db, {
      session: ownerSession,
      payload: invitationPayload,
      now: new Date("2026-07-10T01:00:00.000Z")
    });

    expect(result).toMatchObject({
      mode: "existing",
      invitation: invitationRow,
      auditEvent: {
        action: "invitation.existing",
        metadata: {
          invitationId: invitationRow.id,
          persistenceMode: "existing"
        }
      }
    });
    expect(db.select).toHaveBeenCalled();
  });

  it("rejects non-manager sessions before opening a transaction", async () => {
    const db = createDatabaseDouble({
      insertedRows: []
    });

    await expect(
      persistInvitation(db.db, {
        session: {
          ...ownerSession,
          role: "viewer"
        },
        payload: invitationPayload
      })
    ).rejects.toThrow(InvitationLifecycleError);
    expect(db.invitationValues).not.toHaveBeenCalled();
  });
});

describe("prepareInvitationResend", () => {
  it("prepares a public delivery plan and writes a resend audit event", async () => {
    const db = createResendDatabaseDouble([invitationRow]);

    const result = await prepareInvitationResend(db.db, {
      session: ownerSession,
      invitationId: invitationRow.id,
      now: new Date("2026-07-10T00:00:00.000Z"),
      deliveryTtlHours: 12,
      rawToken: "resend-token"
    });

    expect(result).toMatchObject({
      invitation: invitationRow,
      delivery: {
        invitationId: invitationRow.id,
        organizationId: ownerSession.organizationId,
        email: invitationRow.email,
        role: invitationRow.role,
        status: "pending",
        acceptanceRoute: "/api/invitations/accept",
        deliveryExpiresAt: new Date("2026-07-10T12:00:00.000Z"),
        invitationExpiresAt: invitationRow.expiresAt,
        tokenExposure: "not_exposed",
        auditIntent: {
          action: "invitation.delivery_planned"
        }
      },
      auditEvent: {
        action: "invitation.resend_prepared",
        actorUserId: ownerSession.userId,
        metadata: {
          invitationId: invitationRow.id,
          plannedAction: "invitation.delivery_planned",
          tokenExposure: "not_exposed"
        }
      }
    });
    expect(db.auditWrites).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(
      /resend-token|rawToken|tokenHash|secret/i
    );
  });

  it("rejects non-manager resend preparation before opening a transaction", async () => {
    const db = {
      transaction: vi.fn()
    } as unknown as Database;

    await expect(
      prepareInvitationResend(db, {
        session: {
          ...ownerSession,
          role: "viewer"
        },
        invitationId: invitationRow.id
      })
    ).rejects.toMatchObject({
      code: "forbidden"
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns not found for missing or cross-organization invitations", async () => {
    const db = createResendDatabaseDouble([]);

    await expect(
      prepareInvitationResend(db.db, {
        session: ownerSession,
        invitationId: "99999999-9999-4999-8999-999999999999"
      })
    ).rejects.toMatchObject({
      code: "not_found"
    });
    expect(db.auditValues).not.toHaveBeenCalled();
  });

  it("rejects accepted, revoked, and expired invitations without audit writes", async () => {
    for (const [row, code] of [
      [acceptedInvitationRow, "accepted_invitation"],
      [revokedInvitationRow, "revoked_invitation"],
      [
        {
          ...invitationRow,
          expiresAt: new Date("2026-07-09T23:59:59.000Z")
        },
        "expired_invitation"
      ]
    ] as const) {
      const db = createResendDatabaseDouble([row]);

      await expect(
        prepareInvitationResend(db.db, {
          session: ownerSession,
          invitationId: invitationRow.id,
          now: new Date("2026-07-10T00:00:00.000Z"),
          rawToken: "resend-token"
        })
      ).rejects.toMatchObject({
        code
      });
      expect(db.auditValues).not.toHaveBeenCalled();
    }
  });
});

describe("rotateInvitationDeliveryToken", () => {
  const rotatedAt = new Date("2026-07-11T00:00:00.000Z");
  const rotatedInvitationRow = {
    ...invitationRow,
    updatedAt: rotatedAt
  };

  it("rotates the token hash and writes a token-safe audit event", async () => {
    const db = createRotationDatabaseDouble({
      invitationRows: [invitationRow],
      updatedRows: [rotatedInvitationRow]
    });

    const result = await rotateInvitationDeliveryToken(db.db, {
      session: ownerSession,
      invitationId: invitationRow.id,
      now: rotatedAt,
      deliveryTtlHours: 12,
      rawToken: "rotated-delivery-token"
    });

    expect(db.updateSet).toHaveBeenCalledWith({
      tokenHash: hashInvitationToken("rotated-delivery-token"),
      updatedAt: rotatedAt
    });
    expect(result).toMatchObject({
      invitation: rotatedInvitationRow,
      delivery: {
        publicPlan: {
          invitationId: invitationRow.id,
          deliveryExpiresAt: new Date("2026-07-11T12:00:00.000Z"),
          tokenExposure: "not_exposed"
        },
        secret: {
          rawToken: "rotated-delivery-token",
          tokenHash: hashInvitationToken("rotated-delivery-token")
        }
      },
      auditEvent: {
        action: "invitation.delivery_token_rotated",
        metadata: {
          invitationId: invitationRow.id,
          previousTokenInvalidated: true,
          tokenExposure: "not_exposed"
        }
      }
    });
    expect(db.auditWrites).toHaveLength(1);
    expect(
      JSON.stringify({
        invitation: result.invitation,
        delivery: result.delivery.publicPlan,
        auditEvent: result.auditEvent
      })
    ).not.toMatch(/rotated-delivery-token|tokenHash|rawToken|secret/i);
  });

  it("keeps the rotated token acceptance-compatible and invalidates the prior token", async () => {
    const db = createRotationDatabaseDouble({
      invitationRows: [invitationRow],
      updatedRows: [rotatedInvitationRow]
    });
    const result = await rotateInvitationDeliveryToken(db.db, {
      session: ownerSession,
      invitationId: invitationRow.id,
      now: rotatedAt,
      rawToken: "new-invitation-token"
    });
    const target = {
      ...invitationRow,
      tokenHash: result.delivery.secret.tokenHash
    };

    expect(
      createInvitationAcceptancePlan({
        payload: {
          invitationId: invitationRow.id,
          token: "new-invitation-token",
          email: invitationRow.email
        },
        target,
        now: new Date("2026-07-11T01:00:00.000Z")
      })
    ).toMatchObject({
      invitationId: invitationRow.id,
      nextStatus: "accepted"
    });
    expect(() =>
      createInvitationAcceptancePlan({
        payload: {
          invitationId: invitationRow.id,
          token: "invite-token",
          email: invitationRow.email
        },
        target,
        now: new Date("2026-07-11T01:00:00.000Z")
      })
    ).toThrow(InvitationLifecycleError);
  });

  it("rejects non-managers before opening a transaction", async () => {
    const db = {
      transaction: vi.fn()
    } as unknown as Database;

    await expect(
      rotateInvitationDeliveryToken(db, {
        session: {
          ...ownerSession,
          role: "viewer"
        },
        invitationId: invitationRow.id
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("hides missing and concurrently changed invitations without audit writes", async () => {
    for (const input of [
      { invitationRows: [], updatedRows: [] },
      { invitationRows: [invitationRow], updatedRows: [] }
    ]) {
      const db = createRotationDatabaseDouble(input);

      await expect(
        rotateInvitationDeliveryToken(db.db, {
          session: ownerSession,
          invitationId: invitationRow.id,
          now: rotatedAt,
          rawToken: "rotated-delivery-token"
        })
      ).rejects.toMatchObject({ code: "not_found" });
      expect(db.auditValues).not.toHaveBeenCalled();
    }
  });

  it("rejects accepted, revoked, and expired invitations before mutation", async () => {
    for (const [row, code] of [
      [acceptedInvitationRow, "accepted_invitation"],
      [revokedInvitationRow, "revoked_invitation"],
      [
        {
          ...invitationRow,
          expiresAt: new Date("2026-07-10T23:59:59.000Z")
        },
        "expired_invitation"
      ]
    ] as const) {
      const db = createRotationDatabaseDouble({
        invitationRows: [row],
        updatedRows: []
      });

      await expect(
        rotateInvitationDeliveryToken(db.db, {
          session: ownerSession,
          invitationId: invitationRow.id,
          now: rotatedAt,
          rawToken: "rotated-delivery-token"
        })
      ).rejects.toMatchObject({ code });
      expect(db.updateSet).not.toHaveBeenCalled();
      expect(db.auditValues).not.toHaveBeenCalled();
    }
  });
});

describe("invitation listing and revocation authorization", () => {
  it("lists organization invitations for manager sessions", async () => {
    const db = createListDatabaseDouble([invitationRow]);

    const result = await listOrganizationInvitations(db.db, ownerSession);

    expect(result).toEqual([invitationRow]);
    expect(db.select).toHaveBeenCalled();
    expect(db.where).toHaveBeenCalled();
    expect(db.orderBy).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password/i);
  });

  it("rejects non-manager list requests before querying the database", async () => {
    const db = createListDatabaseDouble([]);

    await expect(
      listOrganizationInvitations(db.db, {
        ...ownerSession,
        role: "viewer"
      })
    ).rejects.toThrow(InvitationLifecycleError);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("soft-revokes a pending invitation and writes an audit event", async () => {
    const db = createRevocationDatabaseDouble([revokedInvitationRow]);

    const result = await revokeInvitation(db.db, {
      session: ownerSession,
      invitationId: invitationRow.id,
      now: revokedInvitationRow.revokedAt
    });

    expect(result).toMatchObject({
      invitation: revokedInvitationRow,
      auditEvent: {
        action: "invitation.revoked",
        metadata: {
          invitationId: invitationRow.id,
          email: "member@example.com",
          previousStatus: "pending",
          nextStatus: "revoked"
        }
      }
    });
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "revoked",
        revokedAt: revokedInvitationRow.revokedAt,
        updatedAt: revokedInvitationRow.revokedAt
      })
    );
    expect(db.auditWrites).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/token|secret|password/i);
  });

  it("rejects non-manager revoke requests before opening a transaction", async () => {
    const db = {
      transaction: vi.fn()
    } as unknown as Database;

    await expect(
      revokeInvitation(db, {
        session: {
          ...ownerSession,
          role: "viewer"
        },
        invitationId: invitationRow.id
      })
    ).rejects.toThrow(InvitationLifecycleError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns not found when no pending invitation can be revoked", async () => {
    const db = createRevocationDatabaseDouble([]);

    await expect(
      revokeInvitation(db.db, {
        session: ownerSession,
        invitationId: "99999999-9999-4999-8999-999999999999"
      })
    ).rejects.toMatchObject({
      code: "not_found"
    });
    expect(db.auditValues).not.toHaveBeenCalled();
  });
});

describe("acceptInvitation", () => {
  it("accepts a pending invitation and writes membership plus audit event", async () => {
    const db = createAcceptanceDatabaseDouble({
      invitationRows: [acceptanceCandidate],
      insertedUserRows: [acceptedUserRow],
      membershipRows: [acceptedMembershipRow],
      acceptedInvitationRows: [acceptedInvitationRow]
    });

    const result = await acceptInvitation(db.db, {
      payload: {
        invitationId: invitationRow.id,
        token: "invite-token",
        email: invitationRow.email,
        organizationId: ownerSession.organizationId
      },
      now: acceptedInvitationRow.acceptedAt
    });

    expect(result).toMatchObject({
      invitation: acceptedInvitationRow,
      user: acceptedUserRow,
      membership: acceptedMembershipRow,
      session: {
        userId: acceptedUserRow.id,
        organizationId: ownerSession.organizationId,
        membershipId: acceptedMembershipRow.id,
        role: invitationRow.role,
        email: invitationRow.email,
        name: acceptedUserRow.name
      },
      auditEvent: {
        action: "invitation.accepted",
        actorUserId: acceptedUserRow.id,
        metadata: {
          invitationId: invitationRow.id,
          membershipId: acceptedMembershipRow.id,
          userId: acceptedUserRow.id,
          previousStatus: "pending",
          nextStatus: "accepted",
          plannedAction: "invitation.acceptance_planned"
        }
      }
    });
    expect(db.userValues).toHaveBeenCalledWith(
      expect.objectContaining({
        email: invitationRow.email,
        metadata: {
          invitationAccepted: true
        }
      })
    );
    expect(db.membershipValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ownerSession.organizationId,
        userId: acceptedUserRow.id,
        role: invitationRow.role
      })
    );
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        acceptedAt: acceptedInvitationRow.acceptedAt,
        updatedAt: acceptedInvitationRow.acceptedAt
      })
    );
    expect(db.auditWrites).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/invite-token|tokenHash/i);
  });

  it("resolves existing users and upserts duplicate memberships", async () => {
    const db = createAcceptanceDatabaseDouble({
      invitationRows: [acceptanceCandidate],
      insertedUserRows: [],
      existingUserRows: [acceptedUserRow],
      membershipRows: [acceptedMembershipRow],
      acceptedInvitationRows: [acceptedInvitationRow]
    });

    const result = await acceptInvitation(db.db, {
      payload: {
        invitationId: invitationRow.id,
        token: "invite-token",
        email: invitationRow.email
      },
      now: acceptedInvitationRow.acceptedAt
    });

    expect(result.user).toEqual(acceptedUserRow);
    expect(result.membership).toEqual(acceptedMembershipRow);
    expect(db.select).toHaveBeenCalled();
  });

  it("rejects missing invitations before writing users or memberships", async () => {
    const db = createAcceptanceDatabaseDouble({
      invitationRows: [],
      insertedUserRows: [],
      membershipRows: [],
      acceptedInvitationRows: []
    });

    await expect(
      acceptInvitation(db.db, {
        payload: {
          invitationId: "missing",
          token: "invite-token",
          email: invitationRow.email
        }
      })
    ).rejects.toMatchObject({
      code: "not_found"
    });
    expect(db.userValues).not.toHaveBeenCalled();
    expect(db.membershipValues).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens before mutating invitation state", async () => {
    const db = createAcceptanceDatabaseDouble({
      invitationRows: [acceptanceCandidate],
      insertedUserRows: [],
      membershipRows: [],
      acceptedInvitationRows: []
    });

    await expect(
      acceptInvitation(db.db, {
        payload: {
          invitationId: invitationRow.id,
          token: "wrong-token",
          email: invitationRow.email
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_token"
    });
    expect(db.userValues).not.toHaveBeenCalled();
    expect(db.updateSet).not.toHaveBeenCalled();
  });
});

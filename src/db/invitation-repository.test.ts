import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { InvitationLifecycleError } from "@/invitations/lifecycle";

import type { Database } from "./client";
import {
  createInvitationPersistenceAuditEvent,
  hashInvitationToken,
  persistInvitation
} from "./invitation-repository";
import { auditEvents, invitations } from "./schema";

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
  expiresAt: new Date("2026-07-17T00:00:00.000Z")
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

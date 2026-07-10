import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { PermissionGrantManagementError } from "@/permissions/grant-management";

import type { Database } from "./client";
import {
  createPermissionGrantPersistenceAuditEvent,
  persistPermissionGrant
} from "./permission-grant-repository";
import { auditEvents, permissionGrants } from "./schema";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const grantPayload = {
  subjectType: "role" as const,
  subjectId: "editor",
  resourceType: "workflow" as const,
  resourceId: "workflow_1",
  action: "write" as const
};

const grantRow = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: ownerSession.organizationId,
  subjectType: "role" as const,
  subjectId: "editor",
  resourceType: "workflow" as const,
  resourceId: "workflow_1",
  action: "write" as const,
  createdAt: new Date("2026-07-10T00:00:00.000Z")
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
  const grantValues = vi.fn(() => ({
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
      if (table === permissionGrants) {
        return {
          values: grantValues
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
    grantValues,
    auditValues,
    insertReturning,
    onConflictDoNothing,
    select
  };
}

describe("createPermissionGrantPersistenceAuditEvent", () => {
  it("preserves planned audit intent while recording persistence mode", () => {
    const plannedAt = new Date("2026-07-10T00:00:00.000Z");
    const event = createPermissionGrantPersistenceAuditEvent({
      mode: "created",
      grantId: grantRow.id,
      plan: {
        ...grantPayload,
        organizationId: ownerSession.organizationId,
        createdAt: plannedAt,
        auditIntent: {
          organizationId: ownerSession.organizationId,
          actorUserId: ownerSession.userId,
          action: "permission_grant.planned",
          resourceType: "workflow",
          resourceId: "workflow_1",
          metadata: {
            plannedAt: plannedAt.toISOString()
          }
        }
      }
    });

    expect(event).toMatchObject({
      action: "permission_grant.created",
      metadata: {
        grantId: grantRow.id,
        persistenceMode: "created",
        plannedAction: "permission_grant.planned",
        plannedAt: "2026-07-10T00:00:00.000Z"
      }
    });
  });
});

describe("persistPermissionGrant", () => {
  it("inserts a validated permission grant and writes a create audit event", async () => {
    const db = createDatabaseDouble({
      insertedRows: [grantRow]
    });

    const result = await persistPermissionGrant(db.db, {
      session: ownerSession,
      payload: grantPayload,
      now: grantRow.createdAt
    });

    expect(result).toMatchObject({
      mode: "created",
      grant: grantRow,
      auditIntent: {
        action: "permission_grant.planned"
      },
      auditEvent: {
        action: "permission_grant.created",
        metadata: {
          grantId: grantRow.id,
          persistenceMode: "created",
          plannedAction: "permission_grant.planned"
        }
      }
    });
    expect(db.grantValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ownerSession.organizationId,
        subjectType: "role",
        subjectId: "editor",
        resourceType: "workflow",
        resourceId: "workflow_1",
        action: "write",
        createdAt: grantRow.createdAt
      })
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(db.auditWrites).toHaveLength(1);
  });

  it("handles duplicate permission grants idempotently", async () => {
    const db = createDatabaseDouble({
      insertedRows: [],
      existingRows: [grantRow]
    });

    const result = await persistPermissionGrant(db.db, {
      session: ownerSession,
      payload: grantPayload,
      now: new Date("2026-07-10T01:00:00.000Z")
    });

    expect(result).toMatchObject({
      mode: "existing",
      grant: grantRow,
      auditEvent: {
        action: "permission_grant.existing",
        metadata: {
          grantId: grantRow.id,
          persistenceMode: "existing"
        }
      }
    });
    expect(db.select).toHaveBeenCalled();
    expect(db.auditWrites).toHaveLength(1);
  });

  it("rejects non-manager sessions before opening a transaction", async () => {
    const db = createDatabaseDouble({
      insertedRows: []
    });

    await expect(
      persistPermissionGrant(db.db, {
        session: {
          ...ownerSession,
          role: "viewer"
        },
        payload: grantPayload
      })
    ).rejects.toThrow(PermissionGrantManagementError);

    expect(db.grantValues).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { createInvitationDeliveryPlan } from "@/invitations/delivery";
import type { PublicInvitationEmailReceipt } from "@/invitations/email-provider.server";

import type { Database } from "./client";
import {
  InvitationDeliveryAttemptError,
  listOrganizationInvitationDeliveryAttempts,
  markInvitationDeliveryAttemptProviderAccepted,
  markInvitationDeliveryAttemptProviderFailed,
  persistInvitationDeliveryAttempt
} from "./invitation-delivery-attempt-repository";
import {
  auditEvents,
  invitationDeliveryAttempts,
  invitations
} from "./schema";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const preparedAt = new Date("2026-07-11T00:00:00.000Z");
const deliveryExpiresAt = new Date("2026-07-12T00:00:00.000Z");
const invitationExpiresAt = new Date("2026-07-18T00:00:00.000Z");
const attemptId = "77777777-7777-4777-8777-777777777777";
const invitationRow = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: ownerSession.organizationId,
  email: "member@example.com",
  role: "editor" as const,
  status: "pending" as const,
  expiresAt: invitationExpiresAt
};
const delivery = createInvitationDeliveryPlan({
  target: {
    ...invitationRow
  },
  options: {
    now: preparedAt,
    deliveryTtlHours: 24,
    rawToken: "one-time-delivery-token"
  }
}).publicPlan;
const preparedAttempt = {
  id: attemptId,
  organizationId: ownerSession.organizationId,
  invitationId: invitationRow.id,
  provider: "test_provider",
  status: "prepared" as const,
  providerMessageId: null,
  failureCode: null,
  deliveryExpiresAt,
  preparedAt,
  providerAcceptedAt: null,
  providerFailedAt: null,
  createdBy: ownerSession.userId,
  createdAt: preparedAt,
  updatedAt: preparedAt
};
const providerAcceptedAt = new Date("2026-07-11T00:05:00.000Z");
const acceptedAttempt = {
  ...preparedAttempt,
  status: "accepted_by_provider" as const,
  providerMessageId: "provider-message-1",
  providerAcceptedAt,
  updatedAt: providerAcceptedAt
};
const providerFailedAt = new Date("2026-07-11T00:03:00.000Z");
const failedAttempt = {
  ...preparedAttempt,
  status: "provider_failed" as const,
  failureCode: "provider_failed",
  providerFailedAt,
  updatedAt: providerFailedAt
};
const receipt: PublicInvitationEmailReceipt = {
  invitationId: invitationRow.id,
  recipient: invitationRow.email,
  provider: "test_provider",
  providerMessageId: "provider-message-1",
  status: "accepted_by_provider",
  acceptedAt: providerAcceptedAt,
  tokenExposure: "not_exposed"
};

function createPersistenceDatabaseDouble(input: {
  invitationRows: unknown[];
  insertedAttemptRows: unknown[];
  existingAttemptRows?: unknown[];
}) {
  const auditWrites: unknown[] = [];
  const attemptValues = vi.fn(() => ({
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn(async () => input.insertedAttemptRows)
    }))
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () =>
          table === invitations
            ? input.invitationRows
            : input.existingAttemptRows ?? []
        )
      }))
    }))
  }));
  const tx = {
    select,
    insert: vi.fn((table: unknown) => {
      if (table === invitationDeliveryAttempts) {
        return { values: attemptValues };
      }

      if (table === auditEvents) {
        return { values: auditValues };
      }

      throw new Error("Unexpected insert table.");
    })
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    attemptValues,
    auditWrites,
    auditValues
  };
}

function createTransitionDatabaseDouble(input: {
  currentRows: unknown[];
  updatedRows: unknown[];
  invitationRows?: unknown[];
}) {
  const auditWrites: unknown[] = [];
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () =>
          table === invitationDeliveryAttempts
            ? input.currentRows
            : input.invitationRows ?? [invitationRow]
        )
      }))
    }))
  }));
  const updateReturning = vi.fn(async () => input.updatedRows);
  const updateSet = vi.fn(() => ({
    where: vi.fn(() => ({
      returning: updateReturning
    }))
  }));
  const auditValues = vi.fn(async (value: unknown) => {
    auditWrites.push(value);
  });
  const tx = {
    select,
    update: vi.fn((table: unknown) => {
      if (table !== invitationDeliveryAttempts) {
        throw new Error("Unexpected update table.");
      }

      return { set: updateSet };
    }),
    insert: vi.fn((table: unknown) => {
      if (table !== auditEvents) {
        throw new Error("Unexpected insert table.");
      }

      return { values: auditValues };
    })
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    updateSet,
    auditWrites,
    auditValues
  };
}

function createListDatabaseDouble(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as unknown as Database,
    limit,
    orderBy
  };
}

describe("persistInvitationDeliveryAttempt", () => {
  it("persists a prepared token-free attempt and audit event", async () => {
    const db = createPersistenceDatabaseDouble({
      invitationRows: [invitationRow],
      insertedAttemptRows: [preparedAttempt]
    });

    const result = await persistInvitationDeliveryAttempt(db.db, {
      session: ownerSession,
      delivery,
      provider: " test_provider ",
      attemptId,
      now: preparedAt
    });

    expect(db.attemptValues).toHaveBeenCalledWith({
      id: attemptId,
      organizationId: ownerSession.organizationId,
      invitationId: invitationRow.id,
      provider: "test_provider",
      status: "prepared",
      deliveryExpiresAt,
      preparedAt,
      createdBy: ownerSession.userId,
      createdAt: preparedAt,
      updatedAt: preparedAt
    });
    expect(result).toMatchObject({
      mode: "created",
      attempt: preparedAttempt,
      auditEvent: {
        action: "invitation.delivery_attempt_prepared",
        metadata: {
          attemptId,
          invitationId: invitationRow.id,
          nextStatus: "prepared",
          deliveryClaim: "provider_status_only",
          tokenExposure: "not_exposed"
        }
      }
    });
    expect(db.auditWrites).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(
      /one-time-delivery-token|tokenHash|rawToken|providerPayload/i
    );
  });

  it("returns an existing matching attempt idempotently", async () => {
    const db = createPersistenceDatabaseDouble({
      invitationRows: [invitationRow],
      insertedAttemptRows: [],
      existingAttemptRows: [preparedAttempt]
    });

    const result = await persistInvitationDeliveryAttempt(db.db, {
      session: ownerSession,
      delivery,
      provider: "test_provider",
      attemptId,
      now: preparedAt
    });

    expect(result.mode).toBe("existing");
    expect(result.auditEvent.action).toBe(
      "invitation.delivery_attempt_existing"
    );
  });

  it("rejects unauthorized, cross-scope, missing, and ineligible attempts safely", async () => {
    const noTransactionDb = {
      transaction: vi.fn()
    } as unknown as Database;

    await expect(
      persistInvitationDeliveryAttempt(noTransactionDb, {
        session: { ...ownerSession, role: "viewer" },
        delivery,
        provider: "test_provider"
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      persistInvitationDeliveryAttempt(noTransactionDb, {
        session: ownerSession,
        delivery: { ...delivery, organizationId: "other_org" },
        provider: "test_provider"
      })
    ).rejects.toMatchObject({ code: "cross_scope" });
    expect(noTransactionDb.transaction).not.toHaveBeenCalled();

    for (const [rows, code] of [
      [[], "not_found"],
      [[{ ...invitationRow, status: "accepted" }], "invalid_state"]
    ] as const) {
      const db = createPersistenceDatabaseDouble({
        invitationRows: [...rows],
        insertedAttemptRows: []
      });

      await expect(
        persistInvitationDeliveryAttempt(db.db, {
          session: ownerSession,
          delivery,
          provider: "test_provider",
          attemptId,
          now: preparedAt
        })
      ).rejects.toMatchObject({ code });
      expect(db.auditValues).not.toHaveBeenCalled();
    }
  });
});

describe("invitation delivery attempt transitions", () => {
  it("moves prepared attempts to provider accepted with a safe receipt", async () => {
    const db = createTransitionDatabaseDouble({
      currentRows: [preparedAttempt],
      updatedRows: [acceptedAttempt]
    });

    const result = await markInvitationDeliveryAttemptProviderAccepted(db.db, {
      session: ownerSession,
      attemptId,
      receipt
    });

    expect(db.updateSet).toHaveBeenCalledWith({
      status: "accepted_by_provider",
      providerMessageId: receipt.providerMessageId,
      providerAcceptedAt,
      updatedAt: providerAcceptedAt
    });
    expect(result).toMatchObject({
      attempt: acceptedAttempt,
      auditEvent: {
        action: "invitation.delivery_attempt_provider_accepted",
        metadata: {
          previousStatus: "prepared",
          nextStatus: "accepted_by_provider",
          deliveryClaim: "provider_status_only"
        }
      }
    });
    expect(JSON.stringify(result)).not.toMatch(/tokenHash|rawToken|delivered/);
  });

  it("moves prepared attempts to provider failed with a bounded code only", async () => {
    const db = createTransitionDatabaseDouble({
      currentRows: [preparedAttempt],
      updatedRows: [failedAttempt]
    });

    const result = await markInvitationDeliveryAttemptProviderFailed(db.db, {
      session: ownerSession,
      attemptId,
      failureCode: "provider_failed",
      failedAt: providerFailedAt
    });

    expect(db.updateSet).toHaveBeenCalledWith({
      status: "provider_failed",
      failureCode: "provider_failed",
      providerFailedAt,
      updatedAt: providerFailedAt
    });
    expect(result).toMatchObject({
      attempt: failedAttempt,
      auditEvent: {
        action: "invitation.delivery_attempt_provider_failed",
        metadata: {
          previousStatus: "prepared",
          nextStatus: "provider_failed",
          failureCode: "provider_failed"
        }
      }
    });
  });

  it("rejects terminal, mismatched, invalid, and concurrent transitions", async () => {
    const terminalDb = createTransitionDatabaseDouble({
      currentRows: [acceptedAttempt],
      updatedRows: []
    });
    await expect(
      markInvitationDeliveryAttemptProviderFailed(terminalDb.db, {
        session: ownerSession,
        attemptId,
        failureCode: "provider_failed",
        failedAt: providerFailedAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(terminalDb.updateSet).not.toHaveBeenCalled();

    const mismatchDb = createTransitionDatabaseDouble({
      currentRows: [preparedAttempt],
      updatedRows: []
    });
    await expect(
      markInvitationDeliveryAttemptProviderAccepted(mismatchDb.db, {
        session: ownerSession,
        attemptId,
        receipt: { ...receipt, provider: "other_provider" }
      })
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(mismatchDb.updateSet).not.toHaveBeenCalled();

    const recipientMismatchDb = createTransitionDatabaseDouble({
      currentRows: [preparedAttempt],
      updatedRows: []
    });
    await expect(
      markInvitationDeliveryAttemptProviderAccepted(recipientMismatchDb.db, {
        session: ownerSession,
        attemptId,
        receipt: { ...receipt, recipient: "other@example.com" }
      })
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(recipientMismatchDb.updateSet).not.toHaveBeenCalled();

    const concurrentDb = createTransitionDatabaseDouble({
      currentRows: [preparedAttempt],
      updatedRows: []
    });
    await expect(
      markInvitationDeliveryAttemptProviderFailed(concurrentDb.db, {
        session: ownerSession,
        attemptId,
        failureCode: "provider_failed",
        failedAt: providerFailedAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(concurrentDb.auditValues).not.toHaveBeenCalled();
  });
});

describe("listOrganizationInvitationDeliveryAttempts", () => {
  it("lists bounded current-organization attempt summaries for managers", async () => {
    const db = createListDatabaseDouble([acceptedAttempt, failedAttempt]);

    const result = await listOrganizationInvitationDeliveryAttempts(db.db, {
      session: ownerSession,
      invitationId: invitationRow.id,
      limit: 500
    });

    expect(result).toEqual([acceptedAttempt, failedAttempt]);
    expect(db.limit).toHaveBeenCalledWith(100);
    expect(JSON.stringify(result)).not.toMatch(/tokenHash|rawToken|secret/i);
  });

  it("rejects non-manager attempt listing", async () => {
    const db = createListDatabaseDouble([]);

    await expect(
      listOrganizationInvitationDeliveryAttempts(db.db, {
        session: { ...ownerSession, role: "editor" }
      })
    ).rejects.toBeInstanceOf(InvitationDeliveryAttemptError);
    expect(db.orderBy).not.toHaveBeenCalled();
  });

  it("rejects invalid invitation filters before database work", async () => {
    const db = createListDatabaseDouble([]);

    await expect(
      listOrganizationInvitationDeliveryAttempts(db.db, {
        session: ownerSession,
        invitationId: "not-a-uuid"
      })
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(db.orderBy).not.toHaveBeenCalled();
  });
});

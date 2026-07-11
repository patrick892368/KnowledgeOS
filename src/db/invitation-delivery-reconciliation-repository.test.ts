import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";

import type { Database } from "./client";
import {
  InvitationDeliveryReconciliationError,
  reconcileInvitationDeliveryAttemptFromEvidence
} from "./invitation-delivery-reconciliation-repository";
import {
  auditEvents,
  invitationDeliveryAttempts,
  invitationDeliveryEvidence
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
const attemptId = "77777777-7777-4777-8777-777777777777";
const evidenceId = "88888888-8888-4888-8888-888888888888";
const invitationId = "44444444-4444-4444-8444-444444444444";
const providerMessageId = "56761188-7520-42d8-8898-ff6fc54ce618";
const preparedAt = new Date("2026-07-11T00:00:00.000Z");
const evidenceOccurredAt = new Date("2026-07-11T00:05:00.000Z");
const reconciledAt = new Date("2026-07-11T01:00:00.000Z");
const preparedAttempt = {
  id: attemptId,
  organizationId: ownerSession.organizationId,
  invitationId,
  provider: "resend",
  status: "prepared" as const,
  providerMessageId: null,
  failureCode: null,
  deliveryExpiresAt: new Date("2026-07-12T00:00:00.000Z"),
  preparedAt,
  providerAcceptedAt: null,
  providerFailedAt: null,
  createdBy: ownerSession.userId,
  createdAt: preparedAt,
  updatedAt: preparedAt
};
const reconciledAttempt = {
  ...preparedAttempt,
  status: "accepted_by_provider" as const,
  providerMessageId,
  providerAcceptedAt: evidenceOccurredAt,
  updatedAt: reconciledAt
};
const evidence = {
  id: evidenceId,
  organizationId: ownerSession.organizationId,
  invitationId,
  deliveryAttemptId: attemptId,
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server" as const,
  providerMessageId,
  occurredAt: evidenceOccurredAt,
  receivedAt: reconciledAt
};

function createDatabaseDouble(input: {
  evidenceRows?: unknown[];
  attemptRows?: unknown[];
  reconciledRows?: unknown[];
  concurrentRows?: unknown[];
}) {
  let attemptSelectCount = 0;
  const limit = vi.fn(async (table: unknown) => {
    if (table === invitationDeliveryEvidence) {
      return input.evidenceRows ?? [];
    }

    if (table === invitationDeliveryAttempts) {
      attemptSelectCount += 1;
      return attemptSelectCount === 1
        ? input.attemptRows ?? []
        : input.concurrentRows ?? [];
    }

    throw new Error("Unexpected select table.");
  });
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => limit(table))
      }))
    }))
  }));
  const returning = vi.fn(async () => input.reconciledRows ?? []);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn((table: unknown) => {
    if (table !== invitationDeliveryAttempts) {
      throw new Error("Unexpected update table.");
    }
    return { set };
  });
  const auditValues = vi.fn(async () => undefined);
  const insert = vi.fn((table: unknown) => {
    if (table !== auditEvents) {
      throw new Error("Unexpected insert table.");
    }
    return { values: auditValues };
  });
  const tx = { insert, select, update };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => unknown) => callback(tx)
  );

  return {
    auditValues,
    db: { transaction } as unknown as Database,
    limit,
    returning,
    set,
    transaction,
    update
  };
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectKeys);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectObjectKeys(nestedValue)
  ]);
}

describe("reconcileInvitationDeliveryAttemptFromEvidence", () => {
  it("transitions a prepared attempt from matching current-organization evidence", async () => {
    const db = createDatabaseDouble({
      evidenceRows: [evidence],
      attemptRows: [preparedAttempt],
      reconciledRows: [reconciledAttempt]
    });

    const result = await reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
      session: ownerSession,
      attemptId,
      evidenceId,
      reconciledAt
    });

    expect(result).toMatchObject({
      mode: "reconciled",
      attempt: {
        id: attemptId,
        status: "accepted_by_provider",
        providerMessageId
      },
      evidence: { id: evidenceId },
      auditEvent: {
        organizationId: ownerSession.organizationId,
        actorUserId: ownerSession.userId,
        action: "invitation.delivery_attempt_reconciled_provider_accepted",
        metadata: {
          attemptId,
          invitationId,
          evidenceId,
          previousStatus: "prepared",
          nextStatus: "accepted_by_provider",
          providerMessageId,
          deliveryClaim: "provider_status_only",
          inboxDeliveryClaim: "not_claimed",
          tokenExposure: "not_exposed"
        }
      }
    });
    expect(db.set).toHaveBeenCalledWith({
      status: "accepted_by_provider",
      providerMessageId,
      providerAcceptedAt: evidenceOccurredAt,
      updatedAt: reconciledAt
    });
    expect(db.auditValues).toHaveBeenCalledTimes(1);
    const auditCall = db.auditValues.mock.calls[0];
    const auditKeys = collectObjectKeys(auditCall).map((key) =>
      key.toLowerCase()
    );

    for (const forbiddenKey of [
      "recipient",
      "recipientemail",
      "email",
      "tokenhash",
      "rawtoken",
      "rawpayload",
      "signature",
      "secret"
    ]) {
      expect(auditKeys).not.toContain(forbiddenKey);
    }
    expect(JSON.stringify(auditCall)).not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
    );
  });

  it("returns an identical accepted state idempotently without another audit", async () => {
    const db = createDatabaseDouble({
      evidenceRows: [evidence],
      attemptRows: [reconciledAttempt]
    });

    await expect(
      reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
        session: ownerSession,
        attemptId,
        evidenceId,
        reconciledAt
      })
    ).resolves.toEqual({
      mode: "existing",
      attempt: reconciledAttempt,
      evidence,
      auditEvent: null
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.auditValues).not.toHaveBeenCalled();
  });

  it("rejects non-manager sessions before transaction work", async () => {
    const db = createDatabaseDouble({});

    await expect(
      reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
        session: { ...ownerSession, role: "viewer" },
        attemptId,
        evidenceId,
        reconciledAt
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid identity and time before transaction work", async () => {
    for (const input of [
      { attemptId: "not-a-uuid", evidenceId, reconciledAt },
      { attemptId, evidenceId: "not-a-uuid", reconciledAt },
      { attemptId, evidenceId, reconciledAt: new Date("invalid") }
    ]) {
      const db = createDatabaseDouble({});

      await expect(
        reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
          session: ownerSession,
          ...input
        })
      ).rejects.toBeInstanceOf(InvitationDeliveryReconciliationError);
      expect(db.transaction).not.toHaveBeenCalled();
    }
  });

  it("hides missing or cross-organization evidence before attempt lookup", async () => {
    const db = createDatabaseDouble({ evidenceRows: [] });

    await expect(
      reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
        session: ownerSession,
        attemptId,
        evidenceId,
        reconciledAt
      })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(db.limit).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("hides missing and mismatched attempt correlation", async () => {
    for (const attemptRows of [
      [],
      [{ ...preparedAttempt, invitationId: "99999999-9999-4999-8999-999999999999" }],
      [{ ...preparedAttempt, provider: "other" }]
    ]) {
      const db = createDatabaseDouble({
        evidenceRows: [evidence],
        attemptRows
      });

      await expect(
        reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
          session: ownerSession,
          attemptId,
          evidenceId,
          reconciledAt
        })
      ).rejects.toMatchObject({ code: "not_found" });
      expect(db.update).not.toHaveBeenCalled();
    }
  });

  it("rejects failed, malformed prepared, and conflicting accepted states", async () => {
    const invalidAttempts = [
      {
        ...preparedAttempt,
        status: "provider_failed" as const,
        failureCode: "provider_failed",
        providerFailedAt: reconciledAt
      },
      { ...preparedAttempt, providerMessageId: "impossible-message" },
      {
        ...reconciledAttempt,
        providerMessageId: "different-provider-message"
      }
    ];

    for (const attempt of invalidAttempts) {
      const db = createDatabaseDouble({
        evidenceRows: [evidence],
        attemptRows: [attempt]
      });

      await expect(
        reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
          session: ownerSession,
          attemptId,
          evidenceId,
          reconciledAt
        })
      ).rejects.toMatchObject({ code: "invalid_state" });
      expect(db.auditValues).not.toHaveBeenCalled();
    }
  });

  it("uses the evidence time when it is later than reconciliation clock", async () => {
    const earlyReconciliation = new Date("2026-07-11T00:04:59.000Z");
    const expectedAttempt = {
      ...reconciledAttempt,
      updatedAt: evidenceOccurredAt
    };
    const db = createDatabaseDouble({
      evidenceRows: [evidence],
      attemptRows: [preparedAttempt],
      reconciledRows: [expectedAttempt]
    });

    await reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
      session: ownerSession,
      attemptId,
      evidenceId,
      reconciledAt: earlyReconciliation
    });

    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: evidenceOccurredAt })
    );
  });

  it("returns a concurrent identical transition idempotently", async () => {
    const db = createDatabaseDouble({
      evidenceRows: [evidence],
      attemptRows: [preparedAttempt],
      reconciledRows: [],
      concurrentRows: [reconciledAttempt]
    });

    await expect(
      reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
        session: ownerSession,
        attemptId,
        evidenceId,
        reconciledAt
      })
    ).resolves.toEqual({
      mode: "existing",
      attempt: reconciledAttempt,
      evidence,
      auditEvent: null
    });
    expect(db.auditValues).not.toHaveBeenCalled();
  });

  it("rejects a conflicting concurrent transition", async () => {
    const db = createDatabaseDouble({
      evidenceRows: [evidence],
      attemptRows: [preparedAttempt],
      reconciledRows: [],
      concurrentRows: [
        {
          ...reconciledAttempt,
          status: "provider_failed",
          providerMessageId: null
        }
      ]
    });

    await expect(
      reconcileInvitationDeliveryAttemptFromEvidence(db.db, {
        session: ownerSession,
        attemptId,
        evidenceId,
        reconciledAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(db.auditValues).not.toHaveBeenCalled();
  });
});

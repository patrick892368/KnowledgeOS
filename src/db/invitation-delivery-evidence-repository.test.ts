import { describe, expect, it, vi } from "vitest";

import type { VerifiedInvitationProviderEvidence } from "@/invitations/provider-webhook.server";

import type { Database } from "./client";
import {
  InvitationDeliveryEvidenceError,
  persistVerifiedInvitationDeliveryEvidence
} from "./invitation-delivery-evidence-repository";
import {
  invitationDeliveryAttempts,
  invitationDeliveryEvidence
} from "./schema";

const organizationId = "11111111-1111-4111-8111-111111111111";
const invitationId = "44444444-4444-4444-8444-444444444444";
const deliveryAttemptId = "77777777-7777-4777-8777-777777777777";
const providerMessageId = "56761188-7520-42d8-8898-ff6fc54ce618";
const occurredAt = new Date("2026-07-11T00:50:00.000Z");
const receivedAt = new Date("2026-07-11T01:00:00.000Z");
const verifiedEvidence: VerifiedInvitationProviderEvidence = {
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server",
  deliveryAttemptId,
  providerMessageId,
  occurredAt,
  signatureVerified: true,
  inboxDeliveryClaim: "not_claimed",
  tokenExposure: "not_exposed"
};
const acceptedAttempt = {
  id: deliveryAttemptId,
  organizationId,
  invitationId,
  provider: "resend",
  status: "accepted_by_provider" as const,
  providerMessageId
};
const persistedEvidence = {
  id: "88888888-8888-4888-8888-888888888888",
  organizationId,
  invitationId,
  deliveryAttemptId,
  provider: "resend",
  providerEventId: verifiedEvidence.providerEventId,
  providerEventType: verifiedEvidence.providerEventType,
  evidenceType: verifiedEvidence.evidenceType,
  providerMessageId,
  occurredAt,
  receivedAt
};

function createDatabaseDouble(input: {
  existingRows?: unknown[];
  attemptRows?: unknown[];
  insertedRows?: unknown[];
  concurrentRows?: unknown[];
}) {
  let evidenceSelectCount = 0;
  const limit = vi.fn(async (table: unknown) => {
    if (table === invitationDeliveryAttempts) {
      return input.attemptRows ?? [];
    }

    if (table === invitationDeliveryEvidence) {
      evidenceSelectCount += 1;
      return evidenceSelectCount === 1
        ? input.existingRows ?? []
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
  const returning = vi.fn(async () => input.insertedRows ?? []);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn((table: unknown) => {
    if (table !== invitationDeliveryEvidence) {
      throw new Error("Unexpected insert table.");
    }

    return { values };
  });
  const tx = { select, insert };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => unknown) => callback(tx)
  );

  return {
    db: { transaction } as unknown as Database,
    insert,
    limit,
    onConflictDoNothing,
    select,
    values
  };
}

describe("persistVerifiedInvitationDeliveryEvidence", () => {
  it("derives organization scope from the accepted attempt and persists safe evidence", async () => {
    const db = createDatabaseDouble({
      attemptRows: [acceptedAttempt],
      insertedRows: [persistedEvidence]
    });

    const result = await persistVerifiedInvitationDeliveryEvidence(db.db, {
      evidence: verifiedEvidence,
      receivedAt
    });

    expect(result).toEqual({ mode: "created", evidence: persistedEvidence });
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        invitationId,
        deliveryAttemptId,
        provider: "resend",
        providerEventId: verifiedEvidence.providerEventId,
        providerEventType: "email.delivered",
        evidenceType: "delivered_to_recipient_server",
        providerMessageId,
        occurredAt,
        receivedAt
      })
    );
    const inserted = (db.values.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(inserted).not.toHaveProperty("recipient");
    expect(inserted).not.toHaveProperty("rawPayload");
    expect(inserted).not.toHaveProperty("signature");
    expect(inserted).not.toHaveProperty("signingSecret");
    expect(inserted).not.toHaveProperty("rawError");
    expect(inserted).not.toHaveProperty("inboxDelivered");
  });

  it("returns an identical Provider event idempotently before attempt lookup", async () => {
    const db = createDatabaseDouble({ existingRows: [persistedEvidence] });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).resolves.toEqual({ mode: "existing", evidence: persistedEvidence });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.limit).toHaveBeenCalledTimes(1);
  });

  it("returns a concurrent duplicate after conflict-safe insertion", async () => {
    const db = createDatabaseDouble({
      attemptRows: [acceptedAttempt],
      insertedRows: [],
      concurrentRows: [persistedEvidence]
    });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).resolves.toEqual({ mode: "existing", evidence: persistedEvidence });
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledTimes(3);
  });

  it("rejects conflicting duplicate Provider event identity", async () => {
    const db = createDatabaseDouble({
      existingRows: [
        {
          ...persistedEvidence,
          providerMessageId: "different-provider-message"
        }
      ]
    });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("hides missing attempt or Provider message correlation", async () => {
    const db = createDatabaseDouble({ attemptRows: [] });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).rejects.toMatchObject({ code: "not_found" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects an impossible mismatched correlation row defensively", async () => {
    const db = createDatabaseDouble({
      attemptRows: [
        { ...acceptedAttempt, providerMessageId: "different-message" }
      ]
    });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects non-accepted attempts without mutation", async () => {
    const preparedAttempt = {
      ...acceptedAttempt,
      status: "prepared" as const,
      providerMessageId
    };
    const db = createDatabaseDouble({ attemptRows: [preparedAttempt] });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(db.insert).not.toHaveBeenCalled();
    expect(preparedAttempt.status).toBe("prepared");
  });

  it("retains out-of-order evidence immutably without changing attempt status", async () => {
    const oldEvidence = {
      ...verifiedEvidence,
      providerEventId: "msg_old_event",
      providerEventType: "email.sent" as const,
      evidenceType: "sent_by_provider" as const,
      occurredAt: new Date("2026-07-10T23:00:00.000Z")
    };
    const oldPersisted = {
      ...persistedEvidence,
      providerEventId: oldEvidence.providerEventId,
      providerEventType: oldEvidence.providerEventType,
      evidenceType: oldEvidence.evidenceType,
      occurredAt: oldEvidence.occurredAt
    };
    const db = createDatabaseDouble({
      attemptRows: [acceptedAttempt],
      insertedRows: [oldPersisted]
    });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: oldEvidence,
        receivedAt
      })
    ).resolves.toEqual({ mode: "created", evidence: oldPersisted });
    expect(acceptedAttempt.status).toBe("accepted_by_provider");
  });

  it("rejects unverified markers and mismatched event taxonomy before database work", async () => {
    const invalidEvidence = [
      { ...verifiedEvidence, signatureVerified: false },
      { ...verifiedEvidence, inboxDeliveryClaim: "confirmed" },
      { ...verifiedEvidence, tokenExposure: "exposed" },
      { ...verifiedEvidence, provider: "other" },
      { ...verifiedEvidence, providerEventId: "invalid event id" },
      { ...verifiedEvidence, deliveryAttemptId: "not-a-uuid" },
      {
        ...verifiedEvidence,
        evidenceType: "delivery_failed"
      },
      {
        ...verifiedEvidence,
        providerEventType: "email.opened",
        evidenceType: "delivered_to_recipient_server"
      },
      { ...verifiedEvidence, occurredAt: new Date("invalid") }
    ] as unknown as VerifiedInvitationProviderEvidence[];

    for (const evidence of invalidEvidence) {
      const db = createDatabaseDouble({});

      await expect(
        persistVerifiedInvitationDeliveryEvidence(db.db, {
          evidence,
          receivedAt
        })
      ).rejects.toBeInstanceOf(InvitationDeliveryEvidenceError);
      expect(db.select).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid receipt time before database work", async () => {
    const db = createDatabaseDouble({});

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt: new Date("invalid")
      })
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("fails safely when conflict resolution cannot find the winning row", async () => {
    const db = createDatabaseDouble({
      attemptRows: [acceptedAttempt],
      insertedRows: [],
      concurrentRows: []
    });

    await expect(
      persistVerifiedInvitationDeliveryEvidence(db.db, {
        evidence: verifiedEvidence,
        receivedAt
      })
    ).rejects.toMatchObject({ code: "invalid_state" });
  });
});

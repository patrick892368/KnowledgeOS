import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";

import type { Database } from "./client";
import {
  InvitationDeliveryEvidenceReviewError,
  listOrganizationInvitationDeliveryEvidence
} from "./invitation-delivery-evidence-review-repository";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const attemptId = "77777777-7777-4777-8777-777777777777";
const evidence = {
  id: "88888888-8888-4888-8888-888888888888",
  organizationId: session.organizationId,
  invitationId: "44444444-4444-4444-8444-444444444444",
  deliveryAttemptId: attemptId,
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server" as const,
  providerMessageId: "56761188-7520-42d8-8898-ff6fc54ce618",
  occurredAt: new Date("2026-07-11T00:05:00.000Z"),
  receivedAt: new Date("2026-07-11T00:05:01.000Z")
};

function createDatabaseDouble(rows: unknown[] = []) {
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as unknown as Database,
    from,
    innerJoin,
    limit,
    orderBy,
    select,
    where
  };
}

describe("listOrganizationInvitationDeliveryEvidence", () => {
  it("returns bounded attempt evidence through the current organization query", async () => {
    const db = createDatabaseDouble([evidence]);

    await expect(
      listOrganizationInvitationDeliveryEvidence(db.db, {
        session,
        attemptId,
        limit: 25
      })
    ).resolves.toEqual([evidence]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.innerJoin).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(db.orderBy).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledWith(25);
  });

  it("uses a bounded default and preserves an empty result", async () => {
    const db = createDatabaseDouble();

    await expect(
      listOrganizationInvitationDeliveryEvidence(db.db, {
        session,
        attemptId
      })
    ).resolves.toEqual([]);
    expect(db.limit).toHaveBeenCalledWith(50);
  });

  it("rejects non-manager sessions before database work", async () => {
    const db = createDatabaseDouble();

    await expect(
      listOrganizationInvitationDeliveryEvidence(db.db, {
        session: { ...session, role: "viewer" },
        attemptId
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects invalid attempt identity and limits before database work", async () => {
    for (const input of [
      { attemptId: "not-a-uuid", limit: 50 },
      { attemptId, limit: 0 },
      { attemptId, limit: 101 },
      { attemptId, limit: 1.5 }
    ]) {
      const db = createDatabaseDouble();

      await expect(
        listOrganizationInvitationDeliveryEvidence(db.db, {
          session,
          ...input
        })
      ).rejects.toBeInstanceOf(InvitationDeliveryEvidenceReviewError);
      expect(db.select).not.toHaveBeenCalled();
    }
  });
});

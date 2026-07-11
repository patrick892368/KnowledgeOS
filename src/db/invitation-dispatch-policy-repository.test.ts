import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";

import type { Database } from "./client";
import {
  InvitationDispatchPolicyRepositoryError,
  readInvitationDispatchPolicyHistory
} from "./invitation-dispatch-policy-repository";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  source: "signed-cookie"
};
const invitationId = "44444444-4444-4444-8444-444444444444";
const currentAttemptId = "77777777-7777-4777-8777-777777777777";
const cooldownSince = new Date("2026-07-11T00:09:00.000Z");
const rateLimitSince = new Date("2026-07-10T23:10:00.000Z");

function createDatabaseDouble(input: {
  latestRows?: unknown[];
  countRows?: unknown[];
}) {
  const latestLimit = vi.fn(async () => input.latestRows ?? []);
  const latestOrderBy = vi.fn(() => ({ limit: latestLimit }));
  const latestWhere = vi.fn(() => ({ orderBy: latestOrderBy }));
  const latestFrom = vi.fn(() => ({ where: latestWhere }));
  const countWhere = vi.fn(async () => input.countRows ?? []);
  const countFrom = vi.fn(() => ({ where: countWhere }));
  let callCount = 0;
  const select = vi.fn(() => {
    callCount += 1;
    return callCount === 1
      ? { from: latestFrom }
      : { from: countFrom };
  });

  return {
    db: { select } as unknown as Database,
    countWhere,
    latestLimit,
    latestOrderBy,
    select
  };
}

describe("readInvitationDispatchPolicyHistory", () => {
  it("returns only bounded current-organization policy signals", async () => {
    const latestPreparedAt = new Date("2026-07-11T00:09:30.000Z");
    const database = createDatabaseDouble({
      latestRows: [{ preparedAt: latestPreparedAt }],
      countRows: [{ attemptCount: 8 }]
    });

    await expect(
      readInvitationDispatchPolicyHistory(database.db, {
        session,
        invitationId,
        currentAttemptId,
        cooldownSince,
        rateLimitSince
      })
    ).resolves.toEqual({
      latestInvitationAttemptPreparedAt: latestPreparedAt,
      organizationAttemptCount: 8
    });
    expect(database.select).toHaveBeenCalledTimes(2);
    expect(database.latestLimit).toHaveBeenCalledWith(1);
    expect(database.countWhere).toHaveBeenCalledTimes(1);
  });

  it("returns empty history without leaking attempt rows", async () => {
    const database = createDatabaseDouble({
      latestRows: [],
      countRows: [{ attemptCount: "0" }]
    });

    const result = await readInvitationDispatchPolicyHistory(database.db, {
      session,
      invitationId,
      currentAttemptId,
      cooldownSince,
      rateLimitSince
    });

    expect(result).toEqual({
      latestInvitationAttemptPreparedAt: null,
      organizationAttemptCount: 0
    });
    expect(JSON.stringify(result)).not.toMatch(
      /provider|recipient|token|failureCode|payload/i
    );
  });

  it("rejects authorization and invalid boundaries before database work", async () => {
    for (const input of [
      {
        session: { ...session, role: "viewer" as const },
        invitationId,
        currentAttemptId,
        cooldownSince,
        rateLimitSince
      },
      {
        session,
        invitationId: "invalid",
        currentAttemptId,
        cooldownSince,
        rateLimitSince
      },
      {
        session,
        invitationId,
        currentAttemptId: "invalid",
        cooldownSince,
        rateLimitSince
      },
      {
        session,
        invitationId,
        currentAttemptId,
        cooldownSince: new Date("invalid"),
        rateLimitSince
      }
    ]) {
      const database = createDatabaseDouble({});

      await expect(
        readInvitationDispatchPolicyHistory(database.db, input)
      ).rejects.toBeInstanceOf(InvitationDispatchPolicyRepositoryError);
      expect(database.select).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid aggregate count safely", async () => {
    const database = createDatabaseDouble({
      countRows: [{ attemptCount: "not-a-count" }]
    });

    await expect(
      readInvitationDispatchPolicyHistory(database.db, {
        session,
        invitationId,
        currentAttemptId,
        cooldownSince,
        rateLimitSince
      })
    ).rejects.toMatchObject({ code: "invalid_payload" });
  });
});

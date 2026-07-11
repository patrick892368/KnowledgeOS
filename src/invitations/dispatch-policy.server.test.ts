import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";

import {
  createInvitationDispatchPolicyConfig,
  createInvitationDispatchPolicyConfigFromEnvironment,
  InvitationDispatchPolicyConfigurationError,
  reviewInvitationDispatchPolicy
} from "./dispatch-policy.server";

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
const now = new Date("2026-07-11T01:00:00.000Z");
const db = {} as Database;
const policy = createInvitationDispatchPolicyConfig({
  cooldownSeconds: 60,
  rateLimitWindowSeconds: 3_600,
  maxAttemptsPerWindow: 5
});

function dependencies(input: {
  latestInvitationAttemptPreparedAt?: Date | null;
  organizationAttemptCount?: number;
}) {
  return {
    readHistory: vi.fn(async () => ({
      latestInvitationAttemptPreparedAt:
        input.latestInvitationAttemptPreparedAt ?? null,
      organizationAttemptCount: input.organizationAttemptCount ?? 0
    }))
  };
}

describe("invitation dispatch policy configuration", () => {
  it("uses safe defaults and accepts bounded environment overrides", () => {
    expect(createInvitationDispatchPolicyConfigFromEnvironment({})).toEqual({
      cooldownSeconds: 60,
      rateLimitWindowSeconds: 3_600,
      maxAttemptsPerWindow: 100
    });
    expect(
      createInvitationDispatchPolicyConfigFromEnvironment({
        KNOWLEDGEOS_INVITATION_DISPATCH_COOLDOWN_SECONDS: "120",
        KNOWLEDGEOS_INVITATION_DISPATCH_RATE_WINDOW_SECONDS: "7200",
        KNOWLEDGEOS_INVITATION_DISPATCH_RATE_MAX: "50"
      })
    ).toEqual({
      cooldownSeconds: 120,
      rateLimitWindowSeconds: 7_200,
      maxAttemptsPerWindow: 50
    });
  });

  it("rejects disabled, fractional, and excessive policy values", () => {
    for (const environment of [
      { KNOWLEDGEOS_INVITATION_DISPATCH_COOLDOWN_SECONDS: "0" },
      { KNOWLEDGEOS_INVITATION_DISPATCH_COOLDOWN_SECONDS: "10.5" },
      { KNOWLEDGEOS_INVITATION_DISPATCH_RATE_WINDOW_SECONDS: "9999999" },
      { KNOWLEDGEOS_INVITATION_DISPATCH_RATE_MAX: "1001" }
    ]) {
      expect(() =>
        createInvitationDispatchPolicyConfigFromEnvironment(environment)
      ).toThrow(InvitationDispatchPolicyConfigurationError);
    }
  });
});

describe("reviewInvitationDispatchPolicy", () => {
  it("allows a new attempt with no recent history", async () => {
    const policyDependencies = dependencies({});

    await expect(
      reviewInvitationDispatchPolicy(
        db,
        { session, invitationId, currentAttemptId, policy, now },
        policyDependencies
      )
    ).resolves.toEqual({ status: "allowed" });
    expect(policyDependencies.readHistory).toHaveBeenCalledWith(db, {
      session,
      invitationId,
      currentAttemptId,
      cooldownSince: new Date("2026-07-11T00:59:00.000Z"),
      rateLimitSince: new Date("2026-07-11T00:00:00.000Z")
    });
  });

  it("denies a recent same-invitation attempt before organization count", async () => {
    await expect(
      reviewInvitationDispatchPolicy(
        db,
        { session, invitationId, currentAttemptId, policy, now },
        dependencies({
          latestInvitationAttemptPreparedAt: new Date(
            "2026-07-11T00:59:30.000Z"
          ),
          organizationAttemptCount: 5
        })
      )
    ).resolves.toEqual({
      status: "denied",
      failureCode: "dispatch_cooldown_active"
    });
  });

  it("denies an organization at the configured window maximum", async () => {
    await expect(
      reviewInvitationDispatchPolicy(
        db,
        { session, invitationId, currentAttemptId, policy, now },
        dependencies({ organizationAttemptCount: 5 })
      )
    ).resolves.toEqual({
      status: "denied",
      failureCode: "dispatch_rate_limited"
    });
  });

  it("allows the exact cooldown boundary and below-limit organization", async () => {
    await expect(
      reviewInvitationDispatchPolicy(
        db,
        { session, invitationId, currentAttemptId, policy, now },
        dependencies({
          latestInvitationAttemptPreparedAt: new Date(
            "2026-07-11T00:59:00.000Z"
          ),
          organizationAttemptCount: 4
        })
      )
    ).resolves.toEqual({ status: "allowed" });
  });

  it("rejects invalid history and review timestamps", async () => {
    await expect(
      reviewInvitationDispatchPolicy(
        db,
        { session, invitationId, currentAttemptId, policy, now },
        dependencies({ organizationAttemptCount: -1 })
      )
    ).rejects.toThrow("policy history is invalid");
    await expect(
      reviewInvitationDispatchPolicy(
        db,
        {
          session,
          invitationId,
          currentAttemptId,
          policy,
          now: new Date("invalid")
        },
        dependencies({})
      )
    ).rejects.toThrow("review time is invalid");
  });
});

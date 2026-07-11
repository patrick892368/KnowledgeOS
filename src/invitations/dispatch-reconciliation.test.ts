import { describe, expect, it } from "vitest";

import type { PersistedInvitationDeliveryAttempt } from "@/db/invitation-delivery-attempt-repository";

import {
  createInvitationDispatchReconciliationConfigFromEnvironment,
  createInvitationDispatchReconciliationReview,
  createInvitationDispatchReconciliationSummary,
  InvitationDispatchReconciliationConfigurationError
} from "./dispatch-reconciliation";

const now = new Date("2026-07-11T01:00:00.000Z");
const attempt: PersistedInvitationDeliveryAttempt = {
  id: "77777777-7777-4777-8777-777777777777",
  organizationId: "11111111-1111-4111-8111-111111111111",
  invitationId: "44444444-4444-4444-8444-444444444444",
  provider: "resend",
  status: "prepared",
  providerMessageId: null,
  failureCode: null,
  deliveryExpiresAt: new Date("2026-07-12T00:00:00.000Z"),
  preparedAt: new Date("2026-07-11T00:59:00.000Z"),
  providerAcceptedAt: null,
  providerFailedAt: null,
  createdBy: "22222222-2222-4222-8222-222222222222",
  createdAt: new Date("2026-07-11T00:59:00.000Z"),
  updatedAt: new Date("2026-07-11T00:59:00.000Z")
};

describe("invitation dispatch reconciliation configuration", () => {
  it("uses a safe default and accepts bounded environment override", () => {
    expect(createInvitationDispatchReconciliationConfigFromEnvironment({}))
      .toEqual({ stalePreparedSeconds: 300 });
    expect(
      createInvitationDispatchReconciliationConfigFromEnvironment({
        KNOWLEDGEOS_INVITATION_RECONCILIATION_STALE_SECONDS: "900"
      })
    ).toEqual({ stalePreparedSeconds: 900 });
  });

  it("rejects disabled, fractional, and excessive thresholds", () => {
    for (const value of ["0", "59", "60.5", "86401"]) {
      expect(() =>
        createInvitationDispatchReconciliationConfigFromEnvironment({
          KNOWLEDGEOS_INVITATION_RECONCILIATION_STALE_SECONDS: value
        })
      ).toThrow(InvitationDispatchReconciliationConfigurationError);
    }
  });
});

describe("createInvitationDispatchReconciliationReview", () => {
  it("keeps recent prepared attempts in wait state", () => {
    expect(
      createInvitationDispatchReconciliationReview({ attempt, now })
    ).toMatchObject({
      id: attempt.id,
      attemptStatus: "prepared",
      reviewState: "recent_prepared",
      recommendedAction: "wait_for_provider_state",
      ageSeconds: 60,
      deliveryClaim: "provider_status_only",
      tokenExposure: "not_exposed"
    });
  });

  it("marks the exact stale threshold for manual reconciliation", () => {
    expect(
      createInvitationDispatchReconciliationReview({
        attempt: {
          ...attempt,
          preparedAt: new Date("2026-07-11T00:55:00.000Z")
        },
        now
      })
    ).toMatchObject({
      reviewState: "reconciliation_required",
      recommendedAction: "manual_reconciliation_required",
      ageSeconds: 300
    });
  });

  it("preserves accepted and failed Provider terminal states", () => {
    const acceptedAt = new Date("2026-07-11T00:59:30.000Z");
    const accepted = createInvitationDispatchReconciliationReview({
      attempt: {
        ...attempt,
        status: "accepted_by_provider",
        providerMessageId: "provider-message-1",
        providerAcceptedAt: acceptedAt,
        updatedAt: acceptedAt
      },
      now
    });
    const failedAt = new Date("2026-07-11T00:59:20.000Z");
    const failed = createInvitationDispatchReconciliationReview({
      attempt: {
        ...attempt,
        status: "provider_failed",
        failureCode: "provider_failed",
        providerFailedAt: failedAt,
        updatedAt: failedAt
      },
      now
    });

    expect(accepted).toMatchObject({
      reviewState: "accepted_by_provider",
      recommendedAction: "none",
      providerMessageId: "provider-message-1"
    });
    expect(failed).toMatchObject({
      reviewState: "provider_failed",
      recommendedAction: "none",
      failureCode: "provider_failed"
    });
  });

  it("returns no recipient, token, payload, or raw Provider error", () => {
    const review = createInvitationDispatchReconciliationReview({ attempt, now });

    expect(review).not.toHaveProperty("organizationId");
    expect(review).not.toHaveProperty("createdBy");
    expect(JSON.stringify(review)).not.toMatch(
      /recipient|email|rawToken|tokenHash|providerPayload|rawError/i
    );
  });

  it("summarizes explicit review states", () => {
    const reviews = [
      createInvitationDispatchReconciliationReview({ attempt, now }),
      createInvitationDispatchReconciliationReview({
        attempt: {
          ...attempt,
          id: "88888888-8888-4888-8888-888888888888",
          preparedAt: new Date("2026-07-11T00:50:00.000Z")
        },
        now
      }),
      createInvitationDispatchReconciliationReview({
        attempt: {
          ...attempt,
          id: "99999999-9999-4999-8999-999999999999",
          status: "provider_failed",
          failureCode: "provider_failed",
          providerFailedAt: now,
          updatedAt: now
        },
        now
      })
    ];

    expect(
      createInvitationDispatchReconciliationSummary({ reviews })
    ).toEqual({
      totalCount: 3,
      recentPreparedCount: 1,
      reconciliationRequiredCount: 1,
      acceptedByProviderCount: 0,
      providerFailedCount: 1,
      stalePreparedSeconds: 300,
      deliveryClaim: "provider_status_only",
      tokenExposure: "not_exposed"
    });
  });
});

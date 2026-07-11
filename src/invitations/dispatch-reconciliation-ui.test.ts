import { describe, expect, it } from "vitest";

import {
  createInvitationDispatchReviewQuery,
  InvitationDispatchReviewUiError,
  parseInvitationDispatchReviewUiResponse
} from "./dispatch-reconciliation-ui";

const invitationId = "44444444-4444-4444-8444-444444444444";
const preparedAt = "2026-07-11T00:55:00.000Z";
const updatedAt = "2026-07-11T01:00:00.000Z";

function review(
  input: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    invitationId,
    provider: "resend",
    attemptStatus: "prepared",
    reviewState: "reconciliation_required",
    recommendedAction: "manual_reconciliation_required",
    providerMessageId: null,
    failureCode: null,
    preparedAt,
    providerAcceptedAt: null,
    providerFailedAt: null,
    updatedAt,
    ageSeconds: 300,
    deliveryClaim: "provider_status_only",
    tokenExposure: "not_exposed",
    ...input
  };
}

function payload(reviews: Record<string, unknown>[] = [review()]) {
  return {
    summary: {
      totalCount: reviews.length,
      recentPreparedCount: reviews.filter(
        (item) => item.reviewState === "recent_prepared"
      ).length,
      reconciliationRequiredCount: reviews.filter(
        (item) => item.reviewState === "reconciliation_required"
      ).length,
      acceptedByProviderCount: reviews.filter(
        (item) => item.reviewState === "accepted_by_provider"
      ).length,
      providerFailedCount: reviews.filter(
        (item) => item.reviewState === "provider_failed"
      ).length,
      stalePreparedSeconds: 300,
      deliveryClaim: "provider_status_only",
      tokenExposure: "not_exposed"
    },
    reviews
  };
}

describe("createInvitationDispatchReviewQuery", () => {
  it("creates bounded unfiltered and invitation-filtered queries", () => {
    expect(createInvitationDispatchReviewQuery()).toBe("?limit=50");
    expect(
      createInvitationDispatchReviewQuery({ invitationId, limit: 25 })
    ).toBe(`?limit=25&invitationId=${invitationId}`);
    expect(
      createInvitationDispatchReviewQuery({ invitationId: "   " })
    ).toBe("?limit=50");
  });

  it("rejects invalid invitation and limit authority", () => {
    expect(() =>
      createInvitationDispatchReviewQuery({ invitationId: "not-a-uuid" })
    ).toThrow(InvitationDispatchReviewUiError);

    for (const limit of [0, 101, 1.5]) {
      expect(() => createInvitationDispatchReviewQuery({ limit })).toThrow(
        InvitationDispatchReviewUiError
      );
    }
  });
});

describe("parseInvitationDispatchReviewUiResponse", () => {
  it("selects all explicit review states and safe fields", () => {
    const reviews = [
      review({
        id: "11111111-1111-4111-8111-111111111111",
        reviewState: "recent_prepared",
        recommendedAction: "wait_for_provider_state",
        preparedAt: "2026-07-11T00:59:00.000Z",
        ageSeconds: 60,
        organizationId: "must-not-be-selected",
        recipient: "member@example.com",
        rawToken: "one-time-token"
      }),
      review({ id: "22222222-2222-4222-8222-222222222222" }),
      review({
        id: "33333333-3333-4333-8333-333333333333",
        attemptStatus: "accepted_by_provider",
        reviewState: "accepted_by_provider",
        recommendedAction: "none",
        providerMessageId: "provider-message-1",
        providerAcceptedAt: updatedAt
      }),
      review({
        id: "55555555-5555-4555-8555-555555555555",
        attemptStatus: "provider_failed",
        reviewState: "provider_failed",
        recommendedAction: "none",
        failureCode: "provider_failed",
        providerFailedAt: updatedAt,
        rawError: "provider secret"
      })
    ];
    const result = parseInvitationDispatchReviewUiResponse(payload(reviews), {
      invitationId
    });

    expect(result.summary).toEqual({
      totalCount: 4,
      recentPreparedCount: 1,
      reconciliationRequiredCount: 1,
      acceptedByProviderCount: 1,
      providerFailedCount: 1,
      stalePreparedSeconds: 300
    });
    expect(result.reviews.map((item) => item.reviewState)).toEqual([
      "recent_prepared",
      "reconciliation_required",
      "accepted_by_provider",
      "provider_failed"
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /organizationId|recipient|email|rawToken|rawError|one-time-token|provider secret/i
    );
  });

  it("enforces the exact stale threshold and prepared action semantics", () => {
    expect(() =>
      parseInvitationDispatchReviewUiResponse(
        payload([
          review({
            reviewState: "recent_prepared",
            recommendedAction: "wait_for_provider_state",
            ageSeconds: 300
          })
        ])
      )
    ).toThrow(InvitationDispatchReviewUiError);

    expect(() =>
      parseInvitationDispatchReviewUiResponse(
        payload([
          review({
            reviewState: "reconciliation_required",
            recommendedAction: "manual_reconciliation_required",
            ageSeconds: 299
          })
        ])
      )
    ).toThrow(InvitationDispatchReviewUiError);
  });

  it("rejects invalid terminal state combinations", () => {
    const invalidReviews = [
      review({
        attemptStatus: "accepted_by_provider",
        reviewState: "accepted_by_provider",
        recommendedAction: "none",
        providerMessageId: null,
        providerAcceptedAt: updatedAt
      }),
      review({
        attemptStatus: "provider_failed",
        reviewState: "provider_failed",
        recommendedAction: "none",
        providerMessageId: "unexpected-message",
        failureCode: "provider_failed",
        providerFailedAt: updatedAt
      }),
      review({ recommendedAction: "none" })
    ];

    for (const invalidReview of invalidReviews) {
      expect(() =>
        parseInvitationDispatchReviewUiResponse(payload([invalidReview]))
      ).toThrow(InvitationDispatchReviewUiError);
    }
  });

  it("rejects summary mismatch, duplicate attempts, and filter mismatch", () => {
    const mismatchedSummary = payload();
    mismatchedSummary.summary.totalCount = 2;

    expect(() =>
      parseInvitationDispatchReviewUiResponse(mismatchedSummary)
    ).toThrow(InvitationDispatchReviewUiError);
    expect(() =>
      parseInvitationDispatchReviewUiResponse(payload([review(), review()]))
    ).toThrow(InvitationDispatchReviewUiError);
    expect(() =>
      parseInvitationDispatchReviewUiResponse(payload(), {
        invitationId: "99999999-9999-4999-8999-999999999999"
      })
    ).toThrow(InvitationDispatchReviewUiError);
  });

  it("rejects unsafe markers, invalid dates, and bounded identifiers", () => {
    const invalidPayloads = [
      {
        ...payload(),
        summary: { ...payload().summary, tokenExposure: "exposed" }
      },
      payload([review({ deliveryClaim: "delivered" })]),
      payload([review({ preparedAt: "not-a-date" })]),
      payload([review({ preparedAt: "2026" })]),
      payload([
        review({
          attemptStatus: "accepted_by_provider",
          reviewState: "accepted_by_provider",
          recommendedAction: "none",
          providerMessageId: "provider-message-1",
          providerAcceptedAt: "2026-07-11T00:54:00.000Z"
        })
      ]),
      payload([review({ provider: "x".repeat(65) })]),
      payload([
        review({
          attemptStatus: "provider_failed",
          reviewState: "provider_failed",
          recommendedAction: "none",
          failureCode: "INVALID-CODE",
          providerFailedAt: updatedAt
        })
      ])
    ];

    for (const invalidPayload of invalidPayloads) {
      expect(() =>
        parseInvitationDispatchReviewUiResponse(invalidPayload)
      ).toThrow(InvitationDispatchReviewUiError);
    }
  });

  it("accepts a safe empty review result", () => {
    expect(parseInvitationDispatchReviewUiResponse(payload([]))).toEqual({
      summary: {
        totalCount: 0,
        recentPreparedCount: 0,
        reconciliationRequiredCount: 0,
        acceptedByProviderCount: 0,
        providerFailedCount: 0,
        stalePreparedSeconds: 300
      },
      reviews: []
    });
  });
});

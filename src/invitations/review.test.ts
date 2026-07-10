import { describe, expect, it } from "vitest";

import {
  createInvitationReview,
  createInvitationReviewSummary,
  type InvitationReviewTarget
} from "./review";

const now = new Date("2026-07-10T00:00:00.000Z");

function invitation(
  overrides: Partial<InvitationReviewTarget> = {}
): InvitationReviewTarget {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    email: "member@example.com",
    role: "viewer",
    status: "pending",
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    expiresAt: new Date("2026-07-17T00:00:00.000Z"),
    acceptedAt: null,
    revokedAt: null,
    ...overrides
  };
}

describe("createInvitationReview", () => {
  it("marks healthy pending invitations as active without resend review", () => {
    const review = createInvitationReview({
      invitation: invitation(),
      now
    });

    expect(review).toMatchObject({
      reviewState: "active",
      resendAction: "not_needed",
      hoursUntilExpiration: 168,
      tokenExposure: "not_exposed"
    });
    expect(JSON.stringify(review)).not.toMatch(/invite-token|tokenHash/i);
  });

  it("marks pending invitations near expiration for resend review", () => {
    const review = createInvitationReview({
      invitation: invitation({
        expiresAt: new Date("2026-07-11T00:00:00.000Z")
      }),
      now
    });

    expect(review).toMatchObject({
      reviewState: "expiring_soon",
      resendAction: "review_resend",
      hoursUntilExpiration: 24
    });
  });

  it("marks pending invitations past expiration for resend review", () => {
    const review = createInvitationReview({
      invitation: invitation({
        expiresAt: new Date("2026-07-09T23:59:59.000Z")
      }),
      now
    });

    expect(review).toMatchObject({
      reviewState: "expired",
      resendAction: "review_resend"
    });
  });

  it("blocks resend review for accepted invitations", () => {
    const review = createInvitationReview({
      invitation: invitation({
        status: "accepted",
        acceptedAt: new Date("2026-07-09T12:00:00.000Z")
      }),
      now
    });

    expect(review).toMatchObject({
      reviewState: "accepted",
      resendAction: "blocked",
      reason: "Invitation already accepted."
    });
  });

  it("blocks resend review for revoked invitations", () => {
    const review = createInvitationReview({
      invitation: invitation({
        status: "revoked",
        revokedAt: new Date("2026-07-09T12:00:00.000Z")
      }),
      now
    });

    expect(review).toMatchObject({
      reviewState: "revoked",
      resendAction: "blocked",
      reason: "Invitation was revoked and must not be resent."
    });
  });
});

describe("createInvitationReviewSummary", () => {
  it("summarizes expiration and resend review counts without token material", () => {
    const summary = createInvitationReviewSummary({
      invitations: [
        invitation(),
        invitation({
          id: "55555555-5555-4555-8555-555555555555",
          email: "soon@example.com",
          expiresAt: new Date("2026-07-11T00:00:00.000Z")
        }),
        invitation({
          id: "66666666-6666-4666-8666-666666666666",
          email: "accepted@example.com",
          status: "accepted",
          acceptedAt: new Date("2026-07-09T12:00:00.000Z")
        }),
        invitation({
          id: "77777777-7777-4777-8777-777777777777",
          email: "revoked@example.com",
          status: "revoked",
          revokedAt: new Date("2026-07-09T12:00:00.000Z")
        })
      ],
      now
    });

    expect(summary).toMatchObject({
      totalCount: 4,
      pendingCount: 2,
      acceptedCount: 1,
      revokedCount: 1,
      expiredCount: 0,
      expiringSoonCount: 1,
      resendReviewCount: 1,
      tokenExposure: "not_exposed"
    });
    expect(JSON.stringify(summary)).not.toMatch(/invite-token|tokenHash/i);
  });
});

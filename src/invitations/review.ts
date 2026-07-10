import type { InvitationStatus, MembershipRole } from "@/db/model";

export type InvitationReviewState =
  | "active"
  | "expiring_soon"
  | "expired"
  | "accepted"
  | "revoked";

export type InvitationResendAction =
  | "not_needed"
  | "review_resend"
  | "blocked";

export interface InvitationReviewTarget {
  id: string;
  email: string;
  role: Exclude<MembershipRole, "owner">;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}

export interface InvitationReview {
  id: string;
  email: string;
  role: Exclude<MembershipRole, "owner">;
  status: InvitationStatus;
  reviewState: InvitationReviewState;
  resendAction: InvitationResendAction;
  hoursUntilExpiration: number;
  expiresAt: Date;
  reason: string;
  tokenExposure: "not_exposed";
}

export interface InvitationReviewSummary {
  totalCount: number;
  pendingCount: number;
  acceptedCount: number;
  revokedCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  resendReviewCount: number;
  tokenExposure: "not_exposed";
  reviews: InvitationReview[];
}

const hourInMs = 60 * 60 * 1000;
const defaultExpiringSoonHours = 48;

function hoursUntil(expiresAt: Date, now: Date): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / hourInMs);
}

export function createInvitationReview(input: {
  invitation: InvitationReviewTarget;
  now?: Date;
  expiringSoonHours?: number;
}): InvitationReview {
  const now = input.now ?? new Date();
  const expiringSoonHours =
    input.expiringSoonHours ?? defaultExpiringSoonHours;
  const hoursUntilExpiration = hoursUntil(input.invitation.expiresAt, now);
  const base = {
    id: input.invitation.id,
    email: input.invitation.email,
    role: input.invitation.role,
    status: input.invitation.status,
    hoursUntilExpiration,
    expiresAt: input.invitation.expiresAt,
    tokenExposure: "not_exposed" as const
  };

  if (input.invitation.status === "accepted") {
    return {
      ...base,
      reviewState: "accepted",
      resendAction: "blocked",
      reason: "Invitation already accepted."
    };
  }

  if (input.invitation.status === "revoked") {
    return {
      ...base,
      reviewState: "revoked",
      resendAction: "blocked",
      reason: "Invitation was revoked and must not be resent."
    };
  }

  if (input.invitation.status === "expired" || hoursUntilExpiration <= 0) {
    return {
      ...base,
      reviewState: "expired",
      resendAction: "review_resend",
      reason: "Invitation has expired; resend requires a new delivery flow."
    };
  }

  if (hoursUntilExpiration <= expiringSoonHours) {
    return {
      ...base,
      reviewState: "expiring_soon",
      resendAction: "review_resend",
      reason: "Invitation expires soon; confirm recipient before resend."
    };
  }

  return {
    ...base,
    reviewState: "active",
    resendAction: "not_needed",
    reason: "Invitation is still active."
  };
}

export function createInvitationReviewSummary(input: {
  invitations: InvitationReviewTarget[];
  now?: Date;
  expiringSoonHours?: number;
}): InvitationReviewSummary {
  const reviews = input.invitations.map((invitation) =>
    createInvitationReview({
      invitation,
      now: input.now,
      expiringSoonHours: input.expiringSoonHours
    })
  );

  return {
    totalCount: reviews.length,
    pendingCount: reviews.filter((review) => review.status === "pending").length,
    acceptedCount: reviews.filter((review) => review.reviewState === "accepted")
      .length,
    revokedCount: reviews.filter((review) => review.reviewState === "revoked")
      .length,
    expiredCount: reviews.filter((review) => review.reviewState === "expired")
      .length,
    expiringSoonCount: reviews.filter(
      (review) => review.reviewState === "expiring_soon"
    ).length,
    resendReviewCount: reviews.filter(
      (review) => review.resendAction === "review_resend"
    ).length,
    tokenExposure: "not_exposed",
    reviews
  };
}

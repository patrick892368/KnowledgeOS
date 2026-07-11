import type { PersistedInvitationDeliveryAttempt } from "@/db/invitation-delivery-attempt-repository";

export interface InvitationDispatchReconciliationEnvironment {
  [key: string]: string | undefined;
  KNOWLEDGEOS_INVITATION_RECONCILIATION_STALE_SECONDS?: string;
}

export interface InvitationDispatchReconciliationConfig {
  stalePreparedSeconds: number;
}

export type InvitationDispatchReviewState =
  | "recent_prepared"
  | "reconciliation_required"
  | "accepted_by_provider"
  | "provider_failed";

export type InvitationDispatchReviewAction =
  | "wait_for_provider_state"
  | "manual_reconciliation_required"
  | "none";

export interface InvitationDispatchReconciliationReview {
  id: string;
  invitationId: string;
  provider: string;
  attemptStatus: PersistedInvitationDeliveryAttempt["status"];
  reviewState: InvitationDispatchReviewState;
  recommendedAction: InvitationDispatchReviewAction;
  providerMessageId: string | null;
  failureCode: string | null;
  preparedAt: Date;
  providerAcceptedAt: Date | null;
  providerFailedAt: Date | null;
  updatedAt: Date;
  ageSeconds: number;
  deliveryClaim: "provider_status_only";
  tokenExposure: "not_exposed";
}

export interface InvitationDispatchReconciliationSummary {
  totalCount: number;
  recentPreparedCount: number;
  reconciliationRequiredCount: number;
  acceptedByProviderCount: number;
  providerFailedCount: number;
  stalePreparedSeconds: number;
  deliveryClaim: "provider_status_only";
  tokenExposure: "not_exposed";
}

export class InvitationDispatchReconciliationConfigurationError extends Error {
  constructor(
    message = "Invitation dispatch reconciliation configuration is invalid."
  ) {
    super(message);
    this.name = "InvitationDispatchReconciliationConfigurationError";
  }
}

const defaultStalePreparedSeconds = 300;

function configurationError(): never {
  throw new InvitationDispatchReconciliationConfigurationError();
}

function parseStalePreparedSeconds(value: number): number {
  return Number.isInteger(value) && value >= 60 && value <= 86_400
    ? value
    : configurationError();
}

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Invitation dispatch reconciliation date is invalid.");
  }
}

export function createInvitationDispatchReconciliationConfig(
  input: InvitationDispatchReconciliationConfig = {
    stalePreparedSeconds: defaultStalePreparedSeconds
  }
): InvitationDispatchReconciliationConfig {
  return Object.freeze({
    stalePreparedSeconds: parseStalePreparedSeconds(input.stalePreparedSeconds)
  });
}

export function createInvitationDispatchReconciliationConfigFromEnvironment(
  environment: InvitationDispatchReconciliationEnvironment = process.env
): InvitationDispatchReconciliationConfig {
  const value =
    environment.KNOWLEDGEOS_INVITATION_RECONCILIATION_STALE_SECONDS?.trim();

  return createInvitationDispatchReconciliationConfig({
    stalePreparedSeconds: value
      ? parseStalePreparedSeconds(Number(value))
      : defaultStalePreparedSeconds
  });
}

export function createInvitationDispatchReconciliationReview(input: {
  attempt: PersistedInvitationDeliveryAttempt;
  config?: InvitationDispatchReconciliationConfig;
  now?: Date;
}): InvitationDispatchReconciliationReview {
  const config = createInvitationDispatchReconciliationConfig(input.config);
  const now = input.now ?? new Date();
  assertValidDate(now);
  assertValidDate(input.attempt.preparedAt);
  assertValidDate(input.attempt.updatedAt);

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - input.attempt.preparedAt.getTime()) / 1_000)
  );
  let reviewState: InvitationDispatchReviewState;
  let recommendedAction: InvitationDispatchReviewAction;

  if (input.attempt.status === "accepted_by_provider") {
    reviewState = "accepted_by_provider";
    recommendedAction = "none";
  } else if (input.attempt.status === "provider_failed") {
    reviewState = "provider_failed";
    recommendedAction = "none";
  } else if (ageSeconds >= config.stalePreparedSeconds) {
    reviewState = "reconciliation_required";
    recommendedAction = "manual_reconciliation_required";
  } else {
    reviewState = "recent_prepared";
    recommendedAction = "wait_for_provider_state";
  }

  return {
    id: input.attempt.id,
    invitationId: input.attempt.invitationId,
    provider: input.attempt.provider,
    attemptStatus: input.attempt.status,
    reviewState,
    recommendedAction,
    providerMessageId: input.attempt.providerMessageId,
    failureCode: input.attempt.failureCode,
    preparedAt: input.attempt.preparedAt,
    providerAcceptedAt: input.attempt.providerAcceptedAt,
    providerFailedAt: input.attempt.providerFailedAt,
    updatedAt: input.attempt.updatedAt,
    ageSeconds,
    deliveryClaim: "provider_status_only",
    tokenExposure: "not_exposed"
  };
}

export function createInvitationDispatchReconciliationSummary(input: {
  reviews: InvitationDispatchReconciliationReview[];
  config?: InvitationDispatchReconciliationConfig;
}): InvitationDispatchReconciliationSummary {
  const config = createInvitationDispatchReconciliationConfig(input.config);

  return {
    totalCount: input.reviews.length,
    recentPreparedCount: input.reviews.filter(
      (review) => review.reviewState === "recent_prepared"
    ).length,
    reconciliationRequiredCount: input.reviews.filter(
      (review) => review.reviewState === "reconciliation_required"
    ).length,
    acceptedByProviderCount: input.reviews.filter(
      (review) => review.reviewState === "accepted_by_provider"
    ).length,
    providerFailedCount: input.reviews.filter(
      (review) => review.reviewState === "provider_failed"
    ).length,
    stalePreparedSeconds: config.stalePreparedSeconds,
    deliveryClaim: "provider_status_only",
    tokenExposure: "not_exposed"
  };
}

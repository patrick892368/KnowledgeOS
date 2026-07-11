export type InvitationDispatchReviewAttemptStatus =
  | "prepared"
  | "accepted_by_provider"
  | "provider_failed";

export type InvitationDispatchReviewUiState =
  | "recent_prepared"
  | "reconciliation_required"
  | "accepted_by_provider"
  | "provider_failed";

export type InvitationDispatchReviewUiAction =
  | "wait_for_provider_state"
  | "manual_reconciliation_required"
  | "none";

export interface InvitationDispatchReviewUiRecord {
  id: string;
  invitationId: string;
  provider: string;
  attemptStatus: InvitationDispatchReviewAttemptStatus;
  reviewState: InvitationDispatchReviewUiState;
  recommendedAction: InvitationDispatchReviewUiAction;
  providerMessageId: string | null;
  failureCode: string | null;
  preparedAt: string;
  providerAcceptedAt: string | null;
  providerFailedAt: string | null;
  updatedAt: string;
  ageSeconds: number;
}

export interface InvitationDispatchReviewUiSummary {
  totalCount: number;
  recentPreparedCount: number;
  reconciliationRequiredCount: number;
  acceptedByProviderCount: number;
  providerFailedCount: number;
  stalePreparedSeconds: number;
}

export interface InvitationDispatchReviewUiResult {
  summary: InvitationDispatchReviewUiSummary;
  reviews: InvitationDispatchReviewUiRecord[];
}

export class InvitationDispatchReviewUiError extends Error {
  constructor(message = "Invitation dispatch review response is invalid.") {
    super(message);
    this.name = "InvitationDispatchReviewUiError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providerPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const failureCodePattern = /^[a-z][a-z0-9_]{0,79}$/;

function invalidResponse(): never {
  throw new InvitationDispatchReviewUiError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalidResponse();
}

function readString(
  value: unknown,
  options: { maxLength: number; pattern?: RegExp }
): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  const containsControlCharacter = Array.from(candidate).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !candidate ||
    candidate.length > options.maxLength ||
    containsControlCharacter ||
    (options.pattern && !options.pattern.test(candidate))
  ) {
    return invalidResponse();
  }

  return candidate;
}

function readNullableString(
  value: unknown,
  options: { maxLength: number; pattern?: RegExp }
): string | null {
  return value === null ? null : readString(value, options);
}

function readUuid(value: unknown): string {
  return readString(value, { maxLength: 36, pattern: uuidPattern });
}

function readInteger(
  value: unknown,
  options: { minimum: number; maximum: number }
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < options.minimum ||
    value > options.maximum
  ) {
    return invalidResponse();
  }

  return value;
}

function readDate(value: unknown): string {
  const date = readString(value, { maxLength: 40 });
  const parsed = new Date(date);

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== date) {
    return invalidResponse();
  }

  return date;
}

function readNullableDate(value: unknown): string | null {
  return value === null ? null : readDate(value);
}

function readAttemptStatus(
  value: unknown
): InvitationDispatchReviewAttemptStatus {
  if (
    value !== "prepared" &&
    value !== "accepted_by_provider" &&
    value !== "provider_failed"
  ) {
    return invalidResponse();
  }

  return value;
}

function readReviewState(value: unknown): InvitationDispatchReviewUiState {
  if (
    value !== "recent_prepared" &&
    value !== "reconciliation_required" &&
    value !== "accepted_by_provider" &&
    value !== "provider_failed"
  ) {
    return invalidResponse();
  }

  return value;
}

function readRecommendedAction(
  value: unknown
): InvitationDispatchReviewUiAction {
  if (
    value !== "wait_for_provider_state" &&
    value !== "manual_reconciliation_required" &&
    value !== "none"
  ) {
    return invalidResponse();
  }

  return value;
}

function assertReviewState(
  review: InvitationDispatchReviewUiRecord,
  stalePreparedSeconds: number
): void {
  const preparedStateIsValid =
    review.attemptStatus === "prepared" &&
    review.providerMessageId === null &&
    review.failureCode === null &&
    review.providerAcceptedAt === null &&
    review.providerFailedAt === null &&
    ((review.reviewState === "recent_prepared" &&
      review.recommendedAction === "wait_for_provider_state" &&
      review.ageSeconds < stalePreparedSeconds) ||
      (review.reviewState === "reconciliation_required" &&
        review.recommendedAction === "manual_reconciliation_required" &&
        review.ageSeconds >= stalePreparedSeconds));
  const acceptedStateIsValid =
    review.attemptStatus === "accepted_by_provider" &&
    review.reviewState === "accepted_by_provider" &&
    review.recommendedAction === "none" &&
    review.providerMessageId !== null &&
    review.failureCode === null &&
    review.providerAcceptedAt !== null &&
    review.providerFailedAt === null;
  const failedStateIsValid =
    review.attemptStatus === "provider_failed" &&
    review.reviewState === "provider_failed" &&
    review.recommendedAction === "none" &&
    review.providerMessageId === null &&
    review.failureCode !== null &&
    review.providerAcceptedAt === null &&
    review.providerFailedAt !== null;

  if (!preparedStateIsValid && !acceptedStateIsValid && !failedStateIsValid) {
    invalidResponse();
  }
}

function parseReview(
  value: unknown,
  stalePreparedSeconds: number,
  expectedInvitationId?: string
): InvitationDispatchReviewUiRecord {
  const review = readRecord(value);

  if (
    review.deliveryClaim !== "provider_status_only" ||
    review.tokenExposure !== "not_exposed"
  ) {
    return invalidResponse();
  }

  const parsed: InvitationDispatchReviewUiRecord = {
    id: readUuid(review.id),
    invitationId: readUuid(review.invitationId),
    provider: readString(review.provider, {
      maxLength: 64,
      pattern: providerPattern
    }),
    attemptStatus: readAttemptStatus(review.attemptStatus),
    reviewState: readReviewState(review.reviewState),
    recommendedAction: readRecommendedAction(review.recommendedAction),
    providerMessageId: readNullableString(review.providerMessageId, {
      maxLength: 256
    }),
    failureCode: readNullableString(review.failureCode, {
      maxLength: 80,
      pattern: failureCodePattern
    }),
    preparedAt: readDate(review.preparedAt),
    providerAcceptedAt: readNullableDate(review.providerAcceptedAt),
    providerFailedAt: readNullableDate(review.providerFailedAt),
    updatedAt: readDate(review.updatedAt),
    ageSeconds: readInteger(review.ageSeconds, {
      minimum: 0,
      maximum: 4_294_967_295
    })
  };

  if (
    (expectedInvitationId && parsed.invitationId !== expectedInvitationId) ||
    new Date(parsed.updatedAt).getTime() < new Date(parsed.preparedAt).getTime()
  ) {
    return invalidResponse();
  }

  const terminalAt = parsed.providerAcceptedAt ?? parsed.providerFailedAt;

  if (
    terminalAt &&
    (new Date(terminalAt).getTime() < new Date(parsed.preparedAt).getTime() ||
      new Date(parsed.updatedAt).getTime() < new Date(terminalAt).getTime())
  ) {
    return invalidResponse();
  }

  assertReviewState(parsed, stalePreparedSeconds);
  return parsed;
}

export function createInvitationDispatchReviewQuery(input: {
  invitationId?: string;
  limit?: number;
} = {}): string {
  const invitationId = input.invitationId?.trim();
  const limit = input.limit ?? 50;

  if (invitationId && !uuidPattern.test(invitationId)) {
    throw new InvitationDispatchReviewUiError(
      "Invitation filter must be a valid UUID."
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvitationDispatchReviewUiError(
      "Invitation dispatch review limit must be between 1 and 100."
    );
  }

  const query = new URLSearchParams({ limit: String(limit) });

  if (invitationId) {
    query.set("invitationId", invitationId);
  }

  return `?${query.toString()}`;
}

export function parseInvitationDispatchReviewUiResponse(
  payload: unknown,
  options: { invitationId?: string } = {}
): InvitationDispatchReviewUiResult {
  const root = readRecord(payload);
  const summaryValue = readRecord(root.summary);

  if (
    summaryValue.deliveryClaim !== "provider_status_only" ||
    summaryValue.tokenExposure !== "not_exposed" ||
    !Array.isArray(root.reviews) ||
    root.reviews.length > 100
  ) {
    return invalidResponse();
  }

  const stalePreparedSeconds = readInteger(
    summaryValue.stalePreparedSeconds,
    { minimum: 60, maximum: 86_400 }
  );
  const expectedInvitationId = options.invitationId
    ? readUuid(options.invitationId)
    : undefined;
  const reviews = root.reviews.map((review) =>
    parseReview(review, stalePreparedSeconds, expectedInvitationId)
  );

  if (new Set(reviews.map((review) => review.id)).size !== reviews.length) {
    return invalidResponse();
  }

  const summary: InvitationDispatchReviewUiSummary = {
    totalCount: readInteger(summaryValue.totalCount, {
      minimum: 0,
      maximum: 100
    }),
    recentPreparedCount: readInteger(summaryValue.recentPreparedCount, {
      minimum: 0,
      maximum: 100
    }),
    reconciliationRequiredCount: readInteger(
      summaryValue.reconciliationRequiredCount,
      { minimum: 0, maximum: 100 }
    ),
    acceptedByProviderCount: readInteger(summaryValue.acceptedByProviderCount, {
      minimum: 0,
      maximum: 100
    }),
    providerFailedCount: readInteger(summaryValue.providerFailedCount, {
      minimum: 0,
      maximum: 100
    }),
    stalePreparedSeconds
  };
  const expectedCounts = {
    totalCount: reviews.length,
    recentPreparedCount: reviews.filter(
      (review) => review.reviewState === "recent_prepared"
    ).length,
    reconciliationRequiredCount: reviews.filter(
      (review) => review.reviewState === "reconciliation_required"
    ).length,
    acceptedByProviderCount: reviews.filter(
      (review) => review.reviewState === "accepted_by_provider"
    ).length,
    providerFailedCount: reviews.filter(
      (review) => review.reviewState === "provider_failed"
    ).length
  };

  if (
    summary.totalCount !== expectedCounts.totalCount ||
    summary.recentPreparedCount !== expectedCounts.recentPreparedCount ||
    summary.reconciliationRequiredCount !==
      expectedCounts.reconciliationRequiredCount ||
    summary.acceptedByProviderCount !==
      expectedCounts.acceptedByProviderCount ||
    summary.providerFailedCount !== expectedCounts.providerFailedCount
  ) {
    return invalidResponse();
  }

  return { summary, reviews };
}

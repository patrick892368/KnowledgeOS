import type { InvitationDispatchReviewUiRecord } from "./dispatch-reconciliation-ui";

export type InvitationDeliveryEvidenceUiType =
  | "sent_by_provider"
  | "delivered_to_recipient_server"
  | "delivery_delayed"
  | "bounced"
  | "delivery_failed"
  | "suppressed"
  | "complained";

export interface InvitationDeliveryEvidenceUiRecord {
  id: string;
  invitationId: string;
  deliveryAttemptId: string;
  provider: string;
  providerEventId: string;
  providerEventType: string;
  evidenceType: InvitationDeliveryEvidenceUiType;
  providerMessageId: string;
  occurredAt: string;
  receivedAt: string;
}

export interface InvitationDeliveryEvidenceUiResult {
  attemptId: string;
  count: number;
  evidence: InvitationDeliveryEvidenceUiRecord[];
}

export interface InvitationDeliveryReconciliationRequest {
  attemptId: string;
  evidenceId: string;
}

export interface InvitationDeliveryReconciliationUiResult {
  mode: "reconciled" | "existing";
  attempt: {
    id: string;
    invitationId: string;
    provider: string;
    status: "accepted_by_provider";
    providerMessageId: string;
    providerAcceptedAt: string;
    updatedAt: string;
  };
  evidence: {
    id: string;
    providerEventType: string;
    evidenceType: InvitationDeliveryEvidenceUiType;
    occurredAt: string;
  };
}

export class InvitationDeliveryEvidenceUiError extends Error {
  constructor(message = "Invitation delivery evidence response is invalid.") {
    super(message);
    this.name = "InvitationDeliveryEvidenceUiError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providerPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const eventIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const eventEvidence = {
  "email.sent": "sent_by_provider",
  "email.delivered": "delivered_to_recipient_server",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.failed": "delivery_failed",
  "email.suppressed": "suppressed",
  "email.complained": "complained"
} as const satisfies Record<string, InvitationDeliveryEvidenceUiType>;
const forbiddenKeys = new Set([
  "organizationid",
  "actoruserid",
  "recipient",
  "recipientemail",
  "recipientaddress",
  "email",
  "emailaddress",
  "sender",
  "subject",
  "from",
  "to",
  "rawtoken",
  "tokenhash",
  "rawpayload",
  "signature",
  "secret",
  "signingsecret",
  "rawerror",
  "auditevent",
  "auditevents",
  "inboxdelivered"
]);

function invalidResponse(message?: string): never {
  throw new InvitationDeliveryEvidenceUiError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalidResponse();
}

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) {
      invalidResponse();
    }
    assertNoForbiddenKeys(nested);
  }
}

function readString(
  value: unknown,
  options: { maximumLength: number; pattern?: RegExp }
): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  const containsControlCharacter = Array.from(candidate).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !candidate ||
    candidate.length > options.maximumLength ||
    containsControlCharacter ||
    (options.pattern && !options.pattern.test(candidate))
  ) {
    return invalidResponse();
  }

  return candidate;
}

function readUuid(value: unknown): string {
  return readString(value, { maximumLength: 36, pattern: uuidPattern });
}

function readDate(value: unknown): string {
  const candidate = readString(value, { maximumLength: 40 });
  const parsed = new Date(candidate);

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== candidate) {
    return invalidResponse();
  }

  return candidate;
}

function readEvidenceType(value: unknown): InvitationDeliveryEvidenceUiType {
  if (!Object.values(eventEvidence).includes(value as never)) {
    return invalidResponse();
  }

  return value as InvitationDeliveryEvidenceUiType;
}

function parseEvidence(
  value: unknown,
  expected: {
    attemptId: string;
    invitationId?: string;
    provider?: string;
  }
): InvitationDeliveryEvidenceUiRecord {
  const evidence = readRecord(value);

  if (
    evidence.deliveryClaim !== "provider_status_only" ||
    evidence.inboxDeliveryClaim !== "not_claimed" ||
    evidence.tokenExposure !== "not_exposed"
  ) {
    return invalidResponse();
  }

  const providerEventType = readString(evidence.providerEventType, {
    maximumLength: 64
  });
  const evidenceType = readEvidenceType(evidence.evidenceType);
  const parsed: InvitationDeliveryEvidenceUiRecord = {
    id: readUuid(evidence.id),
    invitationId: readUuid(evidence.invitationId),
    deliveryAttemptId: readUuid(evidence.deliveryAttemptId),
    provider: readString(evidence.provider, {
      maximumLength: 64,
      pattern: providerPattern
    }),
    providerEventId: readString(evidence.providerEventId, {
      maximumLength: 128,
      pattern: eventIdPattern
    }),
    providerEventType,
    evidenceType,
    providerMessageId: readString(evidence.providerMessageId, {
      maximumLength: 256
    }),
    occurredAt: readDate(evidence.occurredAt),
    receivedAt: readDate(evidence.receivedAt)
  };

  if (
    parsed.deliveryAttemptId !== expected.attemptId ||
    (expected.invitationId && parsed.invitationId !== expected.invitationId) ||
    (expected.provider && parsed.provider !== expected.provider) ||
    !Object.hasOwn(eventEvidence, parsed.providerEventType) ||
    eventEvidence[parsed.providerEventType as keyof typeof eventEvidence] !==
      parsed.evidenceType ||
    new Date(parsed.receivedAt).getTime() <
      new Date(parsed.occurredAt).getTime() - 300_000
  ) {
    return invalidResponse();
  }

  return parsed;
}

function compareEvidenceDescending(
  left: InvitationDeliveryEvidenceUiRecord,
  right: InvitationDeliveryEvidenceUiRecord
): number {
  const occurrenceDifference =
    new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();

  if (occurrenceDifference !== 0) {
    return occurrenceDifference;
  }

  const receiptDifference =
    new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();

  return receiptDifference !== 0
    ? receiptDifference
    : right.id.localeCompare(left.id);
}

export function createInvitationDeliveryEvidenceReviewQuery(input: {
  attemptId: string;
  limit?: number;
}): string {
  const attemptId = input.attemptId.trim();
  const limit = input.limit ?? 50;

  if (!uuidPattern.test(attemptId)) {
    throw new InvitationDeliveryEvidenceUiError(
      "Invitation delivery attempt ID must be a valid UUID."
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvitationDeliveryEvidenceUiError(
      "Invitation delivery evidence limit must be between 1 and 100."
    );
  }

  return `?${new URLSearchParams({
    attemptId,
    limit: String(limit)
  }).toString()}`;
}

export function parseInvitationDeliveryEvidenceUiResponse(
  payload: unknown,
  expected: {
    attemptId: string;
    invitationId?: string;
    provider?: string;
  }
): InvitationDeliveryEvidenceUiResult {
  assertNoForbiddenKeys(payload);
  const root = readRecord(payload);
  const expectedAttemptId = readUuid(expected.attemptId);

  if (
    root.deliveryClaim !== "provider_status_only" ||
    root.inboxDeliveryClaim !== "not_claimed" ||
    root.tokenExposure !== "not_exposed" ||
    !Array.isArray(root.evidence) ||
    root.evidence.length > 100
  ) {
    return invalidResponse();
  }

  const attemptId = readUuid(root.attemptId);
  const count = root.count;

  if (
    attemptId !== expectedAttemptId ||
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count !== root.evidence.length
  ) {
    return invalidResponse();
  }

  const evidence = root.evidence.map((item) =>
    parseEvidence(item, {
      attemptId,
      ...(expected.invitationId
        ? { invitationId: readUuid(expected.invitationId) }
        : {}),
      ...(expected.provider
        ? {
            provider: readString(expected.provider, {
              maximumLength: 64,
              pattern: providerPattern
            })
          }
        : {})
    })
  );

  if (
    new Set(evidence.map((item) => item.id)).size !== evidence.length ||
    new Set(evidence.map((item) => item.providerEventId)).size !==
      evidence.length ||
    evidence.some(
      (item, index) =>
        index > 0 && compareEvidenceDescending(evidence[index - 1], item) > 0
    )
  ) {
    return invalidResponse();
  }

  return { attemptId, count, evidence };
}

export function createInvitationDeliveryReconciliationRequest(input: {
  review: InvitationDispatchReviewUiRecord;
  evidence: InvitationDeliveryEvidenceUiRecord;
}): InvitationDeliveryReconciliationRequest {
  const { review, evidence } = input;
  const attemptId = readUuid(review.id);
  const evidenceId = readUuid(evidence.id);
  const invitationId = readUuid(review.invitationId);
  const preparedAt = readDate(review.preparedAt);
  const occurredAt = readDate(evidence.occurredAt);
  const reviewProvider = readString(review.provider, {
    maximumLength: 64,
    pattern: providerPattern
  });
  const provider = readString(evidence.provider, {
    maximumLength: 64,
    pattern: providerPattern
  });
  const providerEventType = readString(evidence.providerEventType, {
    maximumLength: 64
  });
  const evidenceType = readEvidenceType(evidence.evidenceType);

  readString(evidence.providerEventId, {
    maximumLength: 128,
    pattern: eventIdPattern
  });
  readString(evidence.providerMessageId, { maximumLength: 256 });

  if (
    review.reviewState !== "reconciliation_required" ||
    review.recommendedAction !== "manual_reconciliation_required" ||
    review.attemptStatus !== "prepared" ||
    review.providerMessageId !== null ||
    attemptId !== readUuid(evidence.deliveryAttemptId) ||
    invitationId !== readUuid(evidence.invitationId) ||
    reviewProvider !== provider ||
    !Object.hasOwn(eventEvidence, providerEventType) ||
    eventEvidence[providerEventType as keyof typeof eventEvidence] !==
      evidenceType ||
    new Date(occurredAt).getTime() < new Date(preparedAt).getTime() - 300_000
  ) {
    throw new InvitationDeliveryEvidenceUiError(
      "Invitation delivery evidence is not eligible for reconciliation."
    );
  }

  return Object.freeze({ attemptId, evidenceId });
}

export function parseInvitationDeliveryReconciliationUiResponse(
  payload: unknown,
  expected: {
    request: InvitationDeliveryReconciliationRequest;
    review: InvitationDispatchReviewUiRecord;
    evidence: InvitationDeliveryEvidenceUiRecord;
  }
): InvitationDeliveryReconciliationUiResult {
  assertNoForbiddenKeys(payload);
  const root = readRecord(payload);
  const attempt = readRecord(root.attempt);
  const evidence = readRecord(root.evidence);

  if (
    (root.mode !== "reconciled" && root.mode !== "existing") ||
    root.deliveryClaim !== "provider_status_only" ||
    root.inboxDeliveryClaim !== "not_claimed" ||
    root.tokenExposure !== "not_exposed" ||
    attempt.deliveryClaim !== "provider_status_only" ||
    attempt.tokenExposure !== "not_exposed" ||
    evidence.inboxDeliveryClaim !== "not_claimed" ||
    evidence.tokenExposure !== "not_exposed"
  ) {
    return invalidResponse();
  }

  const parsed: InvitationDeliveryReconciliationUiResult = {
    mode: root.mode,
    attempt: {
      id: readUuid(attempt.id),
      invitationId: readUuid(attempt.invitationId),
      provider: readString(attempt.provider, {
        maximumLength: 64,
        pattern: providerPattern
      }),
      status:
        attempt.status === "accepted_by_provider"
          ? "accepted_by_provider"
          : invalidResponse(),
      providerMessageId: readString(attempt.providerMessageId, {
        maximumLength: 256
      }),
      providerAcceptedAt: readDate(attempt.providerAcceptedAt),
      updatedAt: readDate(attempt.updatedAt)
    },
    evidence: {
      id: readUuid(evidence.id),
      providerEventType: readString(evidence.providerEventType, {
        maximumLength: 64
      }),
      evidenceType: readEvidenceType(evidence.evidenceType),
      occurredAt: readDate(evidence.occurredAt)
    }
  };

  if (
    parsed.attempt.id !== expected.request.attemptId ||
    parsed.evidence.id !== expected.request.evidenceId ||
    parsed.attempt.id !== expected.review.id ||
    parsed.attempt.invitationId !== expected.review.invitationId ||
    parsed.attempt.provider !== expected.review.provider ||
    parsed.evidence.id !== expected.evidence.id ||
    parsed.attempt.providerMessageId !== expected.evidence.providerMessageId ||
    parsed.attempt.providerAcceptedAt !== expected.evidence.occurredAt ||
    parsed.evidence.providerEventType !== expected.evidence.providerEventType ||
    parsed.evidence.evidenceType !== expected.evidence.evidenceType ||
    parsed.evidence.occurredAt !== expected.evidence.occurredAt ||
    new Date(parsed.attempt.updatedAt).getTime() <
      new Date(parsed.attempt.providerAcceptedAt).getTime()
  ) {
    return invalidResponse();
  }

  return parsed;
}

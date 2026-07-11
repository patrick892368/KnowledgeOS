export type InvitationDispatchAttemptStatus =
  | "prepared"
  | "accepted_by_provider"
  | "provider_failed";

export type InvitationDispatchUiPhase =
  | "submitting"
  | "accepted_by_provider"
  | "existing_attempt"
  | "provider_failed"
  | "policy_denied"
  | "reconciliation_required"
  | "request_failed";

export interface InvitationDispatchUiState {
  invitationId: string;
  attemptId: string;
  phase: InvitationDispatchUiPhase;
  attemptStatus?: InvitationDispatchAttemptStatus;
  provider?: string;
  providerMessageId?: string;
  failureCode?: string;
  message: string;
}

export interface InvitationDispatchRequest {
  invitationId: string;
  attemptId: string;
}

export class InvitationDispatchUiError extends Error {
  constructor(message = "Invitation dispatch response is invalid.") {
    super(message);
    this.name = "InvitationDispatchUiError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providerPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const codePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const maxMessageLength = 320;
const maxProviderMessageIdLength = 256;

function invalidResponse(): never {
  throw new InvitationDispatchUiError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(
  value: unknown,
  key: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalidResponse();
  }

  const nested = value[key];
  return isRecord(nested) ? nested : invalidResponse();
}

function readString(
  value: unknown,
  options: { maxLength?: number; pattern?: RegExp } = {}
): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  const containsControlCharacter = Array.from(candidate).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !candidate ||
    candidate.length > (options.maxLength ?? maxMessageLength) ||
    (options.pattern && !options.pattern.test(candidate)) ||
    containsControlCharacter
  ) {
    return invalidResponse();
  }

  return candidate;
}

function readUuid(value: unknown): string {
  return readString(value, { maxLength: 36, pattern: uuidPattern });
}

function readAttemptStatus(value: unknown): InvitationDispatchAttemptStatus {
  if (
    value !== "prepared" &&
    value !== "accepted_by_provider" &&
    value !== "provider_failed"
  ) {
    return invalidResponse();
  }

  return value;
}

function assertPublicMarkers(payload: Record<string, unknown>): void {
  const attempt = readRecord(payload, "attempt");

  if (
    payload.deliveryClaim !== "provider_status_only" ||
    payload.tokenExposure !== "not_exposed" ||
    attempt.deliveryClaim !== "provider_status_only" ||
    attempt.tokenExposure !== "not_exposed"
  ) {
    invalidResponse();
  }
}

function parseApiError(
  payload: Record<string, unknown>,
  expected: InvitationDispatchRequest
): InvitationDispatchUiState | null {
  if (!("error" in payload)) {
    return null;
  }

  const error = readRecord(payload, "error");
  const code = readString(error.code, { pattern: codePattern });
  const message = readString(error.message);

  if (code === "provider_status_persistence_failed") {
    if (
      readUuid(error.attemptId) !== expected.attemptId ||
      error.providerAccepted !== true
    ) {
      return invalidResponse();
    }

    return {
      invitationId: expected.invitationId,
      attemptId: expected.attemptId,
      phase: "reconciliation_required",
      providerMessageId:
        error.providerMessageId === undefined
          ? undefined
          : readString(error.providerMessageId, {
              maxLength: maxProviderMessageIdLength
            }),
      message
    };
  }

  return {
    invitationId: expected.invitationId,
    attemptId: expected.attemptId,
    phase: "request_failed",
    failureCode: code,
    message
  };
}

export function createInvitationDispatchRequest(input: {
  invitationId: string;
  current?: InvitationDispatchUiState;
  createAttemptId?: () => string;
}): {
  request: InvitationDispatchRequest;
  state: InvitationDispatchUiState;
} {
  const invitationId = readUuid(input.invitationId);
  const shouldReuseAttempt = input.current?.phase === "request_failed";
  const attemptId = shouldReuseAttempt
    ? readUuid(input.current?.attemptId)
    : readUuid((input.createAttemptId ?? (() => crypto.randomUUID()))());
  const request = { invitationId, attemptId };

  return {
    request,
    state: {
      ...request,
      phase: "submitting",
      message: "Submitting invitation email to the provider."
    }
  };
}

export function createInvitationDispatchRequestFailure(
  state: InvitationDispatchUiState
): InvitationDispatchUiState {
  if (state.phase !== "submitting") {
    throw new InvitationDispatchUiError(
      "Only a submitting invitation dispatch can fail at the request boundary."
    );
  }

  return {
    invitationId: state.invitationId,
    attemptId: state.attemptId,
    phase: "request_failed",
    failureCode: "request_failed",
    message: "Dispatch status is unknown. Retry will reuse this attempt."
  };
}

export function parseInvitationDispatchUiOutcome(
  payload: unknown,
  expected: InvitationDispatchRequest
): InvitationDispatchUiState {
  if (!isRecord(payload)) {
    return invalidResponse();
  }

  const apiError = parseApiError(payload, expected);

  if (apiError) {
    return apiError;
  }

  assertPublicMarkers(payload);

  const mode = payload.mode;
  const invitation = readRecord(payload, "invitation");
  const attempt = readRecord(payload, "attempt");
  const invitationId = readUuid(invitation.id);
  const attemptId = readUuid(attempt.id);
  const attemptInvitationId = readUuid(attempt.invitationId);
  const attemptStatus = readAttemptStatus(attempt.status);
  const provider = readString(attempt.provider, { pattern: providerPattern });
  const attemptProviderMessageId =
    attempt.providerMessageId === null || attempt.providerMessageId === undefined
      ? undefined
      : readString(attempt.providerMessageId, {
          maxLength: maxProviderMessageIdLength
        });
  const attemptFailureCode =
    attempt.failureCode === null || attempt.failureCode === undefined
      ? undefined
      : readString(attempt.failureCode, { pattern: codePattern });

  if (
    invitationId !== expected.invitationId ||
    attemptId !== expected.attemptId ||
    attemptInvitationId !== expected.invitationId
  ) {
    return invalidResponse();
  }

  if (mode === "accepted_by_provider") {
    const receipt = readRecord(payload, "receipt");
    const receiptAttemptId = readUuid(receipt.deliveryAttemptId);
    const receiptInvitationId = readUuid(receipt.invitationId);
    const receiptProvider = readString(receipt.provider, {
      pattern: providerPattern
    });

    const receiptProviderMessageId = readString(receipt.providerMessageId, {
      maxLength: maxProviderMessageIdLength
    });

    if (
      attemptStatus !== "accepted_by_provider" ||
      attemptProviderMessageId !== receiptProviderMessageId ||
      attemptFailureCode !== undefined ||
      receipt.status !== "accepted_by_provider" ||
      receipt.tokenExposure !== "not_exposed" ||
      receiptAttemptId !== expected.attemptId ||
      receiptInvitationId !== expected.invitationId ||
      receiptProvider !== provider
    ) {
      return invalidResponse();
    }

    return {
      invitationId,
      attemptId,
      phase: "accepted_by_provider",
      attemptStatus,
      provider,
      providerMessageId: receiptProviderMessageId,
      message: "Accepted by provider; inbox delivery is not confirmed."
    };
  }

  if (mode === "provider_failed") {
    const failure = readRecord(payload, "failure");
    const failureCode = readString(failure.code, { pattern: codePattern });

    if (
      attemptStatus !== "provider_failed" ||
      attemptFailureCode !== failureCode ||
      attemptProviderMessageId !== undefined ||
      failure.recoverable !== true
    ) {
      return invalidResponse();
    }

    const policyDenied =
      failureCode === "dispatch_cooldown_active" ||
      failureCode === "dispatch_rate_limited";

    return {
      invitationId,
      attemptId,
      phase: policyDenied ? "policy_denied" : "provider_failed",
      attemptStatus,
      provider,
      failureCode,
      message:
        failureCode === "dispatch_cooldown_active"
          ? "Invitation dispatch cooldown is active."
          : failureCode === "dispatch_rate_limited"
            ? "Organization invitation dispatch rate limit is active."
            : "Provider did not accept this invitation email."
    };
  }

  if (mode === "existing_attempt") {
    const validExistingState =
      (attemptStatus === "prepared" &&
        attemptProviderMessageId === undefined &&
        attemptFailureCode === undefined) ||
      (attemptStatus === "accepted_by_provider" &&
        attemptProviderMessageId !== undefined &&
        attemptFailureCode === undefined) ||
      (attemptStatus === "provider_failed" &&
        attemptProviderMessageId === undefined &&
        attemptFailureCode !== undefined);

    if (!validExistingState) {
      return invalidResponse();
    }

    return {
      invitationId,
      attemptId,
      phase: "existing_attempt",
      attemptStatus,
      provider,
      providerMessageId: attemptProviderMessageId,
      failureCode: attemptFailureCode,
      message:
        attemptStatus === "accepted_by_provider"
          ? "Existing attempt was accepted by provider."
          : attemptStatus === "provider_failed"
            ? "Existing attempt failed at the provider."
            : "Existing prepared attempt requires review."
    };
  }

  return invalidResponse();
}

export function canStartInvitationDispatch(
  state: InvitationDispatchUiState | undefined
): boolean {
  return (
    !state ||
    state.phase === "request_failed" ||
    state.phase === "provider_failed" ||
    (state.phase === "existing_attempt" &&
      state.attemptStatus === "provider_failed")
  );
}

export function invitationDispatchActionLabel(
  state: InvitationDispatchUiState | undefined
): string {
  if (!state) {
    return "Send";
  }

  if (state.phase === "submitting") {
    return "Sending";
  }

  if (canStartInvitationDispatch(state)) {
    return "Retry";
  }

  if (
    state.phase === "accepted_by_provider" ||
    (state.phase === "existing_attempt" &&
      state.attemptStatus === "accepted_by_provider")
  ) {
    return "Accepted";
  }

  if (state.phase === "policy_denied") {
    return "Limited";
  }

  return "Review";
}

export function isInvitationDispatchEligible(
  invitation: { status: string; expiresAt: string },
  now = new Date()
): boolean {
  const expiresAt = new Date(invitation.expiresAt).getTime();

  return (
    invitation.status === "pending" &&
    Number.isFinite(expiresAt) &&
    expiresAt > now.getTime()
  );
}

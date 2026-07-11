import { describe, expect, it } from "vitest";

import {
  canStartInvitationDispatch,
  createInvitationDispatchRequest,
  createInvitationDispatchRequestFailure,
  InvitationDispatchUiError,
  invitationDispatchActionLabel,
  isInvitationDispatchEligible,
  parseInvitationDispatchUiOutcome,
  type InvitationDispatchRequest,
  type InvitationDispatchUiState
} from "./dispatch-ui";

const invitationId = "44444444-4444-4444-8444-444444444444";
const attemptId = "77777777-7777-4777-8777-777777777777";
const nextAttemptId = "88888888-8888-4888-8888-888888888888";
const expected: InvitationDispatchRequest = { invitationId, attemptId };

function attempt(status: string) {
  return {
    id: attemptId,
    invitationId,
    provider: "resend",
    status,
    providerMessageId:
      status === "accepted_by_provider" ? "provider-message-1" : null,
    failureCode: status === "provider_failed" ? "provider_failed" : null,
    deliveryClaim: "provider_status_only",
    tokenExposure: "not_exposed"
  };
}

function basePayload(mode: string, status: string) {
  return {
    mode,
    invitation: { id: invitationId, email: "member@example.com" },
    attempt: attempt(status),
    deliveryClaim: "provider_status_only",
    tokenExposure: "not_exposed"
  };
}

describe("createInvitationDispatchRequest", () => {
  it("creates an authority-minimal request with a new attempt ID", () => {
    const result = createInvitationDispatchRequest({
      invitationId,
      createAttemptId: () => attemptId
    });

    expect(result.request).toEqual({ invitationId, attemptId });
    expect(result.state).toMatchObject({
      invitationId,
      attemptId,
      phase: "submitting"
    });
    expect(JSON.stringify(result.request)).not.toMatch(
      /organization|token|provider|acceptance|ttl/i
    );
  });

  it("reuses an unknown request attempt but creates a new ID after Provider failure", () => {
    const requestFailed: InvitationDispatchUiState = {
      invitationId,
      attemptId,
      phase: "request_failed",
      message: "unknown"
    };
    const providerFailed: InvitationDispatchUiState = {
      invitationId,
      attemptId,
      phase: "provider_failed",
      attemptStatus: "provider_failed",
      message: "failed"
    };

    expect(
      createInvitationDispatchRequest({
        invitationId,
        current: requestFailed,
        createAttemptId: () => nextAttemptId
      }).request.attemptId
    ).toBe(attemptId);
    expect(
      createInvitationDispatchRequest({
        invitationId,
        current: providerFailed,
        createAttemptId: () => nextAttemptId
      }).request.attemptId
    ).toBe(nextAttemptId);
  });

  it("keeps request-boundary failure retry-safe", () => {
    const { state } = createInvitationDispatchRequest({
      invitationId,
      createAttemptId: () => attemptId
    });

    expect(createInvitationDispatchRequestFailure(state)).toEqual({
      invitationId,
      attemptId,
      phase: "request_failed",
      failureCode: "request_failed",
      message: "Dispatch status is unknown. Retry will reuse this attempt."
    });
  });
});

describe("parseInvitationDispatchUiOutcome", () => {
  it("selects only accepted-by-Provider public state", () => {
    const state = parseInvitationDispatchUiOutcome(
      {
        ...basePayload("accepted_by_provider", "accepted_by_provider"),
        receipt: {
          deliveryAttemptId: attemptId,
          invitationId,
          provider: "resend",
          providerMessageId: "provider-message-1",
          status: "accepted_by_provider",
          tokenExposure: "not_exposed",
          oneTimeToken: "must-not-be-selected"
        },
        auditEvents: { rawToken: "must-not-be-selected" }
      },
      expected
    );

    expect(state).toEqual({
      invitationId,
      attemptId,
      phase: "accepted_by_provider",
      attemptStatus: "accepted_by_provider",
      provider: "resend",
      providerMessageId: "provider-message-1",
      message: "Accepted by provider; inbox delivery is not confirmed."
    });
    expect(JSON.stringify(state)).not.toMatch(/must-not-be-selected|rawToken/);
  });

  it("parses bounded Provider failure state", () => {
    const state = parseInvitationDispatchUiOutcome(
      {
        ...basePayload("provider_failed", "provider_failed"),
        failure: { code: "provider_failed", recoverable: true }
      },
      expected
    );

    expect(state).toMatchObject({
      phase: "provider_failed",
      attemptStatus: "provider_failed",
      failureCode: "provider_failed",
      provider: "resend"
    });
    expect(canStartInvitationDispatch(state)).toBe(true);
  });

  it("preserves existing attempt status without claiming a new send", () => {
    for (const status of [
      "prepared",
      "accepted_by_provider",
      "provider_failed"
    ] as const) {
      const state = parseInvitationDispatchUiOutcome(
        basePayload("existing_attempt", status),
        expected
      );

      expect(state).toMatchObject({
        phase: "existing_attempt",
        attemptStatus: status
      });
      expect(canStartInvitationDispatch(state)).toBe(
        status === "provider_failed"
      );
    }
  });

  it("maps reconciliation errors to a non-retryable review state", () => {
    const state = parseInvitationDispatchUiOutcome(
      {
        error: {
          code: "provider_status_persistence_failed",
          message: "Invitation email status requires reconciliation.",
          attemptId,
          providerAccepted: true,
          providerMessageId: "provider-message-1"
        }
      },
      expected
    );

    expect(state).toMatchObject({
      phase: "reconciliation_required",
      attemptId,
      providerMessageId: "provider-message-1"
    });
    expect(canStartInvitationDispatch(state)).toBe(false);
    expect(invitationDispatchActionLabel(state)).toBe("Review");
  });

  it("maps safe API errors to retry-with-same-attempt state", () => {
    const state = parseInvitationDispatchUiOutcome(
      {
        error: {
          code: "database_unavailable",
          message: "Invitation email dispatch is temporarily unavailable."
        }
      },
      expected
    );

    expect(state).toMatchObject({
      phase: "request_failed",
      failureCode: "database_unavailable",
      attemptId
    });
    expect(canStartInvitationDispatch(state)).toBe(true);
    expect(
      createInvitationDispatchRequest({
        invitationId,
        current: state,
        createAttemptId: () => nextAttemptId
      }).request.attemptId
    ).toBe(attemptId);
  });

  it("rejects mismatched identities and unsafe status shapes", () => {
    const invalidPayloads = [
      {
        ...basePayload("existing_attempt", "prepared"),
        invitation: { id: nextAttemptId }
      },
      {
        ...basePayload("accepted_by_provider", "prepared"),
        receipt: {
          deliveryAttemptId: attemptId,
          invitationId,
          provider: "resend",
          providerMessageId: "provider-message-1",
          status: "accepted_by_provider",
          tokenExposure: "not_exposed"
        }
      },
      {
        ...basePayload("provider_failed", "provider_failed"),
        tokenExposure: "exposed",
        failure: { code: "provider_failed", recoverable: true }
      },
      {
        ...basePayload("existing_attempt", "prepared"),
        attempt: {
          ...attempt("prepared"),
          providerMessageId: "unexpected-message"
        }
      },
      {
        error: {
          code: "provider_status_persistence_failed",
          message: "reconcile",
          attemptId: nextAttemptId,
          providerAccepted: true
        }
      }
    ];

    for (const payload of invalidPayloads) {
      expect(() =>
        parseInvitationDispatchUiOutcome(payload, expected)
      ).toThrow(InvitationDispatchUiError);
    }
  });
});

describe("invitation dispatch UI policy", () => {
  it("allows only pending unexpired invitations", () => {
    const now = new Date("2026-07-11T00:00:00.000Z");

    expect(
      isInvitationDispatchEligible(
        { status: "pending", expiresAt: "2026-07-12T00:00:00.000Z" },
        now
      )
    ).toBe(true);
    expect(
      isInvitationDispatchEligible(
        { status: "pending", expiresAt: "2026-07-10T00:00:00.000Z" },
        now
      )
    ).toBe(false);
    expect(
      isInvitationDispatchEligible(
        { status: "revoked", expiresAt: "2026-07-12T00:00:00.000Z" },
        now
      )
    ).toBe(false);
    expect(
      isInvitationDispatchEligible(
        { status: "pending", expiresAt: "invalid" },
        now
      )
    ).toBe(false);
  });

  it("uses truthful action labels for terminal and retry states", () => {
    expect(invitationDispatchActionLabel(undefined)).toBe("Send");
    expect(
      invitationDispatchActionLabel({
        invitationId,
        attemptId,
        phase: "submitting",
        message: "sending"
      })
    ).toBe("Sending");
    expect(
      invitationDispatchActionLabel({
        invitationId,
        attemptId,
        phase: "accepted_by_provider",
        message: "accepted"
      })
    ).toBe("Accepted");
    expect(
      invitationDispatchActionLabel({
        invitationId,
        attemptId,
        phase: "provider_failed",
        message: "failed"
      })
    ).toBe("Retry");
  });
});

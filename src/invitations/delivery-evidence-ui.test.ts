import { describe, expect, it } from "vitest";

import type { InvitationDispatchReviewUiRecord } from "./dispatch-reconciliation-ui";
import {
  createInvitationDeliveryEvidenceReviewQuery,
  createInvitationDeliveryReconciliationRequest,
  InvitationDeliveryEvidenceUiError,
  parseInvitationDeliveryEvidenceUiResponse,
  parseInvitationDeliveryReconciliationUiResponse
} from "./delivery-evidence-ui";

const attemptId = "77777777-7777-4777-8777-777777777777";
const invitationId = "44444444-4444-4444-8444-444444444444";
const evidenceId = "88888888-8888-4888-8888-888888888888";
const secondEvidenceId = "99999999-9999-4999-8999-999999999999";
const providerMessageId = "56761188-7520-42d8-8898-ff6fc54ce618";
const preparedAt = "2026-07-11T00:00:00.000Z";
const occurredAt = "2026-07-11T00:05:00.000Z";
const receivedAt = "2026-07-11T00:05:01.000Z";
const review: InvitationDispatchReviewUiRecord = {
  id: attemptId,
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
  updatedAt: preparedAt,
  ageSeconds: 600
};
const evidence = {
  id: evidenceId,
  invitationId,
  deliveryAttemptId: attemptId,
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server" as const,
  providerMessageId,
  occurredAt,
  receivedAt,
  deliveryClaim: "provider_status_only",
  inboxDeliveryClaim: "not_claimed",
  tokenExposure: "not_exposed"
};
const evidencePayload = {
  attemptId,
  count: 1,
  evidence: [evidence],
  deliveryClaim: "provider_status_only",
  inboxDeliveryClaim: "not_claimed",
  tokenExposure: "not_exposed"
};
const reconciliationPayload = {
  mode: "reconciled",
  attempt: {
    id: attemptId,
    invitationId,
    provider: "resend",
    status: "accepted_by_provider",
    providerMessageId,
    providerAcceptedAt: occurredAt,
    updatedAt: "2026-07-11T00:06:00.000Z",
    deliveryClaim: "provider_status_only",
    tokenExposure: "not_exposed"
  },
  evidence: {
    id: evidenceId,
    providerEventType: "email.delivered",
    evidenceType: "delivered_to_recipient_server",
    occurredAt,
    inboxDeliveryClaim: "not_claimed",
    tokenExposure: "not_exposed"
  },
  deliveryClaim: "provider_status_only",
  inboxDeliveryClaim: "not_claimed",
  tokenExposure: "not_exposed"
};

describe("invitation delivery evidence UI contract", () => {
  it("creates a bounded attempt-scoped review query", () => {
    expect(createInvitationDeliveryEvidenceReviewQuery({ attemptId })).toBe(
      `?attemptId=${attemptId}&limit=50`
    );
    expect(
      createInvitationDeliveryEvidenceReviewQuery({ attemptId, limit: 25 })
    ).toBe(`?attemptId=${attemptId}&limit=25`);
  });

  it("rejects invalid query identity and limits", () => {
    for (const input of [
      { attemptId: "not-a-uuid" },
      { attemptId, limit: 0 },
      { attemptId, limit: 101 },
      { attemptId, limit: 1.5 }
    ]) {
      expect(() =>
        createInvitationDeliveryEvidenceReviewQuery(input)
      ).toThrow(InvitationDeliveryEvidenceUiError);
    }
  });

  it("parses safe evidence and selects no server-only fields", () => {
    const parsed = parseInvitationDeliveryEvidenceUiResponse(evidencePayload, {
      attemptId,
      invitationId,
      provider: "resend"
    });

    expect(parsed).toEqual({
      attemptId,
      count: 1,
      evidence: [
        {
          id: evidenceId,
          invitationId,
          deliveryAttemptId: attemptId,
          provider: "resend",
          providerEventId: "msg_777777777777",
          providerEventType: "email.delivered",
          evidenceType: "delivered_to_recipient_server",
          providerMessageId,
          occurredAt,
          receivedAt
        }
      ]
    });
    expect(JSON.stringify(parsed)).not.toMatch(
      /organizationId|recipientEmail|rawToken|tokenHash|rawPayload|signature|secret|rawError/i
    );
  });

  it("accepts a bounded future occurrence within receipt clock skew", () => {
    expect(() =>
      parseInvitationDeliveryEvidenceUiResponse(
        {
          ...evidencePayload,
          evidence: [
            {
              ...evidence,
              occurredAt: "2026-07-11T00:10:00.000Z",
              receivedAt: "2026-07-11T00:05:00.000Z"
            }
          ]
        },
        { attemptId }
      )
    ).not.toThrow();
  });

  it("rejects marker, identity, taxonomy, count, and clock-skew mismatches", () => {
    const invalidPayloads = [
      { ...evidencePayload, inboxDeliveryClaim: "confirmed" },
      { ...evidencePayload, attemptId: secondEvidenceId },
      { ...evidencePayload, count: 2 },
      {
        ...evidencePayload,
        evidence: [{ ...evidence, deliveryAttemptId: secondEvidenceId }]
      },
      {
        ...evidencePayload,
        evidence: [{ ...evidence, invitationId: secondEvidenceId }]
      },
      {
        ...evidencePayload,
        evidence: [{ ...evidence, provider: "other" }]
      },
      {
        ...evidencePayload,
        evidence: [{ ...evidence, evidenceType: "delivery_failed" }]
      },
      {
        ...evidencePayload,
        evidence: [
          {
            ...evidence,
            occurredAt: "2026-07-11T00:10:01.000Z",
            receivedAt: "2026-07-11T00:05:00.000Z"
          }
        ]
      }
    ];

    for (const payload of invalidPayloads) {
      expect(() =>
        parseInvitationDeliveryEvidenceUiResponse(payload, {
          attemptId,
          invitationId,
          provider: "resend"
        })
      ).toThrow(InvitationDeliveryEvidenceUiError);
    }
  });

  it("rejects duplicate and incorrectly ordered evidence", () => {
    const olderEvidence = {
      ...evidence,
      id: secondEvidenceId,
      providerEventId: "msg_older_event",
      providerEventType: "email.sent",
      evidenceType: "sent_by_provider",
      occurredAt: "2026-07-11T00:04:00.000Z",
      receivedAt: "2026-07-11T00:04:01.000Z"
    };

    for (const evidenceRows of [
      [evidence, evidence],
      [evidence, { ...olderEvidence, providerEventId: evidence.providerEventId }],
      [olderEvidence, evidence]
    ]) {
      expect(() =>
        parseInvitationDeliveryEvidenceUiResponse(
          {
            ...evidencePayload,
            count: evidenceRows.length,
            evidence: evidenceRows
          },
          { attemptId }
        )
      ).toThrow(InvitationDeliveryEvidenceUiError);
    }
  });

  it("rejects sensitive fields even when safe fields are present", () => {
    for (const unsafeField of [
      "organizationId",
      "recipient",
      "recipientAddress",
      "email",
      "sender",
      "subject",
      "rawToken",
      "tokenHash",
      "rawPayload",
      "signature",
      "secret",
      "rawError",
      "auditEvent",
      "inboxDelivered"
    ]) {
      expect(() =>
        parseInvitationDeliveryEvidenceUiResponse(
          {
            ...evidencePayload,
            evidence: [{ ...evidence, [unsafeField]: "unsafe" }]
          },
          { attemptId }
        )
      ).toThrow(InvitationDeliveryEvidenceUiError);
    }
  });

  it("creates reconciliation input only for an eligible aligned pair", () => {
    const parsedEvidence = parseInvitationDeliveryEvidenceUiResponse(
      evidencePayload,
      { attemptId, invitationId, provider: "resend" }
    ).evidence[0];

    expect(
      createInvitationDeliveryReconciliationRequest({
        review,
        evidence: parsedEvidence
      })
    ).toEqual({ attemptId, evidenceId });
  });

  it("rejects terminal, mismatched, or too-early reconciliation pairs", () => {
    const parsedEvidence = parseInvitationDeliveryEvidenceUiResponse(
      evidencePayload,
      { attemptId }
    ).evidence[0];
    const invalidPairs = [
      { review: { ...review, reviewState: "recent_prepared" as const }, evidence: parsedEvidence },
      { review: { ...review, attemptStatus: "provider_failed" as const }, evidence: parsedEvidence },
      { review, evidence: { ...parsedEvidence, deliveryAttemptId: secondEvidenceId } },
      { review, evidence: { ...parsedEvidence, invitationId: secondEvidenceId } },
      { review, evidence: { ...parsedEvidence, provider: "other" } },
      {
        review,
        evidence: { ...parsedEvidence, providerEventType: "email.failed" }
      },
      { review, evidence: { ...parsedEvidence, occurredAt: "invalid" } },
      {
        review,
        evidence: {
          ...parsedEvidence,
          occurredAt: "2026-07-10T23:54:59.000Z"
        }
      }
    ];

    for (const pair of invalidPairs) {
      expect(() =>
        createInvitationDeliveryReconciliationRequest(pair)
      ).toThrow(InvitationDeliveryEvidenceUiError);
    }
  });

  it("parses reconciled and existing results against request evidence", () => {
    const parsedEvidence = parseInvitationDeliveryEvidenceUiResponse(
      evidencePayload,
      { attemptId }
    ).evidence[0];
    const request = createInvitationDeliveryReconciliationRequest({
      review,
      evidence: parsedEvidence
    });

    expect(
      parseInvitationDeliveryReconciliationUiResponse(
        reconciliationPayload,
        { request, review, evidence: parsedEvidence }
      )
    ).toMatchObject({
      mode: "reconciled",
      attempt: { id: attemptId, status: "accepted_by_provider" },
      evidence: { id: evidenceId }
    });
    expect(() =>
      parseInvitationDeliveryReconciliationUiResponse(
        { ...reconciliationPayload, mode: "existing" },
        { request, review, evidence: parsedEvidence }
      )
    ).not.toThrow();
  });

  it("rejects reconciliation marker, identity, state, and time mismatches", () => {
    const parsedEvidence = parseInvitationDeliveryEvidenceUiResponse(
      evidencePayload,
      { attemptId }
    ).evidence[0];
    const request = { attemptId, evidenceId };
    const invalidPayloads = [
      { ...reconciliationPayload, inboxDeliveryClaim: "confirmed" },
      {
        ...reconciliationPayload,
        attempt: { ...reconciliationPayload.attempt, id: secondEvidenceId }
      },
      {
        ...reconciliationPayload,
        attempt: { ...reconciliationPayload.attempt, status: "prepared" }
      },
      {
        ...reconciliationPayload,
        attempt: {
          ...reconciliationPayload.attempt,
          providerMessageId: "different-message"
        }
      },
      {
        ...reconciliationPayload,
        attempt: {
          ...reconciliationPayload.attempt,
          providerAcceptedAt: "2026-07-11T00:05:02.000Z"
        }
      },
      {
        ...reconciliationPayload,
        attempt: {
          ...reconciliationPayload.attempt,
          updatedAt: "2026-07-11T00:04:59.000Z"
        }
      },
      {
        ...reconciliationPayload,
        evidence: { ...reconciliationPayload.evidence, id: secondEvidenceId }
      }
    ];

    for (const payload of invalidPayloads) {
      expect(() =>
        parseInvitationDeliveryReconciliationUiResponse(payload, {
          request,
          review,
          evidence: parsedEvidence
        })
      ).toThrow(InvitationDeliveryEvidenceUiError);
    }
  });

  it("rejects sensitive reconciliation response fields", () => {
    const parsedEvidence = parseInvitationDeliveryEvidenceUiResponse(
      evidencePayload,
      { attemptId }
    ).evidence[0];

    expect(() =>
      parseInvitationDeliveryReconciliationUiResponse(
        {
          ...reconciliationPayload,
          attempt: {
            ...reconciliationPayload.attempt,
            organizationId: "11111111-1111-4111-8111-111111111111"
          }
        },
        {
          request: { attemptId, evidenceId },
          review,
          evidence: parsedEvidence
        }
      )
    ).toThrow(InvitationDeliveryEvidenceUiError);
  });
});

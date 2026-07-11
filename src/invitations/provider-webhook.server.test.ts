import { Buffer } from "node:buffer";

import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createResendInvitationWebhookVerifier,
  createResendInvitationWebhookVerifierFromEnvironment,
  InvitationProviderWebhookConfigurationError,
  InvitationProviderWebhookError
} from "./provider-webhook.server";

const now = new Date("2026-07-11T01:00:00.000Z");
const signingSecret =
  "whsec_" +
  Buffer.from("knowledgeos-webhook-signing-key-32").toString("base64");
const eventId = "msg_777777777777";
const deliveryAttemptId = "77777777-7777-4777-8777-777777777777";
const providerMessageId = "56761188-7520-42d8-8898-ff6fc54ce618";

function event(
  type = "email.delivered",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const {
    data: dataOverrides,
    ...eventOverrides
  } = overrides;

  return {
    type,
    created_at: "2026-07-11T00:59:58.000Z",
    ...eventOverrides,
    data: {
      email_id: providerMessageId,
      from: "KnowledgeOS <invitations@example.com>",
      to: ["member@example.com"],
      subject: "Invitation",
      tags: {
        knowledgeos_attempt_id: deliveryAttemptId
      },
      ...((dataOverrides as Record<string, unknown> | undefined) ?? {})
    }
  };
}

function signedInput(
  payload: Record<string, unknown> = event(),
  timestamp = now
) {
  const rawBody = JSON.stringify(payload);
  const signature = new Webhook(signingSecret).sign(
    eventId,
    timestamp,
    rawBody
  );

  return {
    rawBody,
    headers: {
      id: eventId,
      timestamp: String(Math.floor(timestamp.getTime() / 1_000)),
      signature
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Resend invitation webhook configuration", () => {
  it("is disabled by default and rejects verification without side effects", () => {
    const verifier = createResendInvitationWebhookVerifierFromEnvironment({});

    expect(verifier).toMatchObject({ provider: "resend", enabled: false });
    expect(() => verifier.verify(signedInput())).toThrowError(
      expect.objectContaining({ code: "webhook_disabled" })
    );
  });

  it("enables only with an explicit valid signing secret", () => {
    const verifier = createResendInvitationWebhookVerifierFromEnvironment({
      KNOWLEDGEOS_RESEND_WEBHOOK_ENABLED: "true",
      RESEND_WEBHOOK_SECRET: signingSecret
    });

    expect(verifier).toMatchObject({ provider: "resend", enabled: true });
    expect(verifier).not.toHaveProperty("signingSecret");
  });

  it("rejects invalid enable flags, missing secrets, and invalid secrets", () => {
    expect(() =>
      createResendInvitationWebhookVerifierFromEnvironment({
        KNOWLEDGEOS_RESEND_WEBHOOK_ENABLED: "sometimes"
      })
    ).toThrow(InvitationProviderWebhookConfigurationError);
    expect(() =>
      createResendInvitationWebhookVerifierFromEnvironment({
        KNOWLEDGEOS_RESEND_WEBHOOK_ENABLED: "true"
      })
    ).toThrow(InvitationProviderWebhookConfigurationError);
    expect(() =>
      createResendInvitationWebhookVerifier({
        enabled: true,
        signingSecret: "whsec_****************"
      })
    ).toThrow(InvitationProviderWebhookConfigurationError);
  });

  it("sanitizes verifier construction failures", () => {
    expect(() =>
      createResendInvitationWebhookVerifier(
        { enabled: true, signingSecret },
        {
          createWebhook: () => {
            throw new Error("whsec_private internal verifier failure");
          }
        }
      )
    ).toThrowError(
      expect.objectContaining({
        name: "InvitationProviderWebhookConfigurationError",
        message: "Invitation Provider webhook configuration is invalid."
      })
    );
  });
});

describe("Resend invitation webhook verification", () => {
  it.each([
    ["email.sent", "sent_by_provider"],
    ["email.delivered", "delivered_to_recipient_server"],
    ["email.delivery_delayed", "delivery_delayed"],
    ["email.bounced", "bounced"],
    ["email.failed", "delivery_failed"],
    ["email.suppressed", "suppressed"],
    ["email.complained", "complained"]
  ] as const)("normalizes signed %s evidence as %s", (type, evidenceType) => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });

    expect(verifier.verify(signedInput(event(type)))).toEqual({
      provider: "resend",
      providerEventId: eventId,
      providerEventType: type,
      evidenceType,
      deliveryAttemptId,
      providerMessageId,
      occurredAt: new Date("2026-07-11T00:59:58.000Z"),
      signatureVerified: true,
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    });
  });

  it("uses the exact raw body for signature verification", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });
    const input = signedInput();

    expect(() =>
      verifier.verify({ ...input, rawBody: input.rawBody + " " })
    ).toThrowError(expect.objectContaining({ code: "verification_failed" }));
    expect(() =>
      verifier.verify({
        ...input,
        headers: { ...input.headers, signature: "v1,invalid" }
      })
    ).toThrowError(expect.objectContaining({ code: "verification_failed" }));
  });

  it("rejects stale and excessively future signed requests", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });

    for (const offsetSeconds of [-301, 301]) {
      const timestamp = new Date(now.getTime() + offsetSeconds * 1_000);

      expect(() => verifier.verify(signedInput(event(), timestamp))).toThrowError(
        expect.objectContaining({ code: "replay_rejected" })
      );
    }
  });

  it("accepts the exact replay-window boundaries", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });

    for (const offsetSeconds of [-300, 300]) {
      const timestamp = new Date(now.getTime() + offsetSeconds * 1_000);

      expect(
        verifier.verify(signedInput(event(), timestamp)).providerEventId
      ).toBe(eventId);
    }
  });

  it("rejects missing, malformed, and control-bearing headers", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });
    const input = signedInput();
    const invalidHeaders = [
      { ...input.headers, id: null },
      { ...input.headers, id: "invalid id" },
      { ...input.headers, timestamp: "not-a-timestamp" },
      { ...input.headers, signature: "v1,signature\nleak" }
    ];

    for (const headers of invalidHeaders) {
      expect(() => verifier.verify({ rawBody: input.rawBody, headers })).toThrowError(
        expect.objectContaining({ code: "invalid_request" })
      );
    }
  });

  it("rejects empty and oversized raw bodies before signature verification", () => {
    const verify = vi.fn();
    const verifier = createResendInvitationWebhookVerifier(
      { enabled: true, signingSecret },
      { createWebhook: () => ({ verify }) }
    );
    const headers = signedInput().headers;

    for (const rawBody of ["", "x".repeat(65_537)]) {
      expect(() => verifier.verify({ rawBody, headers })).toThrowError(
        expect.objectContaining({ code: "invalid_request" })
      );
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects signed unsupported event types", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });

    for (const type of ["email.opened", "toString", "constructor"]) {
      expect(() =>
        verifier.verify(signedInput(event(type)))
      ).toThrowError(expect.objectContaining({ code: "unsupported_event" }));
    }
  });

  it("rejects signed events without safe invitation correlation", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });
    const invalidEvents = [
      event("email.delivered", { data: { email_id: "" } }),
      event("email.delivered", { data: { tags: {} } }),
      event("email.delivered", {
        data: {
          tags: { knowledgeos_attempt_id: "not-a-uuid" }
        }
      }),
      event("email.delivered", { created_at: "not-a-date" }),
      { type: "email.delivered", created_at: now.toISOString() }
    ];

    for (const invalidEvent of invalidEvents) {
      expect(() =>
        verifier.verify(signedInput(invalidEvent))
      ).toThrowError(expect.objectContaining({ code: "invalid_event" }));
    }
  });

  it("selects no recipient, token, raw payload, secret, or Provider details", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });
    const evidence = verifier.verify(
      signedInput(
        event("email.bounced", {
          data: {
            rawToken: "one-time-delivery-token",
            tokenHash: "private-token-hash",
            rawError: "private Provider response",
            bounce: { message: "recipient details" }
          }
        })
      )
    );

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(
      /member@example|one-time-delivery-token|private-token-hash|private Provider|recipient details|whsec_/i
    );
  });

  it("returns only bounded error codes and messages", () => {
    const verifier = createResendInvitationWebhookVerifier({
      enabled: true,
      signingSecret
    });

    try {
      verifier.verify({
        rawBody: "{private raw payload",
        headers: {
          id: eventId,
          timestamp: String(Math.floor(now.getTime() / 1_000)),
          signature: "v1,private-signature"
        }
      });
      throw new Error("Expected verification failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(InvitationProviderWebhookError);
      expect(error).toMatchObject({
        code: "verification_failed",
        message: "Invitation Provider webhook verification failed."
      });
      expect(JSON.stringify(error)).not.toMatch(/private raw|private-signature/);
    }
  });
});

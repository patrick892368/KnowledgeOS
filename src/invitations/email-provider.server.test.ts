import { describe, expect, it, vi } from "vitest";

import { parseInvitationAcceptanceDeepLink } from "./deep-link";
import {
  createInvitationDeliveryPlan,
  type InvitationDeliveryTarget
} from "./delivery";
import {
  createInvitationEmailProviderPayload,
  deliverInvitationEmail,
  InvitationEmailDeliveryError,
  type InvitationEmailProvider
} from "./email-provider.server";

const now = new Date("2026-07-11T00:00:00.000Z");
const attemptId = "77777777-7777-4777-8777-777777777777";
const target: InvitationDeliveryTarget = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: "11111111-1111-4111-8111-111111111111",
  email: "member@example.com",
  role: "editor",
  status: "pending",
  expiresAt: new Date("2026-07-18T00:00:00.000Z")
};

function createPlan() {
  return createInvitationDeliveryPlan({
    target,
    options: {
      now,
      deliveryTtlHours: 24,
      rawToken: "one-time-delivery-token"
    }
  });
}

function createProvider(
  sendInvitation = vi.fn(async () => ({ messageId: "provider-message-1" }))
): InvitationEmailProvider & { sendInvitation: typeof sendInvitation } {
  return {
    name: "test_provider",
    enabled: true,
    sendInvitation
  };
}

function expectDeliveryError(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(InvitationEmailDeliveryError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error("Expected invitation email delivery error.");
}

describe("createInvitationEmailProviderPayload", () => {
  it("creates a server-only provider payload with separate context URL and token", () => {
    const payload = createInvitationEmailProviderPayload({
      plan: createPlan(),
      deliveryAttemptId: attemptId,
      acceptanceBaseUrl: "https://app.example.com/",
      now
    });
    const contextUrl = new URL(payload.acceptanceContextUrl);
    const parsed = parseInvitationAcceptanceDeepLink(contextUrl.search);

    expect(payload).toMatchObject({
      template: "invitation_acceptance",
      deliveryAttemptId: attemptId,
      recipient: target.email,
      subject: "KnowledgeOS invitation",
      invitationId: target.id,
      organizationId: target.organizationId,
      oneTimeToken: "one-time-delivery-token",
      deliveryExpiresAt: "2026-07-12T00:00:00.000Z",
      invitationExpiresAt: "2026-07-18T00:00:00.000Z",
      tokenHandling: "separate_one_time_value"
    });
    expect(contextUrl.protocol).toBe("https:");
    expect(contextUrl.hash).toBe("#invitation-acceptance");
    expect(parsed.context).toEqual({
      invitationId: target.id,
      email: target.email,
      organizationId: target.organizationId
    });
    expect(payload.acceptanceContextUrl).not.toMatch(
      /one-time-delivery-token|tokenHash|rawToken/i
    );
    expect(payload).not.toHaveProperty("tokenHash");
  });

  it("rejects unsafe URLs, mismatched token material, and expired plans", () => {
    expectDeliveryError(
      () =>
        createInvitationEmailProviderPayload({
          plan: createPlan(),
          deliveryAttemptId: "not-a-uuid",
          acceptanceBaseUrl: "https://app.example.com/",
          now
        }),
      "invalid_delivery_payload"
    );

    expectDeliveryError(
      () =>
      createInvitationEmailProviderPayload({
        plan: createPlan(),
        deliveryAttemptId: attemptId,
        acceptanceBaseUrl: "http://app.example.com/",
        now
      }),
      "invalid_delivery_payload"
    );

    expectDeliveryError(
      () =>
        createInvitationEmailProviderPayload({
          plan: createPlan(),
          deliveryAttemptId: attemptId,
          acceptanceBaseUrl: "https://app.example.com/?token=unsafe",
          now
        }),
      "invalid_delivery_payload"
    );

    const mismatchedPlan = createPlan();
    mismatchedPlan.secret.rawToken = "different-token";
    expectDeliveryError(
      () =>
        createInvitationEmailProviderPayload({
          plan: mismatchedPlan,
          deliveryAttemptId: attemptId,
          acceptanceBaseUrl: "https://app.example.com/",
          now
        }),
      "invalid_delivery_payload"
    );

    expectDeliveryError(
      () =>
        createInvitationEmailProviderPayload({
          plan: createPlan(),
          deliveryAttemptId: attemptId,
          acceptanceBaseUrl: "https://app.example.com/",
          now: new Date("2026-07-12T00:00:00.000Z")
        }),
      "invalid_delivery_payload"
    );
  });

  it("allows loopback HTTP only for local development", () => {
    const payload = createInvitationEmailProviderPayload({
      plan: createPlan(),
      deliveryAttemptId: attemptId,
      acceptanceBaseUrl: "http://127.0.0.1:3000/",
      now
    });

    expect(payload.acceptanceContextUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:3000\//
    );
  });
});

describe("deliverInvitationEmail", () => {
  it("returns a public provider-accepted receipt without delivery secrets", async () => {
    const provider = createProvider();

    const receipt = await deliverInvitationEmail({
      plan: createPlan(),
      deliveryAttemptId: attemptId,
      acceptanceBaseUrl: "https://app.example.com/accept",
      provider,
      now
    });

    expect(provider.sendInvitation).toHaveBeenCalledTimes(1);
    expect(receipt).toEqual({
      deliveryAttemptId: attemptId,
      invitationId: target.id,
      recipient: target.email,
      provider: "test_provider",
      providerMessageId: "provider-message-1",
      status: "accepted_by_provider",
      acceptedAt: now,
      tokenExposure: "not_exposed"
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /one-time-delivery-token|tokenHash|rawToken|secret/i
    );
  });

  it("fails safely when the provider is missing or disabled", async () => {
    await expect(
      deliverInvitationEmail({
        plan: createPlan(),
        deliveryAttemptId: attemptId,
        acceptanceBaseUrl: "https://app.example.com/",
        now
      })
    ).rejects.toMatchObject({
      code: "provider_unconfigured",
      recoverable: true
    });

    const sendInvitation = vi.fn(async () => ({ messageId: "unused" }));
    await expect(
      deliverInvitationEmail({
        plan: createPlan(),
        deliveryAttemptId: attemptId,
        acceptanceBaseUrl: "https://app.example.com/",
        provider: {
          name: "disabled_provider",
          enabled: false,
          sendInvitation
        },
        now
      })
    ).rejects.toMatchObject({
      code: "provider_disabled",
      recoverable: true
    });
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures and never claims delivery", async () => {
    const provider = createProvider(
      vi.fn(async () => {
        throw new Error("provider leaked one-time-delivery-token");
      })
    );

    let caught: unknown;
    try {
      await deliverInvitationEmail({
        plan: createPlan(),
        deliveryAttemptId: attemptId,
        acceptanceBaseUrl: "https://app.example.com/",
        provider,
        now
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "provider_failed",
      message: "Invitation email provider rejected the delivery request.",
      recoverable: true
    });
    expect(JSON.stringify(caught)).not.toMatch(/one-time-delivery-token/);
  });

  it("rejects invalid or secret-bearing provider acceptance responses", async () => {
    for (const messageId of [
      " ",
      "provider-message\n1",
      "one-time-delivery-token",
      createPlan().secret.tokenHash
    ]) {
      const provider = createProvider(vi.fn(async () => ({ messageId })));

      await expect(
        deliverInvitationEmail({
          plan: createPlan(),
          deliveryAttemptId: attemptId,
          acceptanceBaseUrl: "https://app.example.com/",
          provider,
          now
        })
      ).rejects.toMatchObject({
        code: "provider_failed"
      });
    }
  });
});

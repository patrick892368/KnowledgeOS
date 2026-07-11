import { describe, expect, it, vi } from "vitest";

import { createInvitationDeliveryPlan } from "./delivery";
import {
  createInvitationEmailProviderPayload,
  deliverInvitationEmail,
  InvitationEmailDeliveryError,
  type InvitationEmailProviderPayload
} from "./email-provider.server";
import {
  createResendInvitationEmailProvider,
  createResendInvitationEmailProviderFromEnvironment
} from "./resend-provider.server";

const now = new Date("2026-07-11T00:00:00.000Z");
const deliveryAttemptId = "77777777-7777-4777-8777-777777777777";
const apiKey = "re_test_secret_api_key";
const oneTimeToken = "one-time-delivery-token";
const providerMessageId = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";

function createPayload(): Readonly<InvitationEmailProviderPayload> {
  const plan = createInvitationDeliveryPlan({
    target: {
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "11111111-1111-4111-8111-111111111111",
      email: "member@example.com",
      role: "editor",
      status: "pending",
      expiresAt: new Date("2026-07-18T00:00:00.000Z")
    },
    options: {
      now,
      deliveryTtlHours: 24,
      rawToken: oneTimeToken
    }
  });

  return createInvitationEmailProviderPayload({
    plan,
    deliveryAttemptId,
    acceptanceBaseUrl: "https://app.example.com/accept",
    now
  });
}

function successResponse(id: unknown = providerMessageId): Response {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function createEnabledProvider(
  fetchRequest: typeof fetch,
  dependencies: {
    setTimeout?: (callback: () => void, delayMs: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  } = {}
) {
  return createResendInvitationEmailProvider(
    {
      enabled: true,
      apiKey,
      from: "KnowledgeOS <invitations@example.com>",
      timeoutMs: 5_000
    },
    { fetch: fetchRequest, ...dependencies }
  );
}

describe("Resend invitation email provider", () => {
  it("sends the official request shape with an attempt-scoped idempotency key", async () => {
    const fetchRequest = vi.fn(async () => successResponse());
    const provider = createEnabledProvider(fetchRequest);
    const payload = createPayload();

    await expect(provider.sendInvitation(payload)).resolves.toEqual({
      messageId: providerMessageId
    });

    expect(fetchRequest).toHaveBeenCalledTimes(1);
    const [url, request] = fetchRequest.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request).toMatchObject({ method: "POST" });
    expect(request.headers).toMatchObject({
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": deliveryAttemptId,
      "User-Agent": "KnowledgeOS/0.0.0"
    });
    expect(JSON.parse(request.body as string)).toEqual({
      from: "KnowledgeOS <invitations@example.com>",
      to: [payload.recipient],
      subject: payload.subject,
      text: expect.stringContaining(payload.acceptanceContextUrl),
      tags: [
        {
          name: "knowledgeos_attempt_id",
          value: deliveryAttemptId
        }
      ]
    });
    expect(request.body).toContain(oneTimeToken);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps API keys and one-time tokens out of the public receipt", async () => {
    const fetchRequest = vi.fn(async () => successResponse());
    const provider = createEnabledProvider(fetchRequest);
    const plan = createInvitationDeliveryPlan({
      target: {
        id: "44444444-4444-4444-8444-444444444444",
        organizationId: "11111111-1111-4111-8111-111111111111",
        email: "member@example.com",
        role: "editor",
        status: "pending",
        expiresAt: new Date("2026-07-18T00:00:00.000Z")
      },
      options: { now, deliveryTtlHours: 24, rawToken: oneTimeToken }
    });

    const receipt = await deliverInvitationEmail({
      plan,
      deliveryAttemptId,
      acceptanceBaseUrl: "https://app.example.com/accept",
      provider,
      now
    });

    expect(receipt).toMatchObject({
      provider: "resend",
      providerMessageId,
      status: "accepted_by_provider",
      tokenExposure: "not_exposed"
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /re_test_secret_api_key|one-time-delivery-token|tokenHash|rawToken/i
    );
    expect(JSON.stringify(provider)).not.toContain(apiKey);
  });

  it("is disabled by default without requiring secrets or making requests", async () => {
    const fetchRequest = vi.fn(async () => successResponse());
    const provider = createResendInvitationEmailProviderFromEnvironment(
      {},
      { fetch: fetchRequest }
    );

    expect(provider).toMatchObject({ name: "resend", enabled: false });
    await expect(provider.sendInvitation(createPayload())).rejects.toMatchObject({
      code: "provider_disabled",
      recoverable: true
    });
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("loads a valid enabled adapter from environment configuration", async () => {
    const fetchRequest = vi.fn(async () => successResponse());
    const setTimeout = vi.fn(() => "timeout-handle");
    const provider = createResendInvitationEmailProviderFromEnvironment(
      {
        KNOWLEDGEOS_RESEND_ENABLED: "true",
        RESEND_API_KEY: apiKey,
        KNOWLEDGEOS_INVITATION_FROM_EMAIL:
          "KnowledgeOS <invitations@example.com>",
        KNOWLEDGEOS_RESEND_TIMEOUT_MS: "7000"
      },
      { fetch: fetchRequest, setTimeout, clearTimeout: vi.fn() }
    );

    await expect(provider.sendInvitation(createPayload())).resolves.toEqual({
      messageId: providerMessageId
    });
    expect(provider.enabled).toBe(true);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 7_000);
  });

  it("rejects missing or invalid enabled configuration without exposing values", () => {
    for (const environment of [
      { KNOWLEDGEOS_RESEND_ENABLED: "enabled" },
      { KNOWLEDGEOS_RESEND_ENABLED: "true" },
      {
        KNOWLEDGEOS_RESEND_ENABLED: "true",
        RESEND_API_KEY: apiKey,
        KNOWLEDGEOS_INVITATION_FROM_EMAIL: "unsafe sender"
      },
      {
        KNOWLEDGEOS_RESEND_ENABLED: "true",
        RESEND_API_KEY: apiKey,
        KNOWLEDGEOS_INVITATION_FROM_EMAIL: "invitations@example.com",
        KNOWLEDGEOS_RESEND_TIMEOUT_MS: "999999"
      }
    ]) {
      let caught: unknown;

      try {
        createResendInvitationEmailProviderFromEnvironment(environment);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(InvitationEmailDeliveryError);
      expect(caught).toMatchObject({
        code: "provider_disabled",
        message: "Resend invitation email provider configuration is invalid.",
        recoverable: true
      });
      expect(JSON.stringify(caught)).not.toMatch(
        /re_test_secret_api_key|unsafe sender|999999/
      );
    }
  });

  it("sanitizes non-success and malformed Provider responses", async () => {
    const responses = [
      new Response(
        JSON.stringify({ message: `${apiKey} ${oneTimeToken}` }),
        { status: 403 }
      ),
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ id: "" }), { status: 200 }),
      new Response(JSON.stringify({ id: "x".repeat(257) }), { status: 200 }),
      new Response("x".repeat(4_097), { status: 200 })
    ];

    for (const response of responses) {
      const provider = createEnabledProvider(
        vi.fn(async () => response)
      );
      let caught: unknown;

      try {
        await provider.sendInvitation(createPayload());
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: "provider_failed",
        message: "Resend rejected the invitation email request.",
        recoverable: true
      });
      expect(JSON.stringify(caught)).not.toMatch(
        /re_test_secret_api_key|one-time-delivery-token|not-json/
      );
    }
  });

  it("sanitizes network failures and clears the timeout", async () => {
    const clearTimeout = vi.fn();
    const provider = createEnabledProvider(
      vi.fn(async () => {
        throw new Error(`${apiKey} ${oneTimeToken}`);
      }),
      {
        setTimeout: vi.fn(() => "timeout-handle"),
        clearTimeout
      }
    );

    let caught: unknown;
    try {
      await provider.sendInvitation(createPayload());
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "provider_failed",
      message: "Resend rejected the invitation email request."
    });
    expect(JSON.stringify(caught)).not.toMatch(
      /re_test_secret_api_key|one-time-delivery-token/
    );
    expect(clearTimeout).toHaveBeenCalledWith("timeout-handle");
  });

  it("aborts timed-out requests and returns only a safe failure", async () => {
    const clearTimeout = vi.fn();
    const fetchRequest = vi.fn(async (_url, request?: RequestInit) => {
      expect(request?.signal?.aborted).toBe(true);
      throw Object.assign(new Error(oneTimeToken), { name: "AbortError" });
    });
    const provider = createEnabledProvider(fetchRequest, {
      setTimeout: (callback) => {
        callback();
        return "timeout-handle";
      },
      clearTimeout
    });

    await expect(provider.sendInvitation(createPayload())).rejects.toMatchObject({
      code: "provider_failed",
      message: "Resend rejected the invitation email request.",
      recoverable: true
    });
    expect(clearTimeout).toHaveBeenCalledWith("timeout-handle");
  });

  it("keeps the timeout active while reading the Provider response", async () => {
    let abortRequest: () => void = () => undefined;
    let requestSignal: AbortSignal | null | undefined;
    const response = {
      ok: true,
      async text() {
        abortRequest();
        expect(requestSignal?.aborted).toBe(true);
        throw new Error(`${apiKey} ${oneTimeToken}`);
      }
    } as unknown as Response;
    const provider = createEnabledProvider(
      vi.fn(async (_url, request?: RequestInit) => {
        requestSignal = request?.signal;
        return response;
      }),
      {
        setTimeout: (callback) => {
          abortRequest = callback;
          return "timeout-handle";
        },
        clearTimeout: vi.fn()
      }
    );

    await expect(provider.sendInvitation(createPayload())).rejects.toMatchObject({
      code: "provider_failed",
      message: "Resend rejected the invitation email request."
    });
  });

  it("rejects invalid direct Provider payloads before any network call", async () => {
    const fetchRequest = vi.fn(async () => successResponse());
    const provider = createEnabledProvider(fetchRequest);

    for (const invalidPayload of [
      { ...createPayload(), recipient: "invalid-email" },
      { ...createPayload(), deliveryAttemptId: "invalid-attempt" },
      {
        ...createPayload(),
        acceptanceContextUrl: "https://app.example.com/?token=unsafe"
      },
      {
        ...createPayload(),
        acceptanceContextUrl: "http://app.example.com/accept"
      }
    ]) {
      await expect(provider.sendInvitation(invalidPayload)).rejects.toMatchObject({
        code: "provider_failed"
      });
    }
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});

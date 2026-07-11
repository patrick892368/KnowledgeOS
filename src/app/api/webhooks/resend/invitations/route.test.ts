import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";
import {
  InvitationDeliveryEvidenceError,
  type InvitationDeliveryEvidencePersistenceResult
} from "@/db/invitation-delivery-evidence-repository";
import {
  InvitationProviderWebhookConfigurationError,
  InvitationProviderWebhookError,
  type InvitationProviderWebhookVerifier,
  type VerifiedInvitationProviderEvidence
} from "@/invitations/provider-webhook.server";

import {
  handleInvitationProviderWebhook,
  type InvitationProviderWebhookRouteDependencies
} from "./handler";

const now = new Date("2026-07-11T01:00:00.000Z");
const rawBody = ' { "type": "email.delivered" }\n';
const evidence: VerifiedInvitationProviderEvidence = {
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server",
  deliveryAttemptId: "77777777-7777-4777-8777-777777777777",
  providerMessageId: "56761188-7520-42d8-8898-ff6fc54ce618",
  occurredAt: new Date("2026-07-11T00:59:58.000Z"),
  signatureVerified: true,
  inboxDeliveryClaim: "not_claimed",
  tokenExposure: "not_exposed"
};
const persistenceResult: InvitationDeliveryEvidencePersistenceResult = {
  mode: "created",
  evidence: {
    id: "88888888-8888-4888-8888-888888888888",
    organizationId: "11111111-1111-4111-8111-111111111111",
    invitationId: "44444444-4444-4444-8444-444444444444",
    deliveryAttemptId: evidence.deliveryAttemptId,
    provider: evidence.provider,
    providerEventId: evidence.providerEventId,
    providerEventType: evidence.providerEventType,
    evidenceType: evidence.evidenceType,
    providerMessageId: evidence.providerMessageId,
    occurredAt: evidence.occurredAt,
    receivedAt: now
  }
};

function request(
  body: BodyInit = rawBody,
  headers: Record<string, string> = {}
): Request {
  return new Request(
    "http://knowledgeos.local/api/webhooks/resend/invitations",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": evidence.providerEventId,
        "svix-timestamp": "1783731600",
        "svix-signature": "v1,signed-value",
        ...headers
      },
      body
    }
  );
}

function createDependencies(input: {
  createVerifierError?: unknown;
  verifyError?: unknown;
  databaseError?: unknown;
  persistenceError?: unknown;
  persistenceResult?: InvitationDeliveryEvidencePersistenceResult;
  verifierEnabled?: boolean;
} = {}) {
  const db = { name: "webhook-test-db" } as unknown as Database;
  const verify = vi.fn(() => {
    if (input.verifyError) {
      throw input.verifyError;
    }
    return evidence;
  });
  const verifier: InvitationProviderWebhookVerifier = {
    provider: "resend",
    enabled: input.verifierEnabled ?? true,
    verify
  };
  const persistEvidence = vi.fn(async () => {
    if (input.persistenceError) {
      throw input.persistenceError;
    }
    return input.persistenceResult ?? persistenceResult;
  });
  const createDatabaseClient = vi.fn(() => {
    if (input.databaseError) {
      throw input.databaseError;
    }
    return db;
  });
  const dependencies: InvitationProviderWebhookRouteDependencies = {
    createVerifier: vi.fn(() => {
      if (input.createVerifierError) {
        throw input.createVerifierError;
      }
      return verifier;
    }),
    createDatabaseClient,
    persistEvidence:
      persistEvidence as unknown as InvitationProviderWebhookRouteDependencies["persistEvidence"],
    environment: {
      KNOWLEDGEOS_RESEND_WEBHOOK_ENABLED: "true",
      RESEND_WEBHOOK_SECRET: "whsec_server_only"
    },
    now: vi.fn(() => now)
  };

  return { createDatabaseClient, db, dependencies, persistEvidence, verify };
}

describe("POST /api/webhooks/resend/invitations", () => {
  it("verifies the exact raw body before database persistence", async () => {
    const {
      createDatabaseClient,
      db,
      dependencies,
      persistEvidence,
      verify
    } = createDependencies();
    const webhookRequest = request();
    const response = await handleInvitationProviderWebhook(
      webhookRequest,
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ received: true });
    expect(webhookRequest.bodyUsed).toBe(true);
    expect(verify).toHaveBeenCalledWith({
      rawBody,
      headers: {
        id: evidence.providerEventId,
        timestamp: "1783731600",
        signature: "v1,signed-value"
      }
    });
    expect(persistEvidence).toHaveBeenCalledWith(db, {
      evidence,
      receivedAt: now
    });
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(
      createDatabaseClient.mock.invocationCallOrder[0]
    );
    expect(JSON.stringify(payload)).not.toMatch(
      /organization|invitation|attempt|event|message|recipient|token|payload|signature|secret|delivered/i
    );
  });

  it("acknowledges an idempotent duplicate with the same minimal response", async () => {
    const { dependencies } = createDependencies({
      persistenceResult: { ...persistenceResult, mode: "existing" }
    });
    const response = await handleInvitationProviderWebhook(
      request(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("acknowledges signed unsupported events without database work", async () => {
    const { dependencies } = createDependencies({
      verifyError: new InvitationProviderWebhookError(
        "unsupported_event",
        "Internal unsupported event detail."
      )
    });
    const response = await handleInvitationProviderWebhook(
      request(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.persistEvidence).not.toHaveBeenCalled();
  });

  it("rejects verification, replay, request, and event failures before database work", async () => {
    for (const code of [
      "invalid_request",
      "verification_failed",
      "replay_rejected",
      "invalid_event"
    ] as const) {
      const { dependencies } = createDependencies({
        verifyError: new InvitationProviderWebhookError(
          code,
          "private raw payload and signature details"
        )
      });
      const response = await handleInvitationProviderWebhook(
        request(),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toEqual({
        error: {
          code: "invalid_webhook",
          message: "Invitation Provider webhook request is invalid."
        }
      });
      expect(JSON.stringify(payload)).not.toMatch(/private raw|signature details/);
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
      expect(dependencies.persistEvidence).not.toHaveBeenCalled();
    }
  });

  it("returns retryable service status when verification is disabled", async () => {
    const { dependencies } = createDependencies({
      verifyError: new InvitationProviderWebhookError(
        "webhook_disabled",
        "Disabled configuration detail."
      )
    });
    const response = await handleInvitationProviderWebhook(
      request(),
      dependencies
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "webhook_unavailable",
        message: "Invitation Provider webhook is temporarily unavailable."
      }
    });
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("stops a disabled verifier before reading the request body", async () => {
    const { dependencies, verify } = createDependencies({
      verifierEnabled: false
    });
    const webhookRequest = request();
    const response = await handleInvitationProviderWebhook(
      webhookRequest,
      dependencies
    );

    expect(response.status).toBe(503);
    expect(webhookRequest.bodyUsed).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("returns retryable service status for sanitized configuration failure", async () => {
    const { dependencies } = createDependencies({
      createVerifierError: new InvitationProviderWebhookConfigurationError(
        "whsec_private secret detail"
      )
    });
    const response = await handleInvitationProviderWebhook(
      request(),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "webhook_unavailable",
        message: "Invitation Provider webhook is temporarily unavailable."
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/whsec_private|secret detail/);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed oversized payloads before verification", async () => {
    const requests = [
      request("{}", { "content-length": "65537" }),
      request("x".repeat(65_537))
    ];

    for (const webhookRequest of requests) {
      const { dependencies } = createDependencies();
      const response = await handleInvitationProviderWebhook(
        webhookRequest,
        dependencies
      );

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        error: {
          code: "payload_too_large",
          message: "Invitation Provider webhook payload is too large."
        }
      });
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    }
  });

  it("accepts the exact body limit and rejects invalid UTF-8 before verification", async () => {
    const accepted = createDependencies();
    const acceptedResponse = await handleInvitationProviderWebhook(
      request("x".repeat(65_536)),
      accepted.dependencies
    );

    expect(acceptedResponse.status).toBe(200);
    expect(accepted.verify).toHaveBeenCalledTimes(1);

    const invalidUtf8 = createDependencies();
    const invalidResponse = await handleInvitationProviderWebhook(
      request(new Uint8Array([0xff])),
      invalidUtf8.dependencies
    );

    expect(invalidResponse.status).toBe(400);
    expect(invalidUtf8.verify).not.toHaveBeenCalled();
    expect(invalidUtf8.dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("rejects an invalid declared length and missing body safely", async () => {
    const invalidRequests = [
      request("{}", { "content-length": "not-a-number" }),
      new Request(
        "http://knowledgeos.local/api/webhooks/resend/invitations",
        {
          method: "POST"
        }
      )
    ];

    for (const webhookRequest of invalidRequests) {
      const { dependencies } = createDependencies();
      const response = await handleInvitationProviderWebhook(
        webhookRequest,
        dependencies
      );

      expect([400, 413]).toContain(response.status);
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
      expect(dependencies.persistEvidence).not.toHaveBeenCalled();
    }
  });

  it("returns retryable evidence status for correlation and persistence errors", async () => {
    for (const persistenceError of [
      new InvitationDeliveryEvidenceError(
        "not_found",
        "private correlation detail"
      ),
      new InvitationDeliveryEvidenceError(
        "invalid_state",
        "private conflict detail"
      )
    ]) {
      const { dependencies } = createDependencies({ persistenceError });
      const response = await handleInvitationProviderWebhook(
        request(),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload).toEqual({
        error: {
          code: "evidence_unavailable",
          message: "Invitation Provider evidence is temporarily unavailable."
        }
      });
      expect(JSON.stringify(payload)).not.toMatch(/private correlation|conflict/);
    }
  });

  it("sanitizes database and unexpected verifier failures", async () => {
    for (const input of [
      { databaseError: new Error("postgres://user:secret@private-host/db") },
      { verifyError: new Error("raw signature verifier internals") }
    ]) {
      const { dependencies } = createDependencies(input);
      const response = await handleInvitationProviderWebhook(
        request(),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload).toEqual({
        error: {
          code: "webhook_unavailable",
          message: "Invitation Provider webhook is temporarily unavailable."
        }
      });
      expect(JSON.stringify(payload)).not.toMatch(
        /postgres|secret@private-host|raw signature|internals/
      );
    }
  });
});

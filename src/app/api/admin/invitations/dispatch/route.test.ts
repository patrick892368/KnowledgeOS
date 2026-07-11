import { describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";
import { InvitationDeliveryAttemptError } from "@/db/invitation-delivery-attempt-repository";
import {
  InvitationEmailDispatchPersistenceError,
  type InvitationEmailDispatchResult
} from "@/invitations/dispatch.server";
import type { InvitationEmailProvider } from "@/invitations/email-provider.server";
import { InvitationLifecycleError } from "@/invitations/lifecycle";

import {
  handleInvitationEmailDispatch,
  type InvitationEmailDispatchRouteDependencies
} from "./handler";

const invitationId = "44444444-4444-4444-8444-444444444444";
const attemptId = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-07-11T00:00:00.000Z");
const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const provider: InvitationEmailProvider = {
  name: "resend",
  enabled: true,
  sendInvitation: vi.fn(async () => ({ messageId: "provider-message-1" }))
};
const invitation = {
  id: invitationId,
  organizationId: session.organizationId,
  email: "member@example.com",
  role: "editor" as const,
  status: "pending" as const,
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  updatedAt: now,
  expiresAt: new Date("2026-07-18T00:00:00.000Z"),
  acceptedAt: null,
  revokedAt: null
};
const delivery = {
  invitationId,
  organizationId: session.organizationId,
  email: invitation.email,
  role: invitation.role,
  status: "pending" as const,
  acceptanceRoute: "/api/invitations/accept" as const,
  deliveryExpiresAt: new Date("2026-07-12T00:00:00.000Z"),
  invitationExpiresAt: invitation.expiresAt,
  tokenExposure: "not_exposed" as const,
  auditIntent: {
    organizationId: session.organizationId,
    actorUserId: null,
    action: "invitation.delivery_planned",
    resourceType: "organization" as const,
    resourceId: session.organizationId,
    metadata: { tokenExposure: "not_exposed" }
  }
};
const preparedAttempt = {
  id: attemptId,
  organizationId: session.organizationId,
  invitationId,
  provider: "resend",
  status: "prepared" as const,
  providerMessageId: null,
  failureCode: null,
  deliveryExpiresAt: delivery.deliveryExpiresAt,
  preparedAt: now,
  providerAcceptedAt: null,
  providerFailedAt: null,
  createdBy: session.userId,
  createdAt: now,
  updatedAt: now
};
const acceptedAttempt = {
  ...preparedAttempt,
  status: "accepted_by_provider" as const,
  providerMessageId: "provider-message-1",
  providerAcceptedAt: now
};
const failedAttempt = {
  ...preparedAttempt,
  status: "provider_failed" as const,
  failureCode: "provider_failed",
  providerFailedAt: now
};
const receipt = {
  deliveryAttemptId: attemptId,
  invitationId,
  recipient: invitation.email,
  provider: "resend",
  providerMessageId: "provider-message-1",
  status: "accepted_by_provider" as const,
  acceptedAt: now,
  tokenExposure: "not_exposed" as const
};
const auditEvent = {
  organizationId: session.organizationId,
  actorUserId: session.userId,
  action: "invitation.delivery_attempt_provider_accepted",
  resourceType: "organization" as const,
  resourceId: session.organizationId,
  metadata: { tokenExposure: "not_exposed" }
};
const acceptedResult = {
  status: "accepted_by_provider",
  invitation,
  delivery,
  attempt: acceptedAttempt,
  receipt,
  auditEvents: {
    review: auditEvent,
    preparation: auditEvent,
    rotation: auditEvent,
    transition: auditEvent
  },
  tokenExposure: "not_exposed"
} as InvitationEmailDispatchResult;
const existingResult = {
  status: "existing_attempt",
  invitation,
  attempt: preparedAttempt,
  auditEvents: { review: auditEvent, preparation: auditEvent },
  tokenExposure: "not_exposed"
} as InvitationEmailDispatchResult;
const failedResult = {
  status: "provider_failed",
  invitation,
  delivery,
  attempt: failedAttempt,
  failure: { code: "provider_failed", recoverable: true },
  auditEvents: {
    review: auditEvent,
    preparation: auditEvent,
    rotation: auditEvent,
    transition: auditEvent
  },
  tokenExposure: "not_exposed"
} as InvitationEmailDispatchResult;

function request(body: unknown, raw = false): Request {
  return new Request(
    "http://knowledgeos.local/api/admin/invitations/dispatch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? String(body) : JSON.stringify(body)
    }
  );
}

function createDependencies(input: {
  session?: AuthSession;
  authError?: unknown;
  providerError?: unknown;
  policyError?: unknown;
  databaseError?: unknown;
  dispatchError?: unknown;
  result?: InvitationEmailDispatchResult;
  environment?: InvitationEmailDispatchRouteDependencies["environment"];
} = {}) {
  const db = { name: "test-db" } as unknown as Database;
  const policy = {
    cooldownSeconds: 60,
    rateLimitWindowSeconds: 3_600,
    maxAttemptsPerWindow: 100
  };
  const dependencies: InvitationEmailDispatchRouteDependencies = {
    requireSession: vi.fn(async () => {
      if (input.authError) {
        throw input.authError;
      }
      return input.session ?? session;
    }),
    createDatabaseClient: vi.fn(() => {
      if (input.databaseError) {
        throw input.databaseError;
      }
      return db;
    }),
    createProvider: vi.fn(() => {
      if (input.providerError) {
        throw input.providerError;
      }
      return provider;
    }),
    createPolicy: vi.fn(() => {
      if (input.policyError) {
        throw input.policyError;
      }
      return policy;
    }),
    dispatchInvitation: vi.fn(async () => {
      if (input.dispatchError) {
        throw input.dispatchError;
      }
      return input.result ?? acceptedResult;
    }),
    environment:
      input.environment ??
      ({
        KNOWLEDGEOS_APP_URL: "https://app.example.com/",
        KNOWLEDGEOS_RESEND_ENABLED: "true",
        RESEND_API_KEY: "re_test_secret_key",
        KNOWLEDGEOS_INVITATION_FROM_EMAIL:
          "KnowledgeOS <invitations@example.com>"
      } satisfies InvitationEmailDispatchRouteDependencies["environment"])
  };

  return { db, dependencies, policy };
}

describe("POST /api/admin/invitations/dispatch", () => {
  it("returns only Provider-accepted public state and server-controls authority", async () => {
    const { db, dependencies, policy } = createDependencies();

    const response = await handleInvitationEmailDispatch(
      request({ invitationId, attemptId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({
      mode: "accepted_by_provider",
      invitation: { id: invitationId, organizationId: session.organizationId },
      attempt: {
        id: attemptId,
        status: "accepted_by_provider",
        deliveryClaim: "provider_status_only",
        tokenExposure: "not_exposed"
      },
      receipt: {
        provider: "resend",
        status: "accepted_by_provider",
        tokenExposure: "not_exposed"
      },
      deliveryClaim: "provider_status_only",
      tokenExposure: "not_exposed"
    });
    expect(dependencies.dispatchInvitation).toHaveBeenCalledWith(db, {
      session,
      invitationId,
      attemptId,
      acceptanceBaseUrl: "https://app.example.com/",
      provider,
      policy
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /one-time-delivery-token|tokenHash|rawToken|re_test_secret_key|auditEvents/i
    );
  });

  it("returns existing attempts without a new delivery claim", async () => {
    const { dependencies } = createDependencies({ result: existingResult });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId, attemptId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      mode: "existing_attempt",
      attempt: { id: attemptId, status: "prepared" },
      deliveryClaim: "provider_status_only"
    });
    expect(payload).not.toHaveProperty("receipt");
    expect(payload).not.toHaveProperty("delivery");
  });

  it("returns bounded Provider failure state without claiming delivery", async () => {
    const { dependencies } = createDependencies({ result: failedResult });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      mode: "provider_failed",
      attempt: { status: "provider_failed" },
      failure: { code: "provider_failed", recoverable: true },
      deliveryClaim: "provider_status_only"
    });
    expect(payload).not.toHaveProperty("receipt");
    expect(JSON.stringify(payload)).not.toMatch(/delivered|auditEvents/i);
  });

  it("stops unauthenticated requests before configuration or database work", async () => {
    const { dependencies } = createDependencies({
      authError: new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthenticated" }
    });
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(dependencies.createPolicy).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.dispatchInvitation).not.toHaveBeenCalled();
  });

  it("keeps unexpected authentication failures separate from database errors", async () => {
    const { dependencies } = createDependencies({
      authError: new Error("session backend leaked internal state")
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        code: "internal_error",
        message: "Unexpected authentication failure."
      }
    });
    expect(JSON.stringify(payload)).not.toContain("session backend");
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(dependencies.createPolicy).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("stops non-manager sessions before parsing side-effect dependencies", async () => {
    const { dependencies } = createDependencies({
      session: { ...session, role: "viewer" }
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("rejects malformed, oversized, invalid, and authority-bearing payloads", async () => {
    const invalidRequests = [
      request("{", true),
      request({ invitationId: "not-a-uuid" }),
      request({ invitationId, attemptId: "not-a-uuid" }),
      request({ invitationId, organizationId: "attacker-org" }),
      request({ invitationId, rawToken: "one-time-delivery-token" }),
      request({ invitationId, provider: "attacker-provider" }),
      request({ invitationId, acceptanceBaseUrl: "https://attacker.invalid" }),
      request({ invitationId, padding: "x".repeat(4_096) })
    ];

    for (const invalidRequest of invalidRequests) {
      const { dependencies } = createDependencies();
      const response = await handleInvitationEmailDispatch(
        invalidRequest,
        dependencies
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_payload" }
      });
      expect(dependencies.createProvider).not.toHaveBeenCalled();
      expect(dependencies.createPolicy).not.toHaveBeenCalled();
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
      expect(dependencies.dispatchInvitation).not.toHaveBeenCalled();
    }
  });

  it("fails safely when the server-controlled application URL is missing", async () => {
    const { dependencies } = createDependencies({ environment: {} });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "dispatch_misconfigured",
        message: "Invitation email dispatch is not configured."
      }
    });
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(dependencies.createPolicy).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("sanitizes Provider configuration failures before database work", async () => {
    const { dependencies } = createDependencies({
      providerError: new Error("re_test_secret_key unsafe sender")
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ error: { code: "dispatch_misconfigured" } });
    expect(JSON.stringify(payload)).not.toMatch(/re_test_secret_key|unsafe sender/);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.dispatchInvitation).not.toHaveBeenCalled();
  });

  it("sanitizes dispatch policy configuration failures before database work", async () => {
    const { dependencies } = createDependencies({
      policyError: new Error("unsafe policy environment value 999999")
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ error: { code: "dispatch_misconfigured" } });
    expect(JSON.stringify(payload)).not.toMatch(/unsafe policy|999999/);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.dispatchInvitation).not.toHaveBeenCalled();
  });

  it("returns HTTP 429 for persisted cooldown and organization rate-limit denial", async () => {
    for (const code of [
      "dispatch_cooldown_active",
      "dispatch_rate_limited"
    ] as const) {
      const { dependencies } = createDependencies({
        result: {
          ...failedResult,
          failure: { code, recoverable: true },
          attempt: { ...failedAttempt, failureCode: code }
        } as InvitationEmailDispatchResult
      });
      const response = await handleInvitationEmailDispatch(
        request({ invitationId, attemptId }),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(429);
      expect(payload).toMatchObject({
        mode: "provider_failed",
        failure: { code },
        attempt: { status: "provider_failed", failureCode: code }
      });
      expect(payload).not.toHaveProperty("receipt");
    }
  });

  it("returns a generic database-unavailable error without leaking internals", async () => {
    const { dependencies } = createDependencies({
      databaseError: new Error("postgres://user:secret@private-host/database")
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "database_unavailable",
        message: "Invitation email dispatch is temporarily unavailable."
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/postgres|private-host|secret/);
    expect(dependencies.dispatchInvitation).not.toHaveBeenCalled();
  });

  it("preserves safe lifecycle and attempt errors from dispatch", async () => {
    for (const [dispatchError, expectedStatus, expectedCode] of [
      [
        new InvitationLifecycleError("not_found", "Invitation was not found."),
        404,
        "not_found"
      ],
      [
        new InvitationDeliveryAttemptError(
          "invalid_state",
          "Invitation delivery attempt state is invalid."
        ),
        409,
        "invalid_state"
      ]
    ] as const) {
      const { dependencies } = createDependencies({ dispatchError });
      const response = await handleInvitationEmailDispatch(
        request({ invitationId }),
        dependencies
      );

      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toMatchObject({
        error: { code: expectedCode }
      });
    }
  });

  it("returns bounded reconciliation identity without original errors", async () => {
    const { dependencies } = createDependencies({
      dispatchError: new InvitationEmailDispatchPersistenceError(
        "database leaked postgres://user:secret@host/db",
        attemptId,
        true,
        "provider-message-1"
      )
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId, attemptId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "provider_status_persistence_failed",
        message: "Invitation email status requires reconciliation.",
        attemptId,
        providerAccepted: true,
        providerMessageId: "provider-message-1"
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/postgres|secret@host/);
  });

  it("sanitizes unexpected dispatch failures as temporary unavailability", async () => {
    const { dependencies } = createDependencies({
      dispatchError: new Error("raw provider and database internals")
    });
    const response = await handleInvitationEmailDispatch(
      request({ invitationId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ error: { code: "database_unavailable" } });
    expect(JSON.stringify(payload)).not.toMatch(/raw provider|database internals/);
  });
});

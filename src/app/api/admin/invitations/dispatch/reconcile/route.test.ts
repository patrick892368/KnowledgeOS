import { describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";
import {
  InvitationDeliveryReconciliationError,
  type InvitationDeliveryReconciliationResult
} from "@/db/invitation-delivery-reconciliation-repository";

import {
  handleInvitationDeliveryReconciliation,
  type InvitationDeliveryReconciliationRouteDependencies
} from "./handler";

const attemptId = "77777777-7777-4777-8777-777777777777";
const evidenceId = "88888888-8888-4888-8888-888888888888";
const invitationId = "44444444-4444-4444-8444-444444444444";
const providerMessageId = "56761188-7520-42d8-8898-ff6fc54ce618";
const now = new Date("2026-07-11T01:00:00.000Z");
const occurredAt = new Date("2026-07-11T00:05:00.000Z");
const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const attempt = {
  id: attemptId,
  organizationId: session.organizationId,
  invitationId,
  provider: "resend",
  status: "accepted_by_provider" as const,
  providerMessageId,
  failureCode: null,
  deliveryExpiresAt: new Date("2026-07-12T00:00:00.000Z"),
  preparedAt: new Date("2026-07-11T00:00:00.000Z"),
  providerAcceptedAt: occurredAt,
  providerFailedAt: null,
  createdBy: session.userId,
  createdAt: new Date("2026-07-11T00:00:00.000Z"),
  updatedAt: now
};
const evidence = {
  id: evidenceId,
  organizationId: session.organizationId,
  invitationId,
  deliveryAttemptId: attemptId,
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server" as const,
  providerMessageId,
  occurredAt,
  receivedAt: now
};
const auditEvent = {
  organizationId: session.organizationId,
  actorUserId: session.userId,
  action: "invitation.delivery_attempt_reconciled_provider_accepted",
  resourceType: "organization" as const,
  resourceId: session.organizationId,
  metadata: {
    attemptId,
    evidenceId,
    tokenExposure: "not_exposed"
  }
};
const reconciledResult: InvitationDeliveryReconciliationResult = {
  mode: "reconciled",
  attempt,
  evidence,
  auditEvent
};

function request(body: unknown, raw = false): Request {
  return new Request(
    "http://knowledgeos.local/api/admin/invitations/dispatch/reconcile",
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
  databaseError?: unknown;
  reconcileError?: unknown;
  result?: InvitationDeliveryReconciliationResult;
} = {}) {
  const db = { name: "reconciliation-test-db" } as unknown as Database;
  const createDatabaseClient = vi.fn(() => {
    if (input.databaseError) {
      throw input.databaseError;
    }
    return db;
  });
  const reconcile = vi.fn(async () => {
    if (input.reconcileError) {
      throw input.reconcileError;
    }
    return input.result ?? reconciledResult;
  });
  const requireSession = vi.fn(async () => {
    if (input.authError) {
      throw input.authError;
    }
    return input.session ?? session;
  });
  const dependencies: InvitationDeliveryReconciliationRouteDependencies = {
    requireSession,
    createDatabaseClient,
    reconcile:
      reconcile as unknown as InvitationDeliveryReconciliationRouteDependencies["reconcile"],
    now: vi.fn(() => now)
  };

  return { createDatabaseClient, db, dependencies, reconcile, requireSession };
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectKeys);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectObjectKeys(nestedValue)
  ]);
}

describe("POST /api/admin/invitations/dispatch/reconcile", () => {
  it("reconciles through server session authority and returns only safe state", async () => {
    const { createDatabaseClient, db, dependencies, reconcile, requireSession } =
      createDependencies();
    const response = await handleInvitationDeliveryReconciliation(
      request({ attemptId, evidenceId }),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      mode: "reconciled",
      attempt: {
        id: attemptId,
        invitationId,
        provider: "resend",
        status: "accepted_by_provider",
        providerMessageId,
        providerAcceptedAt: occurredAt.toISOString(),
        updatedAt: now.toISOString(),
        deliveryClaim: "provider_status_only",
        tokenExposure: "not_exposed"
      },
      evidence: {
        id: evidenceId,
        providerEventType: "email.delivered",
        evidenceType: "delivered_to_recipient_server",
        occurredAt: occurredAt.toISOString(),
        inboxDeliveryClaim: "not_claimed",
        tokenExposure: "not_exposed"
      },
      deliveryClaim: "provider_status_only",
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    });
    expect(reconcile).toHaveBeenCalledWith(db, {
      session,
      attemptId,
      evidenceId,
      reconciledAt: now
    });
    expect(requireSession.mock.invocationCallOrder[0]).toBeLessThan(
      createDatabaseClient.mock.invocationCallOrder[0]
    );
    const responseKeys = collectObjectKeys(payload).map((key) =>
      key.toLowerCase()
    );

    for (const forbiddenKey of [
      "organizationid",
      "actoruserid",
      "auditevent",
      "recipient",
      "recipientemail",
      "email",
      "rawtoken",
      "tokenhash",
      "rawpayload",
      "signature",
      "secret"
    ]) {
      expect(responseKeys).not.toContain(forbiddenKey);
    }
    expect(JSON.stringify(payload)).not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|inbox_delivered/i
    );
  });

  it("returns an idempotent existing result without changing public semantics", async () => {
    const { dependencies } = createDependencies({
      result: {
        ...reconciledResult,
        mode: "existing",
        auditEvent: null
      }
    });
    const response = await handleInvitationDeliveryReconciliation(
      request({ attemptId, evidenceId }),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "existing",
      attempt: { status: "accepted_by_provider" },
      inboxDeliveryClaim: "not_claimed"
    });
  });

  it("stops unauthenticated requests before body or database work", async () => {
    const { dependencies } = createDependencies({
      authError: new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    });
    const reconciliationRequest = request("{", true);
    const response = await handleInvitationDeliveryReconciliation(
      reconciliationRequest,
      dependencies
    );

    expect(response.status).toBe(401);
    expect(reconciliationRequest.bodyUsed).toBe(false);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.reconcile).not.toHaveBeenCalled();
  });

  it("keeps unexpected authentication failure separate and sanitized", async () => {
    const { dependencies } = createDependencies({
      authError: new Error("private session backend detail")
    });
    const response = await handleInvitationDeliveryReconciliation(
      request({ attemptId, evidenceId }),
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
    expect(JSON.stringify(payload)).not.toContain("private session");
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("stops non-manager sessions before body or database work", async () => {
    const { dependencies } = createDependencies({
      session: { ...session, role: "viewer" }
    });
    const reconciliationRequest = request("{", true);
    const response = await handleInvitationDeliveryReconciliation(
      reconciliationRequest,
      dependencies
    );

    expect(response.status).toBe(403);
    expect(reconciliationRequest.bodyUsed).toBe(false);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.reconcile).not.toHaveBeenCalled();
  });

  it("rejects malformed, invalid, oversized, and authority-bearing bodies", async () => {
    const invalidRequests = [
      request("{", true),
      request({ attemptId: "not-a-uuid", evidenceId }),
      request({ attemptId, evidenceId: "not-a-uuid" }),
      request({ attemptId, evidenceId, organizationId: "attacker-org" }),
      request({ attemptId, evidenceId, provider: "attacker-provider" }),
      request({ attemptId, evidenceId, rawToken: "secret" }),
      request({ attemptId, evidenceId, padding: "x".repeat(4_096) })
    ];

    for (const invalidRequest of invalidRequests) {
      const { dependencies } = createDependencies();
      const response = await handleInvitationDeliveryReconciliation(
        invalidRequest,
        dependencies
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_payload" }
      });
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
      expect(dependencies.reconcile).not.toHaveBeenCalled();
    }
  });

  it("preserves safe repository errors and status mapping", async () => {
    for (const [code, expectedStatus] of [
      ["forbidden", 403],
      ["invalid_payload", 400],
      ["not_found", 404],
      ["invalid_state", 409]
    ] as const) {
      const { dependencies } = createDependencies({
        reconcileError: new InvitationDeliveryReconciliationError(
          code,
          "Safe reconciliation error."
        )
      });
      const response = await handleInvitationDeliveryReconciliation(
        request({ attemptId, evidenceId }),
        dependencies
      );

      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toEqual({
        error: { code, message: "Safe reconciliation error." }
      });
    }
  });

  it("sanitizes database creation and unexpected repository failures", async () => {
    for (const input of [
      { databaseError: new Error("postgres://user:secret@private-host/db") },
      { reconcileError: new Error("raw evidence and audit internals") }
    ]) {
      const { dependencies } = createDependencies(input);
      const response = await handleInvitationDeliveryReconciliation(
        request({ attemptId, evidenceId }),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload).toEqual({
        error: {
          code: "database_unavailable",
          message:
            "Invitation delivery reconciliation is temporarily unavailable."
        }
      });
      expect(JSON.stringify(payload)).not.toMatch(
        /postgres|secret@private-host|raw evidence|audit internals/
      );
    }
  });
});

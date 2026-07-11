import { describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";
import { InvitationDeliveryEvidenceReviewError } from "@/db/invitation-delivery-evidence-review-repository";
import type { PersistedInvitationDeliveryEvidence } from "@/db/invitation-delivery-evidence-repository";

import {
  handleInvitationDeliveryEvidenceReview,
  type InvitationDeliveryEvidenceReviewRouteDependencies
} from "./handler";

const attemptId = "77777777-7777-4777-8777-777777777777";
const invitationId = "44444444-4444-4444-8444-444444444444";
const evidenceId = "88888888-8888-4888-8888-888888888888";
const providerMessageId = "56761188-7520-42d8-8898-ff6fc54ce618";
const occurredAt = new Date("2026-07-11T00:05:00.000Z");
const receivedAt = new Date("2026-07-11T00:05:01.000Z");
const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const evidence: PersistedInvitationDeliveryEvidence = {
  id: evidenceId,
  organizationId: session.organizationId,
  invitationId,
  deliveryAttemptId: attemptId,
  provider: "resend",
  providerEventId: "msg_777777777777",
  providerEventType: "email.delivered",
  evidenceType: "delivered_to_recipient_server",
  providerMessageId,
  occurredAt,
  receivedAt
};

function request(query = `?attemptId=${attemptId}`): Request {
  return new Request(
    `http://knowledgeos.local/api/admin/invitations/dispatch/evidence${query}`
  );
}

function createDependencies(input: {
  session?: AuthSession;
  authError?: unknown;
  databaseError?: unknown;
  listError?: unknown;
  evidence?: PersistedInvitationDeliveryEvidence[];
} = {}) {
  const db = { name: "evidence-review-test-db" } as unknown as Database;
  const requireSession = vi.fn(async () => {
    if (input.authError) {
      throw input.authError;
    }
    return input.session ?? session;
  });
  const createDatabaseClient = vi.fn(() => {
    if (input.databaseError) {
      throw input.databaseError;
    }
    return db;
  });
  const listEvidence = vi.fn(async () => {
    if (input.listError) {
      throw input.listError;
    }
    return input.evidence ?? [evidence];
  });
  const dependencies: InvitationDeliveryEvidenceReviewRouteDependencies = {
    requireSession,
    createDatabaseClient,
    listEvidence:
      listEvidence as unknown as InvitationDeliveryEvidenceReviewRouteDependencies["listEvidence"]
  };

  return {
    createDatabaseClient,
    db,
    dependencies,
    listEvidence,
    requireSession
  };
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

describe("GET /api/admin/invitations/dispatch/evidence", () => {
  it("returns bounded current-attempt evidence with only safe fields", async () => {
    const {
      createDatabaseClient,
      db,
      dependencies,
      listEvidence,
      requireSession
    } = createDependencies();
    const response = await handleInvitationDeliveryEvidenceReview(
      request(`?attemptId=${attemptId}&limit=25`),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
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
          occurredAt: occurredAt.toISOString(),
          receivedAt: receivedAt.toISOString(),
          deliveryClaim: "provider_status_only",
          inboxDeliveryClaim: "not_claimed",
          tokenExposure: "not_exposed"
        }
      ],
      deliveryClaim: "provider_status_only",
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    });
    expect(listEvidence).toHaveBeenCalledWith(db, {
      session,
      attemptId,
      limit: 25
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
      "recipient",
      "email",
      "rawtoken",
      "tokenhash",
      "rawpayload",
      "signature",
      "secret",
      "rawerror"
    ]) {
      expect(responseKeys).not.toContain(forbiddenKey);
    }
    expect(JSON.stringify(payload)).not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|inbox_delivered/i
    );
  });

  it("returns a safe empty result without revealing attempt existence", async () => {
    const { dependencies } = createDependencies({ evidence: [] });
    const response = await handleInvitationDeliveryEvidenceReview(
      request(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      attemptId,
      count: 0,
      evidence: [],
      deliveryClaim: "provider_status_only",
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    });
  });

  it("stops unauthenticated requests before database work", async () => {
    const { dependencies } = createDependencies({
      authError: new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    });
    const response = await handleInvitationDeliveryEvidenceReview(
      request("?attemptId=not-a-uuid"),
      dependencies
    );

    expect(response.status).toBe(401);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.listEvidence).not.toHaveBeenCalled();
  });

  it("keeps unexpected authentication failure separate and sanitized", async () => {
    const { dependencies } = createDependencies({
      authError: new Error("private session backend detail")
    });
    const response = await handleInvitationDeliveryEvidenceReview(
      request(),
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

  it("stops non-manager sessions before query or database work", async () => {
    const { dependencies } = createDependencies({
      session: { ...session, role: "viewer" }
    });
    const response = await handleInvitationDeliveryEvidenceReview(
      request("?attemptId=not-a-uuid"),
      dependencies
    );

    expect(response.status).toBe(403);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.listEvidence).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed, duplicate, unbounded, and authority queries", async () => {
    const invalidQueries = [
      "",
      "?attemptId=",
      "?attemptId=not-a-uuid",
      `?attemptId=${attemptId}&attemptId=${attemptId}`,
      `?attemptId=${attemptId}&limit=0`,
      `?attemptId=${attemptId}&limit=101`,
      `?attemptId=${attemptId}&limit=1.5`,
      `?attemptId=${attemptId}&organizationId=${session.organizationId}`,
      `?attemptId=${attemptId}&provider=resend`
    ];

    for (const query of invalidQueries) {
      const { dependencies } = createDependencies();
      const response = await handleInvitationDeliveryEvidenceReview(
        request(query),
        dependencies
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "invalid_payload" }
      });
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
      expect(dependencies.listEvidence).not.toHaveBeenCalled();
    }
  });

  it("preserves a safe repository authorization error", async () => {
    const { dependencies } = createDependencies({
      listError: new InvitationDeliveryEvidenceReviewError(
        "forbidden",
        "Only owner or admin members can review invitation delivery evidence."
      )
    });
    const response = await handleInvitationDeliveryEvidenceReview(
      request(),
      dependencies
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden" }
    });
  });

  it("sanitizes database and unexpected repository failures", async () => {
    for (const input of [
      { databaseError: new Error("postgres://user:secret@private-host/db") },
      { listError: new Error("raw recipient and payload internals") }
    ]) {
      const { dependencies } = createDependencies(input);
      const response = await handleInvitationDeliveryEvidenceReview(
        request(),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload).toEqual({
        error: {
          code: "database_unavailable",
          message: "Invitation delivery evidence is temporarily unavailable."
        }
      });
      expect(JSON.stringify(payload)).not.toMatch(
        /postgres|secret@private-host|raw recipient|payload internals/
      );
    }
  });
});

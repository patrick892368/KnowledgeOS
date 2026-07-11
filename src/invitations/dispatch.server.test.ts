import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";

import {
  dispatchInvitationEmail,
  InvitationEmailDispatchPersistenceError,
  type InvitationEmailDispatchDependencies
} from "./dispatch.server";
import { createInvitationDeliveryPlan } from "./delivery";
import {
  InvitationEmailDeliveryError,
  type InvitationEmailProvider
} from "./email-provider.server";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  source: "signed-cookie"
};
const now = new Date("2026-07-11T00:00:00.000Z");
const attemptId = "77777777-7777-4777-8777-777777777777";
const invitation = {
  id: "44444444-4444-4444-8444-444444444444",
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
const delivery = createInvitationDeliveryPlan({
  target: {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt
  },
  options: {
    now,
    deliveryTtlHours: 24,
    rawToken: "one-time-delivery-token"
  }
});
const preparedAttempt = {
  id: attemptId,
  organizationId: session.organizationId,
  invitationId: invitation.id,
  provider: "test_provider",
  status: "prepared" as const,
  providerMessageId: null,
  failureCode: null,
  deliveryExpiresAt: delivery.publicPlan.deliveryExpiresAt,
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
const auditEvent = (action: string) => ({
  organizationId: session.organizationId,
  actorUserId: session.userId,
  action,
  resourceType: "organization" as const,
  resourceId: session.organizationId,
  metadata: {
    tokenExposure: "not_exposed"
  }
});
const reviewResult = {
  invitation,
  delivery: delivery.publicPlan,
  auditEvent: auditEvent("invitation.resend_prepared")
};
const rotationResult = {
  invitation,
  delivery,
  auditEvent: auditEvent("invitation.delivery_token_rotated")
};
const preparationResult = {
  mode: "created" as const,
  attempt: preparedAttempt,
  auditEvent: auditEvent("invitation.delivery_attempt_prepared")
};
const receipt = {
  deliveryAttemptId: attemptId,
  invitationId: invitation.id,
  recipient: invitation.email,
  provider: "test_provider",
  providerMessageId: "provider-message-1",
  status: "accepted_by_provider" as const,
  acceptedAt: now,
  tokenExposure: "not_exposed" as const
};
const provider: InvitationEmailProvider = {
  name: "test_provider",
  enabled: true,
  sendInvitation: vi.fn(async () => ({ messageId: "provider-message-1" }))
};
const db = {} as Database;

function createDependencies(input?: {
  steps?: string[];
  preparationMode?: "created" | "existing";
  deliverError?: unknown;
  reviewError?: unknown;
  preparationError?: unknown;
  rotationError?: unknown;
  acceptedTransitionError?: unknown;
  failedTransitionError?: unknown;
}): InvitationEmailDispatchDependencies {
  const steps = input?.steps ?? [];

  return {
    reviewDelivery: vi.fn(async () => {
      steps.push("review");
      if (input?.reviewError) {
        throw input.reviewError;
      }

      return reviewResult;
    }),
    rotateToken: vi.fn(async () => {
      steps.push("rotate");
      if (input?.rotationError) {
        throw input.rotationError;
      }

      return rotationResult;
    }),
    persistAttempt: vi.fn(async (_db, attemptInput) => {
      steps.push("prepare");
      if (input?.preparationError) {
        throw input.preparationError;
      }

      return {
        ...preparationResult,
        mode: input?.preparationMode ?? "created",
        attempt: {
          ...preparationResult.attempt,
          provider: attemptInput.provider
        }
      };
    }),
    deliverEmail: vi.fn(async () => {
      steps.push("provider");
      if (input?.deliverError) {
        throw input.deliverError;
      }

      return receipt;
    }),
    markProviderAccepted: vi.fn(async () => {
      steps.push("accepted");
      if (input?.acceptedTransitionError) {
        throw input.acceptedTransitionError;
      }

      return {
        attempt: acceptedAttempt,
        auditEvent: auditEvent(
          "invitation.delivery_attempt_provider_accepted"
        )
      };
    }),
    markProviderFailed: vi.fn(async (_db, failureInput) => {
      steps.push("failed");
      if (input?.failedTransitionError) {
        throw input.failedTransitionError;
      }

      return {
        attempt: {
          ...failedAttempt,
          provider: preparationResult.attempt.provider,
          failureCode: failureInput.failureCode
        },
        auditEvent: auditEvent("invitation.delivery_attempt_provider_failed")
      };
    })
  };
}

describe("dispatchInvitationEmail", () => {
  it("reserves, rotates, calls the provider, and persists acceptance in order", async () => {
    const steps: string[] = [];
    const dependencies = createDependencies({ steps });

    const result = await dispatchInvitationEmail(
      db,
      {
        session,
        invitationId: invitation.id,
        acceptanceBaseUrl: "https://app.example.com/",
        provider,
        attemptId,
        now,
        rawToken: "one-time-delivery-token"
      },
      dependencies
    );

    expect(steps).toEqual([
      "review",
      "prepare",
      "rotate",
      "provider",
      "accepted"
    ]);
    expect(result).toMatchObject({
      status: "accepted_by_provider",
      invitation,
      delivery: delivery.publicPlan,
      attempt: acceptedAttempt,
      receipt,
      tokenExposure: "not_exposed"
    });
    expect(dependencies.deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: delivery,
        deliveryAttemptId: attemptId,
        provider
      })
    );
    expect(JSON.stringify(result)).not.toMatch(
      /one-time-delivery-token|tokenHash|rawToken|secret/i
    );
  });

  it("returns existing attempts without rotating or sending again", async () => {
    const steps: string[] = [];
    const dependencies = createDependencies({
      steps,
      preparationMode: "existing"
    });

    const result = await dispatchInvitationEmail(
      db,
      {
        session,
        invitationId: invitation.id,
        acceptanceBaseUrl: "https://app.example.com/",
        provider,
        attemptId,
        now
      },
      dependencies
    );

    expect(steps).toEqual(["review", "prepare"]);
    expect(result).toMatchObject({
      status: "existing_attempt",
      attempt: preparedAttempt,
      tokenExposure: "not_exposed"
    });
    expect(dependencies.rotateToken).not.toHaveBeenCalled();
    expect(dependencies.deliverEmail).not.toHaveBeenCalled();
  });

  it("records a safe provider failure result without a delivery claim", async () => {
    const steps: string[] = [];
    const dependencies = createDependencies({
      steps,
      deliverError: new InvitationEmailDeliveryError(
        "provider_failed",
        "sanitized provider failure",
        true
      )
    });

    const result = await dispatchInvitationEmail(
      db,
      {
        session,
        invitationId: invitation.id,
        acceptanceBaseUrl: "https://app.example.com/",
        provider,
        attemptId,
        now
      },
      dependencies
    );

    expect(steps).toEqual([
      "review",
      "prepare",
      "rotate",
      "provider",
      "failed"
    ]);
    expect(result).toMatchObject({
      status: "provider_failed",
      failure: {
        code: "provider_failed",
        recoverable: true
      },
      attempt: {
        status: "provider_failed"
      },
      tokenExposure: "not_exposed"
    });
    expect(JSON.stringify(result)).not.toMatch(/sanitized provider failure/);
    expect(JSON.stringify(result)).not.toMatch(/delivered/);
  });

  it("records configuration failure before rotation", async () => {
    const steps: string[] = [];
    const dependencies = createDependencies({ steps });

    const result = await dispatchInvitationEmail(
      db,
      {
        session,
        invitationId: invitation.id,
        acceptanceBaseUrl: "https://app.example.com/",
        attemptId,
        now
      },
      dependencies
    );

    expect(steps).toEqual(["review", "prepare", "failed"]);
    expect(dependencies.persistAttempt).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ provider: "unconfigured" })
    );
    expect(dependencies.rotateToken).not.toHaveBeenCalled();
    expect(dependencies.deliverEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "provider_failed",
      failure: {
        code: "provider_unconfigured"
      }
    });
  });

  it("records rotation failure and stops before the provider", async () => {
    const steps: string[] = [];
    const dependencies = createDependencies({
      steps,
      rotationError: new Error("invitation changed")
    });

    const result = await dispatchInvitationEmail(
      db,
      {
        session,
        invitationId: invitation.id,
        acceptanceBaseUrl: "https://app.example.com/",
        provider,
        attemptId,
        now
      },
      dependencies
    );

    expect(steps).toEqual(["review", "prepare", "rotate", "failed"]);
    expect(dependencies.deliverEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "provider_failed",
      failure: {
        code: "rotation_failed"
      }
    });
  });

  it("stops before rotation and Provider when attempt reservation fails", async () => {
    const steps: string[] = [];
    const error = new Error("attempt persistence failed");
    const dependencies = createDependencies({
      steps,
      preparationError: error
    });

    await expect(
      dispatchInvitationEmail(
        db,
        {
          session,
          invitationId: invitation.id,
          acceptanceBaseUrl: "https://app.example.com/",
          provider,
          attemptId,
          now
        },
        dependencies
      )
    ).rejects.toBe(error);
    expect(steps).toEqual(["review", "prepare"]);
    expect(dependencies.rotateToken).not.toHaveBeenCalled();
    expect(dependencies.deliverEmail).not.toHaveBeenCalled();
  });

  it("requires reconciliation when Provider acceptance persistence fails", async () => {
    const dependencies = createDependencies({
      acceptedTransitionError: new Error("database failed")
    });

    await expect(
      dispatchInvitationEmail(
        db,
        {
          session,
          invitationId: invitation.id,
          acceptanceBaseUrl: "https://app.example.com/",
          provider,
          attemptId,
          now
        },
        dependencies
      )
    ).rejects.toMatchObject({
      code: "provider_status_persistence_failed",
      attemptId,
      providerAccepted: true,
      providerMessageId: receipt.providerMessageId
    });
  });

  it("surfaces safe persistence failure when Provider failure cannot be recorded", async () => {
    const dependencies = createDependencies({
      deliverError: new Error("provider leaked a secret"),
      failedTransitionError: new Error("database failed")
    });

    let caught: unknown;
    try {
      await dispatchInvitationEmail(
        db,
        {
          session,
          invitationId: invitation.id,
          acceptanceBaseUrl: "https://app.example.com/",
          provider,
          attemptId,
          now
        },
        dependencies
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvitationEmailDispatchPersistenceError);
    expect(caught).toMatchObject({
      code: "provider_status_persistence_failed",
      attemptId,
      providerAccepted: false
    });
    expect(JSON.stringify(caught)).not.toMatch(/provider leaked a secret/);
  });
});

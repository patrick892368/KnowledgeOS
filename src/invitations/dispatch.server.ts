import type { AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";
import {
  markInvitationDeliveryAttemptProviderAccepted,
  markInvitationDeliveryAttemptProviderFailed,
  persistInvitationDeliveryAttempt,
  type PersistedInvitationDeliveryAttempt
} from "@/db/invitation-delivery-attempt-repository";
import {
  prepareInvitationResend,
  rotateInvitationDeliveryToken,
  type PersistedInvitation
} from "@/db/invitation-repository";
import type { auditEvents } from "@/db/schema";

import type { PublicInvitationDeliveryPlan } from "./delivery";
import {
  deliverInvitationEmail,
  InvitationEmailDeliveryError,
  parseInvitationEmailProviderName,
  type InvitationEmailDeliveryErrorCode,
  type InvitationEmailProvider,
  type PublicInvitationEmailReceipt
} from "./email-provider.server";

export interface InvitationEmailDispatchDependencies {
  reviewDelivery: typeof prepareInvitationResend;
  rotateToken: typeof rotateInvitationDeliveryToken;
  persistAttempt: typeof persistInvitationDeliveryAttempt;
  deliverEmail: typeof deliverInvitationEmail;
  markProviderAccepted: typeof markInvitationDeliveryAttemptProviderAccepted;
  markProviderFailed: typeof markInvitationDeliveryAttemptProviderFailed;
}

export type InvitationEmailDispatchFailureCode =
  | InvitationEmailDeliveryErrorCode
  | "provider_failed"
  | "rotation_failed";

export type InvitationEmailDispatchPersistenceErrorCode =
  "provider_status_persistence_failed";

export class InvitationEmailDispatchPersistenceError extends Error {
  constructor(
    message: string,
    public readonly attemptId: string,
    public readonly providerAccepted: boolean,
    public readonly providerMessageId?: string
  ) {
    super(message);
    this.name = "InvitationEmailDispatchPersistenceError";
  }

  readonly code: InvitationEmailDispatchPersistenceErrorCode =
    "provider_status_persistence_failed";
  readonly recoverable = true;
}

interface InvitationEmailDispatchAuditEvents {
  review: typeof auditEvents.$inferInsert;
  preparation: typeof auditEvents.$inferInsert;
  rotation?: typeof auditEvents.$inferInsert;
  transition?: typeof auditEvents.$inferInsert;
}

interface InvitationEmailDispatchBase {
  invitation: PersistedInvitation;
  attempt: PersistedInvitationDeliveryAttempt;
  auditEvents: InvitationEmailDispatchAuditEvents;
  tokenExposure: "not_exposed";
}

export interface InvitationEmailDispatchExistingResult
  extends InvitationEmailDispatchBase {
  status: "existing_attempt";
}

export interface InvitationEmailDispatchAcceptedResult
  extends InvitationEmailDispatchBase {
  status: "accepted_by_provider";
  delivery: PublicInvitationDeliveryPlan;
  receipt: PublicInvitationEmailReceipt;
}

export interface InvitationEmailDispatchFailedResult
  extends InvitationEmailDispatchBase {
  status: "provider_failed";
  delivery: PublicInvitationDeliveryPlan;
  failure: {
    code: InvitationEmailDispatchFailureCode;
    recoverable: true;
  };
}

export type InvitationEmailDispatchResult =
  | InvitationEmailDispatchExistingResult
  | InvitationEmailDispatchAcceptedResult
  | InvitationEmailDispatchFailedResult;

const defaultDependencies: InvitationEmailDispatchDependencies = {
  reviewDelivery: prepareInvitationResend,
  rotateToken: rotateInvitationDeliveryToken,
  persistAttempt: persistInvitationDeliveryAttempt,
  deliverEmail: deliverInvitationEmail,
  markProviderAccepted: markInvitationDeliveryAttemptProviderAccepted,
  markProviderFailed: markInvitationDeliveryAttemptProviderFailed
};

function attemptProviderName(provider: InvitationEmailProvider | undefined) {
  if (!provider) {
    return "unconfigured";
  }

  try {
    return parseInvitationEmailProviderName(provider.name);
  } catch {
    return "invalid_provider";
  }
}

function providerConfigurationFailure(
  provider: InvitationEmailProvider | undefined
): InvitationEmailDeliveryErrorCode | null {
  if (!provider) {
    return "provider_unconfigured";
  }

  if (!provider.enabled) {
    return "provider_disabled";
  }

  try {
    parseInvitationEmailProviderName(provider.name);
    return null;
  } catch {
    return "provider_disabled";
  }
}

function providerFailure(error: unknown): InvitationEmailDispatchFailureCode {
  return error instanceof InvitationEmailDeliveryError
    ? error.code
    : "provider_failed";
}

async function persistFailureOrThrow(input: {
  db: Database;
  dependencies: InvitationEmailDispatchDependencies;
  session: AuthSession;
  attemptId: string;
  failureCode: InvitationEmailDispatchFailureCode;
  failedAt: Date;
}) {
  try {
    return await input.dependencies.markProviderFailed(input.db, {
      session: input.session,
      attemptId: input.attemptId,
      failureCode: input.failureCode,
      failedAt: input.failedAt
    });
  } catch {
    throw new InvitationEmailDispatchPersistenceError(
      "Invitation provider failure state could not be persisted.",
      input.attemptId,
      false
    );
  }
}

export async function dispatchInvitationEmail(
  db: Database,
  input: {
    session: AuthSession;
    invitationId: string;
    acceptanceBaseUrl: string;
    provider?: InvitationEmailProvider;
    attemptId?: string;
    now?: Date;
    deliveryTtlHours?: number;
    rawToken?: string;
  },
  dependencies: InvitationEmailDispatchDependencies = defaultDependencies
): Promise<InvitationEmailDispatchResult> {
  const dispatchAt = input.now ?? new Date();
  const review = await dependencies.reviewDelivery(db, {
    session: input.session,
    invitationId: input.invitationId,
    now: dispatchAt,
    deliveryTtlHours: input.deliveryTtlHours
  });
  const preparation = await dependencies.persistAttempt(db, {
    session: input.session,
    delivery: review.delivery,
    provider: attemptProviderName(input.provider),
    attemptId: input.attemptId,
    now: dispatchAt
  });

  if (preparation.mode === "existing") {
    return {
      status: "existing_attempt",
      invitation: review.invitation,
      attempt: preparation.attempt,
      auditEvents: {
        review: review.auditEvent,
        preparation: preparation.auditEvent
      },
      tokenExposure: "not_exposed"
    };
  }

  const configurationFailure = providerConfigurationFailure(input.provider);

  if (configurationFailure) {
    const transition = await persistFailureOrThrow({
      db,
      dependencies,
      session: input.session,
      attemptId: preparation.attempt.id,
      failureCode: configurationFailure,
      failedAt: dispatchAt
    });

    return {
      status: "provider_failed",
      invitation: review.invitation,
      delivery: review.delivery,
      attempt: transition.attempt,
      failure: {
        code: configurationFailure,
        recoverable: true
      },
      auditEvents: {
        review: review.auditEvent,
        preparation: preparation.auditEvent,
        transition: transition.auditEvent
      },
      tokenExposure: "not_exposed"
    };
  }

  let rotation: Awaited<ReturnType<typeof rotateInvitationDeliveryToken>>;

  try {
    rotation = await dependencies.rotateToken(db, {
      session: input.session,
      invitationId: input.invitationId,
      now: dispatchAt,
      deliveryTtlHours: input.deliveryTtlHours,
      rawToken: input.rawToken
    });
  } catch {
    const transition = await persistFailureOrThrow({
      db,
      dependencies,
      session: input.session,
      attemptId: preparation.attempt.id,
      failureCode: "rotation_failed",
      failedAt: dispatchAt
    });

    return {
      status: "provider_failed",
      invitation: review.invitation,
      delivery: review.delivery,
      attempt: transition.attempt,
      failure: {
        code: "rotation_failed",
        recoverable: true
      },
      auditEvents: {
        review: review.auditEvent,
        preparation: preparation.auditEvent,
        transition: transition.auditEvent
      },
      tokenExposure: "not_exposed"
    };
  }

  let receipt: PublicInvitationEmailReceipt;

  try {
    receipt = await dependencies.deliverEmail({
      plan: rotation.delivery,
      deliveryAttemptId: preparation.attempt.id,
      acceptanceBaseUrl: input.acceptanceBaseUrl,
      provider: input.provider,
      now: dispatchAt
    });
  } catch (error) {
    const failureCode = providerFailure(error);
    const transition = await persistFailureOrThrow({
      db,
      dependencies,
      session: input.session,
      attemptId: preparation.attempt.id,
      failureCode,
      failedAt: dispatchAt
    });

    return {
      status: "provider_failed",
      invitation: rotation.invitation,
      delivery: rotation.delivery.publicPlan,
      attempt: transition.attempt,
      failure: {
        code: failureCode,
        recoverable: true
      },
      auditEvents: {
        review: review.auditEvent,
        preparation: preparation.auditEvent,
        rotation: rotation.auditEvent,
        transition: transition.auditEvent
      },
      tokenExposure: "not_exposed"
    };
  }

  try {
    const transition = await dependencies.markProviderAccepted(db, {
      session: input.session,
      attemptId: preparation.attempt.id,
      receipt
    });

    return {
      status: "accepted_by_provider",
      invitation: rotation.invitation,
      delivery: rotation.delivery.publicPlan,
      attempt: transition.attempt,
      receipt,
      auditEvents: {
        review: review.auditEvent,
        preparation: preparation.auditEvent,
        rotation: rotation.auditEvent,
        transition: transition.auditEvent
      },
      tokenExposure: "not_exposed"
    };
  } catch {
    throw new InvitationEmailDispatchPersistenceError(
      "Invitation provider acceptance state requires reconciliation.",
      preparation.attempt.id,
      true,
      receipt.providerMessageId
    );
  }
}

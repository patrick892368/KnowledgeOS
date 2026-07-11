import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import type { InvitationDeliveryAttemptStatus } from "@/db/model";
import type { PublicInvitationDeliveryPlan } from "@/invitations/delivery";
import {
  InvitationEmailDeliveryError,
  parseInvitationEmailProviderMessageId,
  parseInvitationEmailProviderName,
  type PublicInvitationEmailReceipt
} from "@/invitations/email-provider.server";
import {
  canPlanInvitations,
  isValidInvitationEmail
} from "@/invitations/lifecycle";

import type { Database } from "./client";
import {
  auditEvents,
  invitationDeliveryAttempts,
  invitations
} from "./schema";

export type InvitationDeliveryAttemptPersistenceMode = "created" | "existing";
export type InvitationDeliveryAttemptErrorCode =
  | "forbidden"
  | "cross_scope"
  | "invalid_payload"
  | "not_found"
  | "invalid_state";

export class InvitationDeliveryAttemptError extends Error {
  constructor(
    public readonly code: InvitationDeliveryAttemptErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvitationDeliveryAttemptError";
  }
}

export interface PersistedInvitationDeliveryAttempt {
  id: string;
  organizationId: string;
  invitationId: string;
  provider: string;
  status: InvitationDeliveryAttemptStatus;
  providerMessageId: string | null;
  failureCode: string | null;
  deliveryExpiresAt: Date;
  preparedAt: Date;
  providerAcceptedAt: Date | null;
  providerFailedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvitationDeliveryAttemptPersistenceResult {
  mode: InvitationDeliveryAttemptPersistenceMode;
  attempt: PersistedInvitationDeliveryAttempt;
  auditEvent: typeof auditEvents.$inferInsert;
}

export interface InvitationDeliveryAttemptTransitionResult {
  attempt: PersistedInvitationDeliveryAttempt;
  auditEvent: typeof auditEvents.$inferInsert;
}

const attemptSelection = {
  id: invitationDeliveryAttempts.id,
  organizationId: invitationDeliveryAttempts.organizationId,
  invitationId: invitationDeliveryAttempts.invitationId,
  provider: invitationDeliveryAttempts.provider,
  status: invitationDeliveryAttempts.status,
  providerMessageId: invitationDeliveryAttempts.providerMessageId,
  failureCode: invitationDeliveryAttempts.failureCode,
  deliveryExpiresAt: invitationDeliveryAttempts.deliveryExpiresAt,
  preparedAt: invitationDeliveryAttempts.preparedAt,
  providerAcceptedAt: invitationDeliveryAttempts.providerAcceptedAt,
  providerFailedAt: invitationDeliveryAttempts.providerFailedAt,
  createdBy: invitationDeliveryAttempts.createdBy,
  createdAt: invitationDeliveryAttempts.createdAt,
  updatedAt: invitationDeliveryAttempts.updatedAt
};

const invitationSelection = {
  id: invitations.id,
  organizationId: invitations.organizationId,
  email: invitations.email,
  role: invitations.role,
  status: invitations.status,
  expiresAt: invitations.expiresAt
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertManager(session: AuthSession): void {
  if (!canPlanInvitations(session.role)) {
    throw new InvitationDeliveryAttemptError(
      "forbidden",
      "Only owner or admin members can manage invitation delivery attempts."
    );
  }
}

function parseAttemptId(value: string | undefined): string {
  const attemptId = value?.trim() || randomUUID();

  if (!uuidPattern.test(attemptId)) {
    throw new InvitationDeliveryAttemptError(
      "invalid_payload",
      "Invitation delivery attempt ID must be a UUID."
    );
  }

  return attemptId;
}

function parseInvitationId(value: string): string {
  const invitationId = value.trim();

  if (!uuidPattern.test(invitationId)) {
    throw new InvitationDeliveryAttemptError(
      "invalid_payload",
      "Invitation ID must be a UUID."
    );
  }

  return invitationId;
}

function parseProviderName(value: string): string {
  try {
    return parseInvitationEmailProviderName(value);
  } catch (error) {
    if (error instanceof InvitationEmailDeliveryError) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Invitation delivery provider is invalid."
      );
    }

    throw error;
  }
}

function parseProviderMessageId(value: unknown): string {
  try {
    return parseInvitationEmailProviderMessageId(value);
  } catch (error) {
    if (error instanceof InvitationEmailDeliveryError) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Invitation provider message ID is invalid."
      );
    }

    throw error;
  }
}

function parseFailureCode(value: string): string {
  const failureCode = value.trim();

  if (!/^[a-z][a-z0-9_]{0,79}$/.test(failureCode)) {
    throw new InvitationDeliveryAttemptError(
      "invalid_payload",
      "Invitation delivery failure code is invalid."
    );
  }

  return failureCode;
}

function assertValidDate(value: Date, message: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new InvitationDeliveryAttemptError("invalid_payload", message);
  }
}

function assertDeliveryScope(input: {
  session: AuthSession;
  delivery: PublicInvitationDeliveryPlan;
  now: Date;
}): void {
  parseInvitationId(input.delivery.invitationId);

  if (input.delivery.organizationId !== input.session.organizationId) {
    throw new InvitationDeliveryAttemptError(
      "cross_scope",
      "Invitation delivery organization must match the current session."
    );
  }

  assertValidDate(input.now, "Attempt preparation time is invalid.");
  assertValidDate(
    input.delivery.deliveryExpiresAt,
    "Invitation delivery expiration is invalid."
  );
  assertValidDate(
    input.delivery.invitationExpiresAt,
    "Invitation expiration is invalid."
  );

  if (
    input.delivery.status !== "pending" ||
    input.delivery.tokenExposure !== "not_exposed" ||
    input.delivery.deliveryExpiresAt.getTime() <= input.now.getTime() ||
    input.delivery.deliveryExpiresAt.getTime() >
      input.delivery.invitationExpiresAt.getTime()
  ) {
    throw new InvitationDeliveryAttemptError(
      "invalid_payload",
      "Invitation delivery plan is not eligible for attempt persistence."
    );
  }
}

function boundedLimit(value: number | undefined): number {
  return Math.min(100, Math.max(1, Math.floor(value ?? 50)));
}

function createAttemptAuditEvent(input: {
  session: AuthSession;
  attempt: PersistedInvitationDeliveryAttempt;
  action:
    | "invitation.delivery_attempt_prepared"
    | "invitation.delivery_attempt_existing"
    | "invitation.delivery_attempt_provider_accepted"
    | "invitation.delivery_attempt_provider_failed";
  previousStatus?: InvitationDeliveryAttemptStatus;
}): typeof auditEvents.$inferInsert {
  return {
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action: input.action,
    resourceType: "organization",
    resourceId: input.session.organizationId,
    metadata: {
      attemptId: input.attempt.id,
      invitationId: input.attempt.invitationId,
      provider: input.attempt.provider,
      previousStatus: input.previousStatus,
      nextStatus: input.attempt.status,
      providerMessageId: input.attempt.providerMessageId,
      failureCode: input.attempt.failureCode,
      deliveryExpiresAt: input.attempt.deliveryExpiresAt.toISOString(),
      preparedAt: input.attempt.preparedAt.toISOString(),
      providerAcceptedAt: input.attempt.providerAcceptedAt?.toISOString(),
      providerFailedAt: input.attempt.providerFailedAt?.toISOString(),
      deliveryClaim: "provider_status_only",
      tokenExposure: "not_exposed"
    }
  };
}

export async function persistInvitationDeliveryAttempt(
  db: Database,
  input: {
    session: AuthSession;
    delivery: PublicInvitationDeliveryPlan;
    provider: string;
    attemptId?: string;
    now?: Date;
  }
): Promise<InvitationDeliveryAttemptPersistenceResult> {
  assertManager(input.session);

  const preparedAt = input.now ?? new Date();
  const attemptId = parseAttemptId(input.attemptId);
  const provider = parseProviderName(input.provider);
  assertDeliveryScope({
    session: input.session,
    delivery: input.delivery,
    now: preparedAt
  });

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select(invitationSelection)
      .from(invitations)
      .where(
        and(
          eq(invitations.id, input.delivery.invitationId),
          eq(invitations.organizationId, input.session.organizationId)
        )
      )
      .limit(1);

    if (!invitation) {
      throw new InvitationDeliveryAttemptError(
        "not_found",
        "Invitation was not found."
      );
    }

    if (
      invitation.status !== "pending" ||
      invitation.expiresAt.getTime() <= preparedAt.getTime()
    ) {
      throw new InvitationDeliveryAttemptError(
        "invalid_state",
        "Invitation is not eligible for delivery attempt persistence."
      );
    }

    if (
      invitation.email !== input.delivery.email ||
      invitation.role !== input.delivery.role ||
      invitation.expiresAt.getTime() !==
        input.delivery.invitationExpiresAt.getTime()
    ) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Invitation delivery plan does not match the persisted invitation."
      );
    }

    const [inserted] = await tx
      .insert(invitationDeliveryAttempts)
      .values({
        id: attemptId,
        organizationId: input.session.organizationId,
        invitationId: invitation.id,
        provider,
        status: "prepared",
        deliveryExpiresAt: input.delivery.deliveryExpiresAt,
        preparedAt,
        createdBy: input.session.userId,
        createdAt: preparedAt,
        updatedAt: preparedAt
      })
      .onConflictDoNothing({
        target: invitationDeliveryAttempts.id
      })
      .returning(attemptSelection);

    const mode: InvitationDeliveryAttemptPersistenceMode = inserted
      ? "created"
      : "existing";
    const attempt =
      inserted ??
      (
        await tx
          .select(attemptSelection)
          .from(invitationDeliveryAttempts)
          .where(
            and(
              eq(invitationDeliveryAttempts.id, attemptId),
              eq(
                invitationDeliveryAttempts.organizationId,
                input.session.organizationId
              )
            )
          )
          .limit(1)
      )[0];

    if (!attempt) {
      throw new InvitationDeliveryAttemptError(
        "not_found",
        "Invitation delivery attempt was not found."
      );
    }

    if (
      attempt.invitationId !== invitation.id ||
      attempt.provider !== provider
    ) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Existing invitation delivery attempt does not match the request."
      );
    }

    const auditEvent = createAttemptAuditEvent({
      session: input.session,
      attempt,
      action:
        mode === "created"
          ? "invitation.delivery_attempt_prepared"
          : "invitation.delivery_attempt_existing"
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      mode,
      attempt,
      auditEvent
    };
  });
}

export async function markInvitationDeliveryAttemptProviderAccepted(
  db: Database,
  input: {
    session: AuthSession;
    attemptId: string;
    receipt: PublicInvitationEmailReceipt;
  }
): Promise<InvitationDeliveryAttemptTransitionResult> {
  assertManager(input.session);

  const attemptId = parseAttemptId(input.attemptId);
  const provider = parseProviderName(input.receipt.provider);
  const providerMessageId = parseProviderMessageId(
    input.receipt.providerMessageId
  );
  assertValidDate(
    input.receipt.acceptedAt,
    "Provider acceptance time is invalid."
  );

  if (
    input.receipt.status !== "accepted_by_provider" ||
    input.receipt.tokenExposure !== "not_exposed"
  ) {
    throw new InvitationDeliveryAttemptError(
      "invalid_payload",
      "Invitation provider receipt is invalid."
    );
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(attemptSelection)
      .from(invitationDeliveryAttempts)
      .where(
        and(
          eq(invitationDeliveryAttempts.id, attemptId),
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          )
        )
      )
      .limit(1);

    if (!current) {
      throw new InvitationDeliveryAttemptError(
        "not_found",
        "Invitation delivery attempt was not found."
      );
    }

    if (current.status !== "prepared") {
      throw new InvitationDeliveryAttemptError(
        "invalid_state",
        "Invitation delivery attempt is already terminal."
      );
    }

    if (
      current.id !== input.receipt.deliveryAttemptId ||
      current.invitationId !== input.receipt.invitationId ||
      current.provider !== provider ||
      !isValidInvitationEmail(input.receipt.recipient) ||
      input.receipt.acceptedAt.getTime() < current.preparedAt.getTime() ||
      input.receipt.acceptedAt.getTime() > current.deliveryExpiresAt.getTime()
    ) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Invitation provider receipt does not match the prepared attempt."
      );
    }

    const [invitation] = await tx
      .select({
        id: invitations.id,
        email: invitations.email
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, current.invitationId),
          eq(invitations.organizationId, input.session.organizationId)
        )
      )
      .limit(1);

    if (!invitation) {
      throw new InvitationDeliveryAttemptError(
        "not_found",
        "Invitation was not found."
      );
    }

    if (invitation.email !== input.receipt.recipient) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Invitation provider receipt recipient does not match the invitation."
      );
    }

    const [attempt] = await tx
      .update(invitationDeliveryAttempts)
      .set({
        status: "accepted_by_provider",
        providerMessageId,
        providerAcceptedAt: input.receipt.acceptedAt,
        updatedAt: input.receipt.acceptedAt
      })
      .where(
        and(
          eq(invitationDeliveryAttempts.id, current.id),
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          ),
          eq(invitationDeliveryAttempts.status, "prepared")
        )
      )
      .returning(attemptSelection);

    if (!attempt) {
      throw new InvitationDeliveryAttemptError(
        "invalid_state",
        "Invitation delivery attempt changed concurrently."
      );
    }

    const auditEvent = createAttemptAuditEvent({
      session: input.session,
      attempt,
      action: "invitation.delivery_attempt_provider_accepted",
      previousStatus: "prepared"
    });

    await tx.insert(auditEvents).values(auditEvent);

    return { attempt, auditEvent };
  });
}

export async function markInvitationDeliveryAttemptProviderFailed(
  db: Database,
  input: {
    session: AuthSession;
    attemptId: string;
    failureCode: string;
    failedAt?: Date;
  }
): Promise<InvitationDeliveryAttemptTransitionResult> {
  assertManager(input.session);

  const attemptId = parseAttemptId(input.attemptId);
  const failureCode = parseFailureCode(input.failureCode);
  const providerFailedAt = input.failedAt ?? new Date();
  assertValidDate(providerFailedAt, "Provider failure time is invalid.");

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(attemptSelection)
      .from(invitationDeliveryAttempts)
      .where(
        and(
          eq(invitationDeliveryAttempts.id, attemptId),
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          )
        )
      )
      .limit(1);

    if (!current) {
      throw new InvitationDeliveryAttemptError(
        "not_found",
        "Invitation delivery attempt was not found."
      );
    }

    if (current.status !== "prepared") {
      throw new InvitationDeliveryAttemptError(
        "invalid_state",
        "Invitation delivery attempt is already terminal."
      );
    }

    if (providerFailedAt.getTime() < current.preparedAt.getTime()) {
      throw new InvitationDeliveryAttemptError(
        "invalid_payload",
        "Provider failure time precedes attempt preparation."
      );
    }

    const [attempt] = await tx
      .update(invitationDeliveryAttempts)
      .set({
        status: "provider_failed",
        failureCode,
        providerFailedAt,
        updatedAt: providerFailedAt
      })
      .where(
        and(
          eq(invitationDeliveryAttempts.id, current.id),
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          ),
          eq(invitationDeliveryAttempts.status, "prepared")
        )
      )
      .returning(attemptSelection);

    if (!attempt) {
      throw new InvitationDeliveryAttemptError(
        "invalid_state",
        "Invitation delivery attempt changed concurrently."
      );
    }

    const auditEvent = createAttemptAuditEvent({
      session: input.session,
      attempt,
      action: "invitation.delivery_attempt_provider_failed",
      previousStatus: "prepared"
    });

    await tx.insert(auditEvents).values(auditEvent);

    return { attempt, auditEvent };
  });
}

export async function listOrganizationInvitationDeliveryAttempts(
  db: Database,
  input: {
    session: AuthSession;
    invitationId?: string;
    limit?: number;
  }
): Promise<PersistedInvitationDeliveryAttempt[]> {
  assertManager(input.session);

  const invitationId = input.invitationId
    ? parseInvitationId(input.invitationId)
    : undefined;

  const condition = invitationId
    ? and(
        eq(
          invitationDeliveryAttempts.organizationId,
          input.session.organizationId
        ),
        eq(invitationDeliveryAttempts.invitationId, invitationId)
      )
    : eq(
        invitationDeliveryAttempts.organizationId,
        input.session.organizationId
      );

  return db
    .select(attemptSelection)
    .from(invitationDeliveryAttempts)
    .where(condition)
    .orderBy(desc(invitationDeliveryAttempts.createdAt))
    .limit(boundedLimit(input.limit));
}

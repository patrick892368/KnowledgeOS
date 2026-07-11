import { and, eq, isNull } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import type { InvitationDeliveryAttemptStatus } from "@/db/model";
import { canPlanInvitations } from "@/invitations/lifecycle";

import type { Database } from "./client";
import {
  auditEvents,
  invitationDeliveryAttempts,
  invitationDeliveryEvidence
} from "./schema";

export type InvitationDeliveryReconciliationMode = "reconciled" | "existing";
export type InvitationDeliveryReconciliationErrorCode =
  | "forbidden"
  | "invalid_payload"
  | "not_found"
  | "invalid_state";

export class InvitationDeliveryReconciliationError extends Error {
  constructor(
    public readonly code: InvitationDeliveryReconciliationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvitationDeliveryReconciliationError";
  }
}

export interface ReconciledInvitationDeliveryAttempt {
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

export interface ReconciliationInvitationDeliveryEvidence {
  id: string;
  organizationId: string;
  invitationId: string;
  deliveryAttemptId: string;
  provider: string;
  providerEventId: string;
  providerEventType: string;
  evidenceType:
    | "sent_by_provider"
    | "delivered_to_recipient_server"
    | "delivery_delayed"
    | "bounced"
    | "delivery_failed"
    | "suppressed"
    | "complained";
  providerMessageId: string;
  occurredAt: Date;
  receivedAt: Date;
}

export interface InvitationDeliveryReconciliationResult {
  mode: InvitationDeliveryReconciliationMode;
  attempt: ReconciledInvitationDeliveryAttempt;
  evidence: ReconciliationInvitationDeliveryEvidence;
  auditEvent: typeof auditEvents.$inferInsert | null;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
const evidenceSelection = {
  id: invitationDeliveryEvidence.id,
  organizationId: invitationDeliveryEvidence.organizationId,
  invitationId: invitationDeliveryEvidence.invitationId,
  deliveryAttemptId: invitationDeliveryEvidence.deliveryAttemptId,
  provider: invitationDeliveryEvidence.provider,
  providerEventId: invitationDeliveryEvidence.providerEventId,
  providerEventType: invitationDeliveryEvidence.providerEventType,
  evidenceType: invitationDeliveryEvidence.evidenceType,
  providerMessageId: invitationDeliveryEvidence.providerMessageId,
  occurredAt: invitationDeliveryEvidence.occurredAt,
  receivedAt: invitationDeliveryEvidence.receivedAt
};

function reconciliationError(
  code: InvitationDeliveryReconciliationErrorCode,
  message: string
): never {
  throw new InvitationDeliveryReconciliationError(code, message);
}

function assertManager(session: AuthSession): void {
  if (!canPlanInvitations(session.role)) {
    reconciliationError(
      "forbidden",
      "Only owner or admin members can reconcile invitation delivery."
    );
  }
}

function parseUuid(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";

  if (!uuidPattern.test(candidate)) {
    return reconciliationError(
      "invalid_payload",
      "Invitation delivery reconciliation identity is invalid."
    );
  }

  return candidate;
}

function parseDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return reconciliationError(
      "invalid_payload",
      "Invitation delivery reconciliation time is invalid."
    );
  }

  return new Date(value.getTime());
}

function evidenceMatchesAttempt(
  evidence: ReconciliationInvitationDeliveryEvidence,
  attempt: ReconciledInvitationDeliveryAttempt
): boolean {
  return (
    evidence.organizationId === attempt.organizationId &&
    evidence.invitationId === attempt.invitationId &&
    evidence.deliveryAttemptId === attempt.id &&
    evidence.provider === attempt.provider &&
    evidence.occurredAt.getTime() >= attempt.preparedAt.getTime() - 300_000
  );
}

function createReconciliationAuditEvent(input: {
  session: AuthSession;
  attempt: ReconciledInvitationDeliveryAttempt;
  evidence: ReconciliationInvitationDeliveryEvidence;
}): typeof auditEvents.$inferInsert {
  return {
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action: "invitation.delivery_attempt_reconciled_provider_accepted",
    resourceType: "organization",
    resourceId: input.session.organizationId,
    metadata: {
      attemptId: input.attempt.id,
      invitationId: input.attempt.invitationId,
      evidenceId: input.evidence.id,
      provider: input.attempt.provider,
      providerEventType: input.evidence.providerEventType,
      evidenceType: input.evidence.evidenceType,
      previousStatus: "prepared",
      nextStatus: "accepted_by_provider",
      providerMessageId: input.attempt.providerMessageId,
      providerAcceptedAt: input.attempt.providerAcceptedAt?.toISOString(),
      deliveryClaim: "provider_status_only",
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    }
  };
}

export async function reconcileInvitationDeliveryAttemptFromEvidence(
  db: Database,
  input: {
    session: AuthSession;
    attemptId: string;
    evidenceId: string;
    reconciledAt?: Date;
  }
): Promise<InvitationDeliveryReconciliationResult> {
  assertManager(input.session);
  const attemptId = parseUuid(input.attemptId);
  const evidenceId = parseUuid(input.evidenceId);
  const reconciledAt = parseDate(input.reconciledAt ?? new Date());

  return db.transaction(async (tx) => {
    const [evidence] = await tx
      .select(evidenceSelection)
      .from(invitationDeliveryEvidence)
      .where(
        and(
          eq(invitationDeliveryEvidence.id, evidenceId),
          eq(
            invitationDeliveryEvidence.organizationId,
            input.session.organizationId
          ),
          eq(invitationDeliveryEvidence.deliveryAttemptId, attemptId)
        )
      )
      .limit(1);

    if (!evidence) {
      return reconciliationError(
        "not_found",
        "Invitation delivery evidence was not found."
      );
    }

    const [attempt] = await tx
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

    if (!attempt || !evidenceMatchesAttempt(evidence, attempt)) {
      return reconciliationError(
        "not_found",
        "Invitation delivery reconciliation was not found."
      );
    }

    if (attempt.status === "accepted_by_provider") {
      if (attempt.providerMessageId !== evidence.providerMessageId) {
        return reconciliationError(
          "invalid_state",
          "Invitation delivery reconciliation conflicts with Provider state."
        );
      }

      return { mode: "existing", attempt, evidence, auditEvent: null };
    }

    if (
      attempt.status !== "prepared" ||
      attempt.providerMessageId !== null ||
      attempt.failureCode !== null ||
      attempt.providerAcceptedAt !== null ||
      attempt.providerFailedAt !== null
    ) {
      return reconciliationError(
        "invalid_state",
        "Invitation delivery attempt cannot be reconciled."
      );
    }

    const updatedAt =
      reconciledAt.getTime() >= evidence.occurredAt.getTime()
        ? reconciledAt
        : new Date(evidence.occurredAt.getTime());
    const [reconciledAttempt] = await tx
      .update(invitationDeliveryAttempts)
      .set({
        status: "accepted_by_provider",
        providerMessageId: evidence.providerMessageId,
        providerAcceptedAt: evidence.occurredAt,
        updatedAt
      })
      .where(
        and(
          eq(invitationDeliveryAttempts.id, attempt.id),
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          ),
          eq(invitationDeliveryAttempts.status, "prepared"),
          isNull(invitationDeliveryAttempts.providerMessageId)
        )
      )
      .returning(attemptSelection);

    if (!reconciledAttempt) {
      const [concurrentAttempt] = await tx
        .select(attemptSelection)
        .from(invitationDeliveryAttempts)
        .where(
          and(
            eq(invitationDeliveryAttempts.id, attempt.id),
            eq(
              invitationDeliveryAttempts.organizationId,
              input.session.organizationId
            )
          )
        )
        .limit(1);

      if (
        concurrentAttempt?.status === "accepted_by_provider" &&
        concurrentAttempt.providerMessageId === evidence.providerMessageId
      ) {
        return {
          mode: "existing",
          attempt: concurrentAttempt,
          evidence,
          auditEvent: null
        };
      }

      return reconciliationError(
        "invalid_state",
        "Invitation delivery attempt changed concurrently."
      );
    }

    const auditEvent = createReconciliationAuditEvent({
      session: input.session,
      attempt: reconciledAttempt,
      evidence
    });
    await tx.insert(auditEvents).values(auditEvent);

    return {
      mode: "reconciled",
      attempt: reconciledAttempt,
      evidence,
      auditEvent
    };
  });
}

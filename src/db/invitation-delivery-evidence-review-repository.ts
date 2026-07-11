import { and, desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import { canPlanInvitations } from "@/invitations/lifecycle";

import type { Database } from "./client";
import type { PersistedInvitationDeliveryEvidence } from "./invitation-delivery-evidence-repository";
import {
  invitationDeliveryAttempts,
  invitationDeliveryEvidence
} from "./schema";

export type InvitationDeliveryEvidenceReviewErrorCode =
  | "forbidden"
  | "invalid_payload";

export class InvitationDeliveryEvidenceReviewError extends Error {
  constructor(
    public readonly code: InvitationDeliveryEvidenceReviewErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvitationDeliveryEvidenceReviewError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function reviewError(
  code: InvitationDeliveryEvidenceReviewErrorCode,
  message: string
): never {
  throw new InvitationDeliveryEvidenceReviewError(code, message);
}

function assertManager(session: AuthSession): void {
  if (!canPlanInvitations(session.role)) {
    reviewError(
      "forbidden",
      "Only owner or admin members can review invitation delivery evidence."
    );
  }
}

function parseAttemptId(value: string): string {
  const attemptId = value.trim();

  if (!uuidPattern.test(attemptId)) {
    return reviewError(
      "invalid_payload",
      "Invitation delivery attempt ID must be a UUID."
    );
  }

  return attemptId;
}

function parseLimit(value: number | undefined): number {
  const limit = value ?? 50;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return reviewError(
      "invalid_payload",
      "Invitation delivery evidence limit must be between 1 and 100."
    );
  }

  return limit;
}

export async function listOrganizationInvitationDeliveryEvidence(
  db: Database,
  input: {
    session: AuthSession;
    attemptId: string;
    limit?: number;
  }
): Promise<PersistedInvitationDeliveryEvidence[]> {
  assertManager(input.session);
  const attemptId = parseAttemptId(input.attemptId);
  const limit = parseLimit(input.limit);

  return db
    .select(evidenceSelection)
    .from(invitationDeliveryEvidence)
    .innerJoin(
      invitationDeliveryAttempts,
      and(
        eq(
          invitationDeliveryEvidence.deliveryAttemptId,
          invitationDeliveryAttempts.id
        ),
        eq(
          invitationDeliveryEvidence.organizationId,
          invitationDeliveryAttempts.organizationId
        ),
        eq(
          invitationDeliveryEvidence.invitationId,
          invitationDeliveryAttempts.invitationId
        ),
        eq(
          invitationDeliveryEvidence.provider,
          invitationDeliveryAttempts.provider
        )
      )
    )
    .where(
      and(
        eq(
          invitationDeliveryAttempts.organizationId,
          input.session.organizationId
        ),
        eq(invitationDeliveryAttempts.id, attemptId)
      )
    )
    .orderBy(
      desc(invitationDeliveryEvidence.occurredAt),
      desc(invitationDeliveryEvidence.receivedAt),
      desc(invitationDeliveryEvidence.id)
    )
    .limit(limit);
}

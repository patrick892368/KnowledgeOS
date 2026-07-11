import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  invitationProviderEvidenceTypes,
  type InvitationProviderEvidenceType
} from "@/db/model";
import { parseInvitationEmailProviderMessageId } from "@/invitations/email-provider.server";
import type { VerifiedInvitationProviderEvidence } from "@/invitations/provider-webhook.server";

import type { Database } from "./client";
import {
  invitationDeliveryAttempts,
  invitationDeliveryEvidence
} from "./schema";

export type InvitationDeliveryEvidencePersistenceMode = "created" | "existing";
export type InvitationDeliveryEvidenceErrorCode =
  | "invalid_payload"
  | "not_found"
  | "invalid_state";

export class InvitationDeliveryEvidenceError extends Error {
  constructor(
    public readonly code: InvitationDeliveryEvidenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvitationDeliveryEvidenceError";
  }
}

export interface PersistedInvitationDeliveryEvidence {
  id: string;
  organizationId: string;
  invitationId: string;
  deliveryAttemptId: string;
  provider: string;
  providerEventId: string;
  providerEventType: string;
  evidenceType: InvitationProviderEvidenceType;
  providerMessageId: string;
  occurredAt: Date;
  receivedAt: Date;
}

export interface InvitationDeliveryEvidencePersistenceResult {
  mode: InvitationDeliveryEvidencePersistenceMode;
  evidence: PersistedInvitationDeliveryEvidence;
}

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
const attemptSelection = {
  id: invitationDeliveryAttempts.id,
  organizationId: invitationDeliveryAttempts.organizationId,
  invitationId: invitationDeliveryAttempts.invitationId,
  provider: invitationDeliveryAttempts.provider,
  status: invitationDeliveryAttempts.status,
  providerMessageId: invitationDeliveryAttempts.providerMessageId
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const eventTypePattern = /^email\.[a-z_]{1,56}$/;
const eventEvidence = {
  "email.sent": "sent_by_provider",
  "email.delivered": "delivered_to_recipient_server",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.failed": "delivery_failed",
  "email.suppressed": "suppressed",
  "email.complained": "complained"
} as const satisfies Record<string, InvitationProviderEvidenceType>;

function evidenceError(
  code: InvitationDeliveryEvidenceErrorCode,
  message: string
): never {
  throw new InvitationDeliveryEvidenceError(code, message);
}

function parseString(
  value: unknown,
  options: { maximumLength: number; pattern?: RegExp }
): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  const containsControlCharacter = Array.from(candidate).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !candidate ||
    candidate.length > options.maximumLength ||
    containsControlCharacter ||
    (options.pattern && !options.pattern.test(candidate))
  ) {
    return evidenceError(
      "invalid_payload",
      "Invitation delivery evidence is invalid."
    );
  }

  return candidate;
}

function parseUuid(value: unknown): string {
  return parseString(value, { maximumLength: 36, pattern: uuidPattern });
}

function parseDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return evidenceError(
      "invalid_payload",
      "Invitation delivery evidence is invalid."
    );
  }

  return new Date(value.getTime());
}

function normalizeEvidence(
  evidence: VerifiedInvitationProviderEvidence
): VerifiedInvitationProviderEvidence {
  if (
    evidence.provider !== "resend" ||
    evidence.signatureVerified !== true ||
    evidence.inboxDeliveryClaim !== "not_claimed" ||
    evidence.tokenExposure !== "not_exposed"
  ) {
    return evidenceError(
      "invalid_payload",
      "Invitation delivery evidence is not verified."
    );
  }

  const providerEventType = parseString(evidence.providerEventType, {
    maximumLength: 64,
    pattern: eventTypePattern
  });
  const evidenceType = evidence.evidenceType;

  if (
    !Object.hasOwn(eventEvidence, providerEventType) ||
    eventEvidence[providerEventType as keyof typeof eventEvidence] !==
      evidenceType ||
    !invitationProviderEvidenceTypes.includes(evidenceType)
  ) {
    return evidenceError(
      "invalid_payload",
      "Invitation delivery evidence type is invalid."
    );
  }

  let providerMessageId: string;

  try {
    providerMessageId = parseInvitationEmailProviderMessageId(
      evidence.providerMessageId
    );
  } catch {
    return evidenceError(
      "invalid_payload",
      "Invitation delivery evidence is invalid."
    );
  }

  return Object.freeze({
    provider: "resend",
    providerEventId: parseString(evidence.providerEventId, {
      maximumLength: 128,
      pattern: eventIdPattern
    }),
    providerEventType:
      providerEventType as VerifiedInvitationProviderEvidence["providerEventType"],
    evidenceType,
    deliveryAttemptId: parseUuid(evidence.deliveryAttemptId),
    providerMessageId,
    occurredAt: parseDate(evidence.occurredAt),
    signatureVerified: true,
    inboxDeliveryClaim: "not_claimed",
    tokenExposure: "not_exposed"
  });
}

function assertSameEvidence(
  existing: PersistedInvitationDeliveryEvidence,
  evidence: VerifiedInvitationProviderEvidence
): void {
  if (
    existing.deliveryAttemptId !== evidence.deliveryAttemptId ||
    existing.provider !== evidence.provider ||
    existing.providerEventId !== evidence.providerEventId ||
    existing.providerEventType !== evidence.providerEventType ||
    existing.evidenceType !== evidence.evidenceType ||
    existing.providerMessageId !== evidence.providerMessageId ||
    existing.occurredAt.getTime() !== evidence.occurredAt.getTime()
  ) {
    evidenceError(
      "invalid_state",
      "Invitation delivery evidence event identity conflicts with persistence."
    );
  }
}

export async function persistVerifiedInvitationDeliveryEvidence(
  db: Database,
  input: {
    evidence: VerifiedInvitationProviderEvidence;
    receivedAt?: Date;
  }
): Promise<InvitationDeliveryEvidencePersistenceResult> {
  const evidence = normalizeEvidence(input.evidence);
  const receivedAt = parseDate(input.receivedAt ?? new Date());

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select(evidenceSelection)
      .from(invitationDeliveryEvidence)
      .where(
        and(
          eq(invitationDeliveryEvidence.provider, evidence.provider),
          eq(
            invitationDeliveryEvidence.providerEventId,
            evidence.providerEventId
          )
        )
      )
      .limit(1);

    if (existing) {
      assertSameEvidence(existing, evidence);
      return { mode: "existing", evidence: existing };
    }

    const [attempt] = await tx
      .select(attemptSelection)
      .from(invitationDeliveryAttempts)
      .where(
        and(
          eq(invitationDeliveryAttempts.id, evidence.deliveryAttemptId),
          eq(invitationDeliveryAttempts.provider, evidence.provider),
          eq(
            invitationDeliveryAttempts.providerMessageId,
            evidence.providerMessageId
          )
        )
      )
      .limit(1);

    if (!attempt) {
      return evidenceError(
        "not_found",
        "Invitation delivery attempt correlation was not found."
      );
    }

    if (
      attempt.id !== evidence.deliveryAttemptId ||
      attempt.provider !== evidence.provider ||
      attempt.status !== "accepted_by_provider" ||
      attempt.providerMessageId !== evidence.providerMessageId
    ) {
      return evidenceError(
        "invalid_state",
        "Invitation delivery attempt cannot accept Provider evidence."
      );
    }

    const values = {
      id: randomUUID(),
      organizationId: attempt.organizationId,
      invitationId: attempt.invitationId,
      deliveryAttemptId: attempt.id,
      provider: evidence.provider,
      providerEventId: evidence.providerEventId,
      providerEventType: evidence.providerEventType,
      evidenceType: evidence.evidenceType,
      providerMessageId: evidence.providerMessageId,
      occurredAt: evidence.occurredAt,
      receivedAt
    };
    const [created] = await tx
      .insert(invitationDeliveryEvidence)
      .values(values)
      .onConflictDoNothing()
      .returning(evidenceSelection);

    if (created) {
      return { mode: "created", evidence: created };
    }

    const [concurrentExisting] = await tx
      .select(evidenceSelection)
      .from(invitationDeliveryEvidence)
      .where(
        and(
          eq(invitationDeliveryEvidence.provider, evidence.provider),
          eq(
            invitationDeliveryEvidence.providerEventId,
            evidence.providerEventId
          )
        )
      )
      .limit(1);

    if (!concurrentExisting) {
      return evidenceError(
        "invalid_state",
        "Invitation delivery evidence persistence changed concurrently."
      );
    }

    assertSameEvidence(concurrentExisting, evidence);
    return { mode: "existing", evidence: concurrentExisting };
  });
}

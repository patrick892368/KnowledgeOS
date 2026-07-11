import { and, count, desc, eq, gte, ne } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import { canPlanInvitations } from "@/invitations/lifecycle";

import type { Database } from "./client";
import { invitationDeliveryAttempts } from "./schema";

export type InvitationDispatchPolicyRepositoryErrorCode =
  | "forbidden"
  | "invalid_payload";

export class InvitationDispatchPolicyRepositoryError extends Error {
  constructor(
    public readonly code: InvitationDispatchPolicyRepositoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvitationDispatchPolicyRepositoryError";
  }
}

export interface InvitationDispatchPolicyHistory {
  latestInvitationAttemptPreparedAt: Date | null;
  organizationAttemptCount: number;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidPayload(message: string): never {
  throw new InvitationDispatchPolicyRepositoryError(
    "invalid_payload",
    message
  );
}

function parseUuid(value: string, label: string): string {
  const id = value.trim();
  return uuidPattern.test(id) ? id : invalidPayload(`${label} must be a UUID.`);
}

function parseBoundary(value: Date, label: string): Date {
  return Number.isFinite(value.getTime())
    ? value
    : invalidPayload(`${label} is invalid.`);
}

export async function readInvitationDispatchPolicyHistory(
  db: Database,
  input: {
    session: AuthSession;
    invitationId: string;
    currentAttemptId: string;
    cooldownSince: Date;
    rateLimitSince: Date;
  }
): Promise<InvitationDispatchPolicyHistory> {
  if (!canPlanInvitations(input.session.role)) {
    throw new InvitationDispatchPolicyRepositoryError(
      "forbidden",
      "Only owner or admin members can review invitation dispatch policy."
    );
  }

  const invitationId = parseUuid(input.invitationId, "Invitation ID");
  const currentAttemptId = parseUuid(
    input.currentAttemptId,
    "Invitation delivery attempt ID"
  );
  const cooldownSince = parseBoundary(
    input.cooldownSince,
    "Invitation cooldown boundary"
  );
  const rateLimitSince = parseBoundary(
    input.rateLimitSince,
    "Organization rate-limit boundary"
  );

  const [latestInvitationAttempts, organizationCounts] = await Promise.all([
    db
      .select({ preparedAt: invitationDeliveryAttempts.preparedAt })
      .from(invitationDeliveryAttempts)
      .where(
        and(
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          ),
          eq(invitationDeliveryAttempts.invitationId, invitationId),
          ne(invitationDeliveryAttempts.id, currentAttemptId),
          gte(invitationDeliveryAttempts.createdAt, cooldownSince)
        )
      )
      .orderBy(desc(invitationDeliveryAttempts.createdAt))
      .limit(1),
    db
      .select({ attemptCount: count() })
      .from(invitationDeliveryAttempts)
      .where(
        and(
          eq(
            invitationDeliveryAttempts.organizationId,
            input.session.organizationId
          ),
          ne(invitationDeliveryAttempts.id, currentAttemptId),
          gte(invitationDeliveryAttempts.createdAt, rateLimitSince)
        )
      )
  ]);
  const organizationAttemptCount = Number(
    organizationCounts[0]?.attemptCount ?? 0
  );

  if (
    !Number.isSafeInteger(organizationAttemptCount) ||
    organizationAttemptCount < 0
  ) {
    return invalidPayload("Organization attempt count is invalid.");
  }

  return {
    latestInvitationAttemptPreparedAt:
      latestInvitationAttempts[0]?.preparedAt ?? null,
    organizationAttemptCount
  };
}

import { createHash, randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import type { InvitationStatus, MembershipRole } from "@/db/model";
import {
  createInvitationPlan,
  type InvitationPlan,
  type InvitationPlanPayload
} from "@/invitations/lifecycle";

import type { Database } from "./client";
import { auditEvents, invitations } from "./schema";

export type InvitationPersistenceMode = "created" | "existing";

export interface PersistedInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
}

export interface InvitationPersistenceResult {
  mode: InvitationPersistenceMode;
  invitation: PersistedInvitation;
  auditIntent: typeof auditEvents.$inferInsert;
  auditEvent: typeof auditEvents.$inferInsert;
}

const invitationSelection = {
  id: invitations.id,
  organizationId: invitations.organizationId,
  email: invitations.email,
  role: invitations.role,
  status: invitations.status,
  createdAt: invitations.createdAt,
  expiresAt: invitations.expiresAt
};

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createInvitationTokenHash(): string {
  return hashInvitationToken(randomBytes(32).toString("base64url"));
}

export function createInvitationPersistenceAuditEvent(input: {
  plan: InvitationPlan;
  mode: InvitationPersistenceMode;
}): typeof auditEvents.$inferInsert {
  return {
    ...input.plan.auditIntent,
    action:
      input.mode === "created" ? "invitation.created" : "invitation.existing",
    metadata: {
      ...input.plan.auditIntent.metadata,
      invitationId: input.plan.id,
      persistenceMode: input.mode,
      plannedAction: input.plan.auditIntent.action
    }
  };
}

export async function persistInvitation(
  db: Database,
  input: {
    session: AuthSession;
    payload: InvitationPlanPayload;
    now?: Date;
    token?: string;
  }
): Promise<InvitationPersistenceResult> {
  const plan = createInvitationPlan(input);
  const tokenHash = input.token
    ? hashInvitationToken(input.token)
    : createInvitationTokenHash();

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(invitations)
      .values({
        id: plan.id,
        organizationId: plan.organizationId,
        email: plan.email,
        role: plan.role,
        status: plan.status,
        tokenHash,
        invitedBy: input.session.userId,
        expiresAt: plan.expiresAt,
        createdAt: plan.createdAt,
        updatedAt: plan.createdAt
      })
      .onConflictDoNothing({
        target: [
          invitations.organizationId,
          invitations.email,
          invitations.status
        ]
      })
      .returning(invitationSelection);

    const mode: InvitationPersistenceMode = inserted ? "created" : "existing";
    const invitation =
      inserted ??
      (
        await tx
          .select(invitationSelection)
          .from(invitations)
          .where(
            and(
              eq(invitations.organizationId, plan.organizationId),
              eq(invitations.email, plan.email),
              eq(invitations.status, "pending")
            )
          )
          .limit(1)
      )[0];

    if (!invitation) {
      throw new Error("Invitation persistence state could not be resolved.");
    }

    const persistedPlan = {
      ...plan,
      id: invitation.id,
      expiresAt: invitation.expiresAt,
      auditIntent: {
        ...plan.auditIntent,
        metadata: {
          ...plan.auditIntent.metadata,
          invitationId: invitation.id,
          expiresAt: invitation.expiresAt.toISOString()
        }
      }
    };
    const auditEvent = createInvitationPersistenceAuditEvent({
      plan: persistedPlan,
      mode
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      mode,
      invitation,
      auditIntent: persistedPlan.auditIntent,
      auditEvent
    };
  });
}

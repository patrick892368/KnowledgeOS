import { randomBytes } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import type { InvitationStatus, MembershipRole } from "@/db/model";
import {
  canPlanInvitations,
  createInvitationPlan,
  InvitationLifecycleError,
  type InvitationPlan,
  type InvitationPlanPayload
} from "@/invitations/lifecycle";
import { hashInvitationToken } from "@/invitations/tokens";

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
  updatedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface InvitationPersistenceResult {
  mode: InvitationPersistenceMode;
  invitation: PersistedInvitation;
  auditIntent: typeof auditEvents.$inferInsert;
  auditEvent: typeof auditEvents.$inferInsert;
}

export interface InvitationRevocationResult {
  invitation: PersistedInvitation;
  auditEvent: typeof auditEvents.$inferInsert;
}

const invitationSelection = {
  id: invitations.id,
  organizationId: invitations.organizationId,
  email: invitations.email,
  role: invitations.role,
  status: invitations.status,
  createdAt: invitations.createdAt,
  updatedAt: invitations.updatedAt,
  expiresAt: invitations.expiresAt,
  revokedAt: invitations.revokedAt
};

export { hashInvitationToken } from "@/invitations/tokens";

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

export function createInvitationRevocationAuditEvent(input: {
  session: AuthSession;
  invitation: PersistedInvitation;
  now?: Date;
}): typeof auditEvents.$inferInsert {
  const revokedAt = input.now ?? new Date();

  return {
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action: "invitation.revoked",
    resourceType: "organization",
    resourceId: input.session.organizationId,
    metadata: {
      invitationId: input.invitation.id,
      email: input.invitation.email,
      role: input.invitation.role,
      previousStatus: "pending",
      nextStatus: "revoked",
      revokedAt: revokedAt.toISOString()
    }
  };
}

export async function listOrganizationInvitations(
  db: Database,
  session: AuthSession
): Promise<PersistedInvitation[]> {
  if (!canPlanInvitations(session.role)) {
    throw new InvitationLifecycleError(
      "forbidden",
      "Only owner or admin members can manage organization invitations."
    );
  }

  return db
    .select(invitationSelection)
    .from(invitations)
    .where(eq(invitations.organizationId, session.organizationId))
    .orderBy(desc(invitations.createdAt));
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

export async function revokeInvitation(
  db: Database,
  input: {
    session: AuthSession;
    invitationId: string;
    now?: Date;
  }
): Promise<InvitationRevocationResult> {
  if (!canPlanInvitations(input.session.role)) {
    throw new InvitationLifecycleError(
      "forbidden",
      "Only owner or admin members can manage organization invitations."
    );
  }

  const revokedAt = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .update(invitations)
      .set({
        status: "revoked",
        revokedAt,
        updatedAt: revokedAt
      })
      .where(
        and(
          eq(invitations.id, input.invitationId),
          eq(invitations.organizationId, input.session.organizationId),
          eq(invitations.status, "pending")
        )
      )
      .returning(invitationSelection);

    if (!invitation) {
      throw new InvitationLifecycleError(
        "not_found",
        "Pending invitation was not found."
      );
    }

    const auditEvent = createInvitationRevocationAuditEvent({
      session: input.session,
      invitation,
      now: revokedAt
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      invitation,
      auditEvent
    };
  });
}

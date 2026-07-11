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
import {
  createInvitationAcceptancePlan,
  type InvitationAcceptancePayload,
  type InvitationAcceptanceTarget
} from "@/invitations/acceptance";
import {
  createInvitationDeliveryPlan,
  type InvitationDeliveryTarget,
  type PublicInvitationDeliveryPlan
} from "@/invitations/delivery";
import { hashInvitationToken } from "@/invitations/tokens";
import { createBootstrapMembershipId } from "./identity-bootstrap-repository";

import type { Database } from "./client";
import { auditEvents, invitations, memberships, users } from "./schema";

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
  acceptedAt?: Date | null;
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

export interface InvitationResendPreparationResult {
  invitation: PersistedInvitation;
  delivery: PublicInvitationDeliveryPlan;
  auditEvent: typeof auditEvents.$inferInsert;
}

export interface AcceptedInvitationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface AcceptedInvitationUser {
  id: string;
  email: string;
  name: string;
}

export interface InvitationAcceptanceResult {
  invitation: PersistedInvitation;
  membership: AcceptedInvitationMembership;
  user: AcceptedInvitationUser;
  auditEvent: typeof auditEvents.$inferInsert;
  session: Omit<AuthSession, "source">;
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
  acceptedAt: invitations.acceptedAt,
  revokedAt: invitations.revokedAt
};

const invitationAcceptanceSelection = {
  ...invitationSelection,
  tokenHash: invitations.tokenHash
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

export function createInvitationResendAuditEvent(input: {
  session: AuthSession;
  delivery: PublicInvitationDeliveryPlan;
}): typeof auditEvents.$inferInsert {
  return {
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action: "invitation.resend_prepared",
    resourceType: "organization",
    resourceId: input.session.organizationId,
    metadata: {
      ...input.delivery.auditIntent.metadata,
      invitationId: input.delivery.invitationId,
      email: input.delivery.email,
      role: input.delivery.role,
      plannedAction: input.delivery.auditIntent.action,
      deliveryExpiresAt: input.delivery.deliveryExpiresAt.toISOString(),
      invitationExpiresAt: input.delivery.invitationExpiresAt.toISOString(),
      tokenExposure: input.delivery.tokenExposure
    }
  };
}

function createInvitationAcceptanceAuditEvent(input: {
  plan: ReturnType<typeof createInvitationAcceptancePlan>;
  userId: string;
  membershipId: string;
}): typeof auditEvents.$inferInsert {
  return {
    ...input.plan.auditIntent,
    actorUserId: input.userId,
    action: "invitation.accepted",
    metadata: {
      ...input.plan.auditIntent.metadata,
      userId: input.userId,
      membershipId: input.membershipId,
      plannedAction: input.plan.auditIntent.action
    }
  };
}

function toDeliveryTarget(
  invitation: PersistedInvitation
): InvitationDeliveryTarget {
  if (invitation.role === "owner") {
    throw new InvitationLifecycleError(
      "forbidden",
      "Owner invitations require a dedicated owner transfer workflow."
    );
  }

  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt
  };
}

function defaultAcceptedUserName(email: string): string {
  return email.split("@")[0] || email;
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

export async function prepareInvitationResend(
  db: Database,
  input: {
    session: AuthSession;
    invitationId: string;
    now?: Date;
    deliveryTtlHours?: number;
    rawToken?: string;
  }
): Promise<InvitationResendPreparationResult> {
  if (!canPlanInvitations(input.session.role)) {
    throw new InvitationLifecycleError(
      "forbidden",
      "Only owner or admin members can manage organization invitations."
    );
  }

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select(invitationSelection)
      .from(invitations)
      .where(
        and(
          eq(invitations.id, input.invitationId),
          eq(invitations.organizationId, input.session.organizationId)
        )
      )
      .limit(1);

    if (!invitation) {
      throw new InvitationLifecycleError(
        "not_found",
        "Invitation was not found."
      );
    }

    const deliveryPlan = createInvitationDeliveryPlan({
      target: toDeliveryTarget(invitation),
      options: {
        now: input.now,
        deliveryTtlHours: input.deliveryTtlHours,
        rawToken: input.rawToken
      }
    });
    const auditEvent = createInvitationResendAuditEvent({
      session: input.session,
      delivery: deliveryPlan.publicPlan
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      invitation,
      delivery: deliveryPlan.publicPlan,
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

export async function acceptInvitation(
  db: Database,
  input: {
    payload: InvitationAcceptancePayload;
    now?: Date;
  }
): Promise<InvitationAcceptanceResult> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select(invitationAcceptanceSelection)
      .from(invitations)
      .where(eq(invitations.id, input.payload.invitationId))
      .limit(1);

    if (!candidate) {
      throw new InvitationLifecycleError(
        "not_found",
        "Invitation was not found."
      );
    }

    const plan = createInvitationAcceptancePlan({
      payload: input.payload,
      target: candidate as InvitationAcceptanceTarget,
      now: input.now
    });
    const [insertedUser] = await tx
      .insert(users)
      .values({
        email: plan.email,
        name: defaultAcceptedUserName(plan.email),
        metadata: {
          invitationAccepted: true
        }
      })
      .onConflictDoNothing({
        target: users.email
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name
      });
    const user =
      insertedUser ??
      (
        await tx
          .select({
            id: users.id,
            email: users.email,
            name: users.name
          })
          .from(users)
          .where(eq(users.email, plan.email))
          .limit(1)
      )[0];

    if (!user) {
      throw new Error("Invitation acceptance user could not be resolved.");
    }

    const membershipId = createBootstrapMembershipId(
      plan.organizationId,
      user.id
    );
    const [membership] = await tx
      .insert(memberships)
      .values({
        id: membershipId,
        organizationId: plan.organizationId,
        userId: user.id,
        role: plan.role
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: {
          role: plan.role,
          updatedAt: plan.acceptedAt
        }
      })
      .returning({
        id: memberships.id,
        organizationId: memberships.organizationId,
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        updatedAt: memberships.updatedAt
      });

    if (!membership) {
      throw new Error("Invitation acceptance membership could not be resolved.");
    }

    const [invitation] = await tx
      .update(invitations)
      .set({
        status: "accepted",
        acceptedAt: plan.acceptedAt,
        updatedAt: plan.acceptedAt
      })
      .where(
        and(
          eq(invitations.id, plan.invitationId),
          eq(invitations.organizationId, plan.organizationId),
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

    const auditEvent = createInvitationAcceptanceAuditEvent({
      plan,
      userId: user.id,
      membershipId: membership.id
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      invitation,
      membership,
      user,
      auditEvent,
      session: {
        userId: user.id,
        organizationId: plan.organizationId,
        membershipId: membership.id,
        role: membership.role,
        email: user.email,
        name: user.name
      }
    };
  });
}

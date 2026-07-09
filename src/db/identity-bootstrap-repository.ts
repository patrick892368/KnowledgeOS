import type { AuthSession } from "@/auth/session";

import type { Database } from "./client";
import type { MembershipRole } from "./model";
import { deterministicUuid } from "./ids";
import { auditEvents, memberships, organizations, users } from "./schema";

export interface IdentityBootstrapInput {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  userId: string;
  membershipId?: string;
  role: MembershipRole;
  email: string;
  name: string;
}

type BootstrapAuthSession = Omit<AuthSession, "source"> & {
  membershipId: string;
};
type OrganizationInsert = typeof organizations.$inferInsert & { id: string };
type UserInsert = typeof users.$inferInsert & { id: string };
type MembershipInsert = typeof memberships.$inferInsert & { id: string };
type AuditEventInsert = typeof auditEvents.$inferInsert;

export interface IdentityBootstrapPlan {
  organization: OrganizationInsert;
  user: UserInsert;
  membership: MembershipInsert;
  auditEvent: AuditEventInsert;
  session: BootstrapAuthSession;
}

export interface IdentityBootstrapResult {
  mode: "database";
  organizationId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
  session: BootstrapAuthSession;
}

export function createBootstrapMembershipId(
  organizationId: string,
  userId: string
): string {
  return deterministicUuid(
    "knowledgeos.membership",
    `${organizationId}|${userId}`
  );
}

export function createIdentityBootstrapSession(input: {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
  email: string;
  name: string;
}): BootstrapAuthSession {
  return {
    userId: input.userId,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    role: input.role,
    email: input.email,
    name: input.name
  };
}

export function createIdentityBootstrapPlan(
  input: IdentityBootstrapInput
): IdentityBootstrapPlan {
  const membershipId =
    input.membershipId ??
    createBootstrapMembershipId(input.organizationId, input.userId);
  const session = createIdentityBootstrapSession({
    organizationId: input.organizationId,
    userId: input.userId,
    membershipId,
    role: input.role,
    email: input.email,
    name: input.name
  });

  return {
    organization: {
      id: input.organizationId,
      name: input.organizationName,
      slug: input.organizationSlug,
      metadata: {
        bootstrap: true
      }
    },
    user: {
      id: input.userId,
      email: input.email,
      name: input.name,
      metadata: {
        bootstrap: true
      }
    },
    membership: {
      id: membershipId,
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role
    },
    auditEvent: {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "identity.bootstrap_membership",
      resourceType: "organization",
      resourceId: input.organizationId,
      metadata: {
        membershipId,
        role: input.role,
        source: "bootstrap-login"
      }
    },
    session
  };
}

export async function bootstrapIdentityRecords(
  db: Database,
  input: IdentityBootstrapInput
): Promise<IdentityBootstrapResult> {
  return db.transaction(async (tx) => {
    const plan = createIdentityBootstrapPlan(input);
    const [organization] = await tx
      .insert(organizations)
      .values(plan.organization)
      .onConflictDoUpdate({
        target: organizations.slug,
        set: {
          name: plan.organization.name,
          metadata: plan.organization.metadata,
          updatedAt: new Date()
        }
      })
      .returning({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug
      });

    const [user] = await tx
      .insert(users)
      .values(plan.user)
      .onConflictDoUpdate({
        target: users.email,
        set: {
          name: plan.user.name,
          metadata: plan.user.metadata,
          updatedAt: new Date()
        }
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name
      });

    if (!organization || !user) {
      throw new Error("Identity bootstrap did not return organization and user.");
    }

    const membershipInsert = {
      id:
        input.membershipId ??
        createBootstrapMembershipId(organization.id, user.id),
      organizationId: organization.id,
      userId: user.id,
      role: input.role
    } satisfies MembershipInsert;
    const [membership] = await tx
      .insert(memberships)
      .values(membershipInsert)
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: {
          role: input.role,
          updatedAt: new Date()
        }
      })
      .returning({
        id: memberships.id,
        role: memberships.role
      });

    if (!membership) {
      throw new Error("Identity bootstrap did not return membership.");
    }

    await tx.insert(auditEvents).values({
      organizationId: organization.id,
      actorUserId: user.id,
      action: "identity.bootstrap_membership",
      resourceType: "organization",
      resourceId: organization.id,
      metadata: {
        membershipId: membership.id,
        role: membership.role,
        source: "bootstrap-login"
      }
    });

    const session = createIdentityBootstrapSession({
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: membership.role,
      email: user.email,
      name: user.name
    });

    return {
      mode: "database",
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: membership.role,
      session
    };
  });
}

import { and, desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import { canRoleManagePermissionGrants } from "@/db/model";
import {
  createPermissionGrantPlan,
  PermissionGrantManagementError,
  type PermissionGrantPlan,
  type PermissionGrantPlanPayload
} from "@/permissions/grant-management";

import type { Database } from "./client";
import { auditEvents, permissionGrants } from "./schema";

export type PermissionGrantPersistenceMode = "created" | "existing";

export interface PersistedPermissionGrant {
  id: string;
  organizationId: string;
  subjectType: PermissionGrantPlan["subjectType"];
  subjectId: string;
  resourceType: PermissionGrantPlan["resourceType"];
  resourceId: string;
  action: PermissionGrantPlan["action"];
  createdAt: Date;
}

export interface PermissionGrantPersistenceResult {
  mode: PermissionGrantPersistenceMode;
  grant: PersistedPermissionGrant;
  auditIntent: typeof auditEvents.$inferInsert;
  auditEvent: typeof auditEvents.$inferInsert;
}

export interface PermissionGrantRevocationResult {
  grant: PersistedPermissionGrant;
  auditEvent: typeof auditEvents.$inferInsert;
}

const permissionGrantSelection = {
  id: permissionGrants.id,
  organizationId: permissionGrants.organizationId,
  subjectType: permissionGrants.subjectType,
  subjectId: permissionGrants.subjectId,
  resourceType: permissionGrants.resourceType,
  resourceId: permissionGrants.resourceId,
  action: permissionGrants.action,
  createdAt: permissionGrants.createdAt
};

export function createPermissionGrantPersistenceAuditEvent(input: {
  plan: PermissionGrantPlan;
  grantId: string;
  mode: PermissionGrantPersistenceMode;
}): typeof auditEvents.$inferInsert {
  return {
    ...input.plan.auditIntent,
    action:
      input.mode === "created"
        ? "permission_grant.created"
        : "permission_grant.existing",
    metadata: {
      ...input.plan.auditIntent.metadata,
      grantId: input.grantId,
      persistenceMode: input.mode,
      plannedAction: input.plan.auditIntent.action
    }
  };
}

export function createPermissionGrantRevocationAuditEvent(input: {
  session: AuthSession;
  grant: PersistedPermissionGrant;
  now?: Date;
}): typeof auditEvents.$inferInsert {
  const revokedAt = input.now ?? new Date();

  return {
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action: "permission_grant.revoked",
    resourceType: input.grant.resourceType,
    resourceId: input.grant.resourceId,
    metadata: {
      grantId: input.grant.id,
      subjectType: input.grant.subjectType,
      subjectId: input.grant.subjectId,
      resourceType: input.grant.resourceType,
      resourceId: input.grant.resourceId,
      action: input.grant.action,
      revokedAt: revokedAt.toISOString()
    }
  };
}

export async function listOrganizationPermissionGrants(
  db: Database,
  session: AuthSession
): Promise<PersistedPermissionGrant[]> {
  if (!canRoleManagePermissionGrants(session.role)) {
    throw new PermissionGrantManagementError(
      "forbidden",
      "Only owner or admin members can manage permission grants."
    );
  }

  return db
    .select(permissionGrantSelection)
    .from(permissionGrants)
    .where(eq(permissionGrants.organizationId, session.organizationId))
    .orderBy(desc(permissionGrants.createdAt));
}

export async function persistPermissionGrant(
  db: Database,
  input: {
    session: AuthSession;
    payload: PermissionGrantPlanPayload;
    now?: Date;
  }
): Promise<PermissionGrantPersistenceResult> {
  const plan = createPermissionGrantPlan(input);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(permissionGrants)
      .values({
        organizationId: plan.organizationId,
        subjectType: plan.subjectType,
        subjectId: plan.subjectId,
        resourceType: plan.resourceType,
        resourceId: plan.resourceId,
        action: plan.action,
        createdAt: plan.createdAt
      })
      .onConflictDoNothing({
        target: [
          permissionGrants.organizationId,
          permissionGrants.subjectType,
          permissionGrants.subjectId,
          permissionGrants.resourceType,
          permissionGrants.resourceId,
          permissionGrants.action
        ]
      })
      .returning(permissionGrantSelection);

    const mode: PermissionGrantPersistenceMode = inserted ? "created" : "existing";
    const grant =
      inserted ??
      (
        await tx
          .select(permissionGrantSelection)
          .from(permissionGrants)
          .where(
            and(
              eq(permissionGrants.organizationId, plan.organizationId),
              eq(permissionGrants.subjectType, plan.subjectType),
              eq(permissionGrants.subjectId, plan.subjectId),
              eq(permissionGrants.resourceType, plan.resourceType),
              eq(permissionGrants.resourceId, plan.resourceId),
              eq(permissionGrants.action, plan.action)
            )
          )
          .limit(1)
      )[0];

    if (!grant) {
      throw new Error("Permission grant persistence state could not be resolved.");
    }

    const auditEvent = createPermissionGrantPersistenceAuditEvent({
      plan,
      grantId: grant.id,
      mode
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      mode,
      grant,
      auditIntent: plan.auditIntent,
      auditEvent
    };
  });
}

export async function revokePermissionGrant(
  db: Database,
  input: {
    session: AuthSession;
    grantId: string;
    now?: Date;
  }
): Promise<PermissionGrantRevocationResult> {
  if (!canRoleManagePermissionGrants(input.session.role)) {
    throw new PermissionGrantManagementError(
      "forbidden",
      "Only owner or admin members can manage permission grants."
    );
  }

  return db.transaction(async (tx) => {
    const [grant] = await tx
      .delete(permissionGrants)
      .where(
        and(
          eq(permissionGrants.id, input.grantId),
          eq(permissionGrants.organizationId, input.session.organizationId)
        )
      )
      .returning(permissionGrantSelection);

    if (!grant) {
      throw new PermissionGrantManagementError(
        "not_found",
        "Permission grant was not found."
      );
    }

    const auditEvent = createPermissionGrantRevocationAuditEvent({
      session: input.session,
      grant,
      now: input.now
    });

    await tx.insert(auditEvents).values(auditEvent);

    return {
      grant,
      auditEvent
    };
  });
}

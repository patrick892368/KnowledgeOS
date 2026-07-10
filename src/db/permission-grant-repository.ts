import { and, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import {
  createPermissionGrantPlan,
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

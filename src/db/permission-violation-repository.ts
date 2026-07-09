import { desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";

import {
  AuditEventViewerError,
  canViewAuditEvents,
  sanitizeAuditMetadata
} from "./audit-repository";
import type { Database } from "./client";
import type { PermissionResourceType } from "./model";
import { auditEvents, users } from "./schema";

export type PermissionViolationSeverity = "low" | "medium" | "high";

export interface PermissionViolationSignal {
  id: string;
  organizationId: string;
  auditEventId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  violationType: string;
  severity: PermissionViolationSeverity;
  sourceAction: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

interface AuditEventLike {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  resourceType: PermissionResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function metadataCode(metadata: Record<string, unknown>): string {
  const rawCode = metadata.code ?? metadata.errorCode ?? metadata.status;

  return typeof rawCode === "string" ? rawCode.toLowerCase() : "";
}

function violationTypeFor(event: AuditEventLike): string | null {
  const action = event.action.toLowerCase();
  const code = metadataCode(event.metadata);

  if (action.includes("permission") && action.includes("denied")) {
    return "permission_denied";
  }

  if (action.includes("permission") && action.includes("violation")) {
    return "permission_violation";
  }

  if (action.includes("forbidden") || code === "forbidden") {
    return "forbidden_access";
  }

  if (code === "permission_denied" || code === "unauthorized_resource") {
    return code;
  }

  return null;
}

function severityFor(event: AuditEventLike): PermissionViolationSeverity {
  const action = event.action.toLowerCase();
  const metadataAction = event.metadata.action;

  if (
    event.resourceType === "organization" ||
    action.includes("admin") ||
    metadataAction === "admin"
  ) {
    return "high";
  }

  if (event.resourceType === "workflow") {
    return "medium";
  }

  return "low";
}

export function classifyPermissionViolation(
  event: AuditEventLike
): PermissionViolationSignal | null {
  const violationType = violationTypeFor(event);

  if (!violationType) {
    return null;
  }

  return {
    id: `permission_violation_${event.id}`,
    organizationId: event.organizationId,
    auditEventId: event.id,
    actorUserId: event.actorUserId,
    actorEmail: event.actorEmail,
    actorName: event.actorName,
    violationType,
    severity: severityFor(event),
    sourceAction: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: sanitizeAuditMetadata(event.metadata),
    occurredAt: event.createdAt
  };
}

export async function listPermissionViolations(
  db: Database,
  session: AuthSession,
  limit = 50
): Promise<PermissionViolationSignal[]> {
  if (!canViewAuditEvents(session.role)) {
    throw new AuditEventViewerError(
      "forbidden",
      "Only owner or admin members can view permission violations."
    );
  }

  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const rows = await db
    .select({
      id: auditEvents.id,
      organizationId: auditEvents.organizationId,
      actorUserId: auditEvents.actorUserId,
      actorEmail: users.email,
      actorName: users.name,
      action: auditEvents.action,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(eq(auditEvents.organizationId, session.organizationId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(boundedLimit);

  return rows
    .map((row) => classifyPermissionViolation(row))
    .filter((signal): signal is PermissionViolationSignal => signal !== null);
}

import { desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";

import type { Database } from "./client";
import type { MembershipRole, PermissionResourceType } from "./model";
import { auditEvents, users } from "./schema";

export type AuditEventViewerErrorCode =
  | "forbidden"
  | "database_unavailable";

export class AuditEventViewerError extends Error {
  constructor(
    public readonly code: AuditEventViewerErrorCode,
    message: string,
    public readonly status = code === "forbidden" ? 403 : 503
  ) {
    super(message);
    this.name = "AuditEventViewerError";
  }
}

export interface ManagedAuditEvent {
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

const unsafeMetadataKeys = new Set([
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "secret",
  "session",
  "token"
]);

export function canViewAuditEvents(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataKeyIsUnsafe(key: string): boolean {
  return unsafeMetadataKeys.has(key.replace(/[-_\s]/g, "").toLowerCase());
}

export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0
): Record<string, unknown> {
  if (!isRecord(value) || depth > 4) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([key, nestedValue]) => {
        if (metadataKeyIsUnsafe(key)) {
          return [key, "[redacted]"];
        }

        if (Array.isArray(nestedValue)) {
          return [
            key,
            nestedValue.slice(0, 20).map((item) => {
              if (isRecord(item)) {
                return sanitizeAuditMetadata(item, depth + 1);
              }

              return typeof item === "string" ? item.slice(0, 500) : item;
            })
          ];
        }

        if (isRecord(nestedValue)) {
          return [key, sanitizeAuditMetadata(nestedValue, depth + 1)];
        }

        return [
          key,
          typeof nestedValue === "string" ? nestedValue.slice(0, 500) : nestedValue
        ];
      })
  );
}

export async function listOrganizationAuditEvents(
  db: Database,
  session: AuthSession,
  limit = 50
): Promise<ManagedAuditEvent[]> {
  if (!canViewAuditEvents(session.role)) {
    throw new AuditEventViewerError(
      "forbidden",
      "Only owner or admin members can view organization audit events."
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

  return rows.map((row) => ({
    ...row,
    metadata: sanitizeAuditMetadata(row.metadata)
  }));
}

export function auditEventViewerErrorResponse(error: unknown): Response {
  if (error instanceof AuditEventViewerError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected audit event viewer failure."
      }
    },
    { status: 500 }
  );
}

import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  AuditEventViewerError,
  auditEventViewerErrorResponse,
  canViewAuditEvents,
  listOrganizationAuditEvents
} from "@/db/audit-repository";

function toDatabaseUnavailableError(error: unknown): AuditEventViewerError {
  return new AuditEventViewerError(
    "database_unavailable",
    error instanceof Error ? error.message : "Audit event database is unavailable."
  );
}

export async function GET() {
  try {
    const session = await requireSession();

    if (!canViewAuditEvents(session.role)) {
      throw new AuditEventViewerError(
        "forbidden",
        "Only owner or admin members can view organization audit events."
      );
    }

    try {
      return Response.json({
        auditEvents: await listOrganizationAuditEvents(
          createDatabaseClient(),
          session
        )
      });
    } catch (error) {
      if (error instanceof AuditEventViewerError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof AuditEventViewerError) {
      return auditEventViewerErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

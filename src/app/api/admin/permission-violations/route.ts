import { authErrorResponse, requireSession } from "@/auth/session";
import {
  AuditEventViewerError,
  auditEventViewerErrorResponse,
  canViewAuditEvents
} from "@/db/audit-repository";
import { createDatabaseClient } from "@/db/client";
import { listPermissionViolations } from "@/db/permission-violation-repository";

function toDatabaseUnavailableError(error: unknown): AuditEventViewerError {
  return new AuditEventViewerError(
    "database_unavailable",
    error instanceof Error
      ? error.message
      : "Permission violation database is unavailable."
  );
}

export async function GET() {
  try {
    const session = await requireSession();

    if (!canViewAuditEvents(session.role)) {
      throw new AuditEventViewerError(
        "forbidden",
        "Only owner or admin members can view permission violations."
      );
    }

    try {
      return Response.json({
        permissionViolations: await listPermissionViolations(
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

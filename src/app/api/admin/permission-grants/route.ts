import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  listOrganizationPermissionGrants,
  persistPermissionGrant,
  revokePermissionGrant,
  type PersistedPermissionGrant,
  type PermissionGrantRevocationResult
} from "@/db/permission-grant-repository";
import {
  createPermissionGrantPlan,
  parsePermissionGrantPersistFlag,
  parsePermissionGrantPlanPayload,
  parsePermissionGrantRevocationPayload,
  PermissionGrantManagementError,
  type PermissionGrantPlan,
  permissionGrantManagementErrorResponse
} from "@/permissions/grant-management";

function toDatabaseUnavailableError(error: unknown): PermissionGrantManagementError {
  return new PermissionGrantManagementError(
    "database_unavailable",
    error instanceof Error
      ? error.message
      : "Permission grant database is unavailable."
  );
}

function serializeGrant(grant: PermissionGrantPlan | PersistedPermissionGrant) {
  return {
    ...("id" in grant ? { id: grant.id } : {}),
    organizationId: grant.organizationId,
    subjectType: grant.subjectType,
    subjectId: grant.subjectId,
    resourceType: grant.resourceType,
    resourceId: grant.resourceId,
    action: grant.action,
    createdAt: grant.createdAt.toISOString()
  };
}

export async function GET() {
  try {
    const session = await requireSession();

    try {
      const grants = await listOrganizationPermissionGrants(
        createDatabaseClient(),
        session
      );

      return Response.json({
        grants: grants.map(serializeGrant)
      });
    } catch (error) {
      if (error instanceof PermissionGrantManagementError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof PermissionGrantManagementError) {
      return permissionGrantManagementErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new PermissionGrantManagementError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    const grantPayload = parsePermissionGrantPlanPayload(payload);
    const shouldPersist = parsePermissionGrantPersistFlag(payload);

    if (shouldPersist) {
      try {
        const result = await persistPermissionGrant(createDatabaseClient(), {
          session,
          payload: grantPayload
        });

        return Response.json(
          {
            mode: result.mode,
            grant: serializeGrant(result.grant),
            auditIntent: result.auditIntent,
            auditEvent: result.auditEvent
          },
          { status: result.mode === "created" ? 201 : 200 }
        );
      } catch (error) {
        if (error instanceof PermissionGrantManagementError) {
          throw error;
        }

        throw toDatabaseUnavailableError(error);
      }
    }

    const grant = createPermissionGrantPlan({
      session,
      payload: grantPayload
    });

    return Response.json(
      {
        mode: "planned",
        grant: serializeGrant(grant),
        auditIntent: grant.auditIntent
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof PermissionGrantManagementError) {
      return permissionGrantManagementErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new PermissionGrantManagementError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    const revoke = parsePermissionGrantRevocationPayload(payload);

    try {
      const result: PermissionGrantRevocationResult = await revokePermissionGrant(
        createDatabaseClient(),
        {
          session,
          grantId: revoke.grantId
        }
      );

      return Response.json({
        grant: serializeGrant(result.grant),
        auditEvent: result.auditEvent
      });
    } catch (error) {
      if (error instanceof PermissionGrantManagementError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof PermissionGrantManagementError) {
      return permissionGrantManagementErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

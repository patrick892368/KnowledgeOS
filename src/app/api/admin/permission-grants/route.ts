import { authErrorResponse, requireSession } from "@/auth/session";
import {
  createPermissionGrantPlan,
  parsePermissionGrantPlanPayload,
  PermissionGrantManagementError,
  permissionGrantManagementErrorResponse
} from "@/permissions/grant-management";

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

    const grant = createPermissionGrantPlan({
      session,
      payload: parsePermissionGrantPlanPayload(payload)
    });

    return Response.json(
      {
        grant: {
          organizationId: grant.organizationId,
          subjectType: grant.subjectType,
          subjectId: grant.subjectId,
          resourceType: grant.resourceType,
          resourceId: grant.resourceId,
          action: grant.action,
          createdAt: grant.createdAt.toISOString()
        },
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

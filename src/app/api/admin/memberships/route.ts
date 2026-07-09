import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  listOrganizationMemberships,
  MembershipManagementError,
  membershipManagementErrorResponse,
  parseMembershipRoleUpdatePayload,
  updateOrganizationMembershipRole
} from "@/db/membership-repository";

function toDatabaseUnavailableError(error: unknown): MembershipManagementError {
  return new MembershipManagementError(
    "database_unavailable",
    error instanceof Error
      ? error.message
      : "Membership database is unavailable."
  );
}

export async function GET() {
  try {
    const session = await requireSession();

    try {
      return Response.json({
        memberships: await listOrganizationMemberships(
          createDatabaseClient(),
          session
        )
      });
    } catch (error) {
      if (error instanceof MembershipManagementError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof MembershipManagementError) {
      return membershipManagementErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new MembershipManagementError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    const update = parseMembershipRoleUpdatePayload(payload);

    try {
      return Response.json({
        membership: await updateOrganizationMembershipRole(createDatabaseClient(), {
          session,
          ...update
        })
      });
    } catch (error) {
      if (error instanceof MembershipManagementError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (error instanceof MembershipManagementError) {
      return membershipManagementErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import {
  createPermissionGrantPlan,
  parsePermissionGrantPlanPayload,
  parsePermissionGrantRevocationPayload,
  PermissionGrantManagementError
} from "./grant-management";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const grantPayload = {
  subjectType: "role",
  subjectId: "editor",
  resourceType: "workflow",
  resourceId: "workflow_1",
  action: "write"
};

describe("parsePermissionGrantPlanPayload", () => {
  it("accepts valid permission grant fields", () => {
    expect(
      parsePermissionGrantPlanPayload({
        organizationId: " 11111111-1111-4111-8111-111111111111 ",
        subjectType: " role ",
        subjectId: " editor ",
        resourceType: " workflow ",
        resourceId: " workflow_1 ",
        action: " write "
      })
    ).toEqual({
      organizationId: "11111111-1111-4111-8111-111111111111",
      subjectType: "role",
      subjectId: "editor",
      resourceType: "workflow",
      resourceId: "workflow_1",
      action: "write"
    });
  });

  it("rejects invalid role subjects", () => {
    expect(() =>
      parsePermissionGrantPlanPayload({
        ...grantPayload,
        subjectId: "superadmin"
      })
    ).toThrow("role subjectId must be one of owner, admin, editor, or viewer.");
  });

  it("rejects invalid resources and actions", () => {
    expect(() =>
      parsePermissionGrantPlanPayload({
        ...grantPayload,
        resourceType: "billing"
      })
    ).toThrow("resourceType must be one of organization, source, document, or workflow.");

    expect(() =>
      parsePermissionGrantPlanPayload({
        ...grantPayload,
        action: "delete"
      })
    ).toThrow("action must be one of read, write, or admin.");
  });
});

describe("createPermissionGrantPlan", () => {
  it("creates an audited permission grant plan", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");
    const plan = createPermissionGrantPlan({
      session: ownerSession,
      payload: parsePermissionGrantPlanPayload(grantPayload),
      now
    });

    expect(plan).toMatchObject({
      organizationId: ownerSession.organizationId,
      subjectType: "role",
      subjectId: "editor",
      resourceType: "workflow",
      resourceId: "workflow_1",
      action: "write",
      createdAt: now,
      auditIntent: {
        organizationId: ownerSession.organizationId,
        actorUserId: ownerSession.userId,
        action: "permission_grant.planned",
        resourceType: "workflow",
        resourceId: "workflow_1",
        metadata: {
          subjectType: "role",
          subjectId: "editor",
          resourceType: "workflow",
          resourceId: "workflow_1",
          action: "write",
          plannedAt: "2026-07-10T00:00:00.000Z"
        }
      }
    });
  });

  it("rejects non-manager sessions", () => {
    expect(() =>
      createPermissionGrantPlan({
        session: {
          ...ownerSession,
          role: "editor"
        },
        payload: parsePermissionGrantPlanPayload(grantPayload)
      })
    ).toThrow("Only owner or admin members can manage permission grants.");
  });

  it("rejects cross-organization grant targets", () => {
    expect(() =>
      createPermissionGrantPlan({
        session: ownerSession,
        payload: parsePermissionGrantPlanPayload({
          ...grantPayload,
          organizationId: "99999999-9999-4999-8999-999999999999"
        })
      })
    ).toThrow("Permission grant organization target was not found.");
  });

  it("keeps organization resources inside the current organization", () => {
    expect(() =>
      createPermissionGrantPlan({
        session: ownerSession,
        payload: parsePermissionGrantPlanPayload({
          ...grantPayload,
          resourceType: "organization",
          resourceId: "99999999-9999-4999-8999-999999999999"
        })
      })
    ).toThrow("Organization permission resource was not found.");
  });

  it("prevents admins from planning admin-level grants", () => {
    expect(() =>
      createPermissionGrantPlan({
        session: {
          ...ownerSession,
          role: "admin"
        },
        payload: parsePermissionGrantPlanPayload({
          ...grantPayload,
          action: "admin"
        })
      })
    ).toThrow("Admins cannot plan admin-level or owner/admin role permission grants.");
  });

  it("prevents admins from granting owner or admin role subjects", () => {
    expect(() =>
      createPermissionGrantPlan({
        session: {
          ...ownerSession,
          role: "admin"
        },
        payload: parsePermissionGrantPlanPayload({
          ...grantPayload,
          subjectId: "owner"
        })
      })
    ).toThrow(PermissionGrantManagementError);
  });
});

describe("parsePermissionGrantRevocationPayload", () => {
  it("accepts a trimmed grant id", () => {
    expect(
      parsePermissionGrantRevocationPayload({
        grantId: " 44444444-4444-4444-8444-444444444444 "
      })
    ).toEqual({
      grantId: "44444444-4444-4444-8444-444444444444"
    });
  });

  it("rejects missing grant ids", () => {
    expect(() => parsePermissionGrantRevocationPayload({})).toThrow(
      "grantId is required."
    );
  });
});

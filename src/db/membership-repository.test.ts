import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import {
  canManageMemberships,
  createMembershipRoleUpdatePlan,
  MembershipManagementError,
  parseMembershipRoleUpdatePayload
} from "./membership-repository";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const target = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: ownerSession.organizationId,
  userId: "55555555-5555-4555-8555-555555555555",
  role: "editor" as const
};

describe("canManageMemberships", () => {
  it("allows only owner and admin roles", () => {
    expect(canManageMemberships("owner")).toBe(true);
    expect(canManageMemberships("admin")).toBe(true);
    expect(canManageMemberships("editor")).toBe(false);
    expect(canManageMemberships("viewer")).toBe(false);
  });
});

describe("parseMembershipRoleUpdatePayload", () => {
  it("accepts a membership id and valid role", () => {
    expect(
      parseMembershipRoleUpdatePayload({
        membershipId: " 44444444-4444-4444-8444-444444444444 ",
        role: "viewer"
      })
    ).toEqual({
      membershipId: "44444444-4444-4444-8444-444444444444",
      role: "viewer"
    });
  });

  it("rejects invalid roles", () => {
    expect(() =>
      parseMembershipRoleUpdatePayload({
        membershipId: "44444444-4444-4444-8444-444444444444",
        role: "superadmin"
      })
    ).toThrow(MembershipManagementError);
  });
});

describe("createMembershipRoleUpdatePlan", () => {
  it("creates an audited role update plan for an owner", () => {
    const now = new Date("2026-07-09T00:00:00.000Z");
    const plan = createMembershipRoleUpdatePlan({
      session: ownerSession,
      target,
      role: "admin",
      now
    });

    expect(plan).toMatchObject({
      membershipId: target.id,
      previousRole: "editor",
      nextRole: "admin",
      updatedAt: now,
      auditEvent: {
        organizationId: ownerSession.organizationId,
        actorUserId: ownerSession.userId,
        action: "membership.role_updated",
        resourceType: "organization",
        resourceId: ownerSession.organizationId,
        metadata: {
          membershipId: target.id,
          targetUserId: target.userId,
          previousRole: "editor",
          nextRole: "admin"
        }
      }
    });
  });

  it("rejects non-manager sessions", () => {
    expect(() =>
      createMembershipRoleUpdatePlan({
        session: {
          ...ownerSession,
          role: "editor"
        },
        target,
        role: "viewer"
      })
    ).toThrow("Only owner or admin members can manage organization memberships.");
  });

  it("hides cross-organization memberships", () => {
    expect(() =>
      createMembershipRoleUpdatePlan({
        session: ownerSession,
        target: {
          ...target,
          organizationId: "99999999-9999-4999-8999-999999999999"
        },
        role: "viewer"
      })
    ).toThrow("Membership was not found.");
  });

  it("prevents admins from modifying owner memberships", () => {
    expect(() =>
      createMembershipRoleUpdatePlan({
        session: {
          ...ownerSession,
          role: "admin"
        },
        target: {
          ...target,
          role: "owner"
        },
        role: "admin"
      })
    ).toThrow("Admins cannot assign or modify owner memberships.");
  });

  it("prevents owners from changing their own owner role", () => {
    expect(() =>
      createMembershipRoleUpdatePlan({
        session: ownerSession,
        target: {
          ...target,
          id: ownerSession.membershipId ?? "",
          userId: ownerSession.userId,
          role: "owner"
        },
        role: "admin"
      })
    ).toThrow("Owners cannot change their own owner role");
  });
});

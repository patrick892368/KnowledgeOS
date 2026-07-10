import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import {
  canPlanInvitations,
  createInvitationPlan,
  InvitationLifecycleError,
  parseInvitationPersistFlag,
  parseInvitationPlanPayload,
  parseInvitationRevocationPayload
} from "./lifecycle";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const now = new Date("2026-07-10T00:00:00.000Z");

describe("canPlanInvitations", () => {
  it("allows only owner and admin roles", () => {
    expect(canPlanInvitations("owner")).toBe(true);
    expect(canPlanInvitations("admin")).toBe(true);
    expect(canPlanInvitations("editor")).toBe(false);
    expect(canPlanInvitations("viewer")).toBe(false);
  });
});

describe("parseInvitationPlanPayload", () => {
  it("normalizes email and accepts valid invite roles", () => {
    expect(
      parseInvitationPlanPayload({
        email: " New.Member@Example.COM ",
        role: "editor",
        expiresInDays: 14
      })
    ).toEqual({
      email: "new.member@example.com",
      role: "editor",
      organizationId: undefined,
      expiresInDays: 14
    });
  });

  it("rejects invalid email addresses", () => {
    expect(() =>
      parseInvitationPlanPayload({
        email: "not-an-email",
        role: "viewer"
      })
    ).toThrow(InvitationLifecycleError);
  });

  it("rejects invalid roles", () => {
    expect(() =>
      parseInvitationPlanPayload({
        email: "member@example.com",
        role: "superadmin"
      })
    ).toThrow("role must be one of owner, admin, editor, or viewer.");
  });
});

describe("parseInvitationPersistFlag", () => {
  it("defaults to plan-only mode", () => {
    expect(parseInvitationPersistFlag({})).toBe(false);
  });

  it("accepts boolean persistence intent", () => {
    expect(parseInvitationPersistFlag({ persist: true })).toBe(true);
  });

  it("rejects invalid persistence flags", () => {
    expect(() => parseInvitationPersistFlag({ persist: "yes" })).toThrow(
      "persist must be a boolean when provided."
    );
  });
});

describe("parseInvitationRevocationPayload", () => {
  it("accepts a trimmed invitation id", () => {
    expect(
      parseInvitationRevocationPayload({
        invitationId: " invitation_1 "
      })
    ).toEqual({
      invitationId: "invitation_1"
    });
  });

  it("rejects missing invitation ids", () => {
    expect(() => parseInvitationRevocationPayload({})).toThrow(
      "invitationId is required."
    );
  });
});

describe("createInvitationPlan", () => {
  it("creates a pending invitation plan with audit intent", () => {
    const payload = parseInvitationPlanPayload({
      email: "member@example.com",
      role: "admin"
    });
    const plan = createInvitationPlan({
      session: ownerSession,
      payload,
      now,
      invitationId: "invitation_1"
    });

    expect(plan).toMatchObject({
      id: "invitation_1",
      organizationId: ownerSession.organizationId,
      email: "member@example.com",
      role: "admin",
      status: "pending",
      createdAt: now,
      expiresAt: new Date("2026-07-17T00:00:00.000Z"),
      auditIntent: {
        organizationId: ownerSession.organizationId,
        actorUserId: ownerSession.userId,
        action: "invitation.planned",
        resourceType: "organization",
        resourceId: ownerSession.organizationId,
        metadata: {
          invitationId: "invitation_1",
          email: "member@example.com",
          role: "admin",
          status: "pending",
          expiresAt: "2026-07-17T00:00:00.000Z"
        }
      }
    });
  });

  it("rejects non-manager sessions", () => {
    expect(() =>
      createInvitationPlan({
        session: {
          ...ownerSession,
          role: "editor"
        },
        payload: parseInvitationPlanPayload({
          email: "member@example.com",
          role: "viewer"
        })
      })
    ).toThrow("Only owner or admin members can plan organization invitations.");
  });

  it("rejects cross-organization invitation targets", () => {
    expect(() =>
      createInvitationPlan({
        session: ownerSession,
        payload: parseInvitationPlanPayload({
          organizationId: "99999999-9999-4999-8999-999999999999",
          email: "member@example.com",
          role: "viewer"
        })
      })
    ).toThrow("Organization invitation target was not found.");
  });

  it("rejects owner invitations until owner transfer exists", () => {
    expect(() =>
      createInvitationPlan({
        session: ownerSession,
        payload: parseInvitationPlanPayload({
          email: "owner-candidate@example.com",
          role: "owner"
        })
      })
    ).toThrow("Owner invitations require a dedicated owner transfer workflow.");
  });
});

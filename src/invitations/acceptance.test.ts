import { describe, expect, it } from "vitest";

import { InvitationLifecycleError } from "./lifecycle";
import {
  createInvitationAcceptancePlan,
  parseInvitationAcceptancePayload,
  type InvitationAcceptanceTarget
} from "./acceptance";
import { hashInvitationToken } from "./tokens";

const now = new Date("2026-07-10T00:00:00.000Z");

const target: InvitationAcceptanceTarget = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: "11111111-1111-4111-8111-111111111111",
  email: "member@example.com",
  role: "editor",
  status: "pending",
  tokenHash: hashInvitationToken("invite-token"),
  expiresAt: new Date("2026-07-17T00:00:00.000Z")
};

function expectInvitationError(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(InvitationLifecycleError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error("Expected invitation lifecycle error.");
}

describe("parseInvitationAcceptancePayload", () => {
  it("normalizes acceptance input without exposing token hashes", () => {
    expect(
      parseInvitationAcceptancePayload({
        invitationId: " invitation_1 ",
        token: " invite-token ",
        email: " Member@Example.COM ",
        organizationId: " org_1 "
      })
    ).toEqual({
      invitationId: "invitation_1",
      token: "invite-token",
      email: "member@example.com",
      organizationId: "org_1"
    });
  });

  it("rejects missing tokens", () => {
    expect(() =>
      parseInvitationAcceptancePayload({
        invitationId: target.id,
        token: " ",
        email: target.email
      })
    ).toThrow("Invitation token is required.");
  });

  it("rejects invalid emails", () => {
    expect(() =>
      parseInvitationAcceptancePayload({
        invitationId: target.id,
        token: "invite-token",
        email: "not-email"
      })
    ).toThrow("email must be a valid address.");
  });
});

describe("createInvitationAcceptancePlan", () => {
  it("creates an acceptance plan with safe audit intent", () => {
    const plan = createInvitationAcceptancePlan({
      payload: parseInvitationAcceptancePayload({
        invitationId: target.id,
        token: "invite-token",
        email: "member@example.com",
        organizationId: target.organizationId
      }),
      target,
      now
    });

    expect(plan).toMatchObject({
      invitationId: target.id,
      organizationId: target.organizationId,
      email: target.email,
      role: "editor",
      previousStatus: "pending",
      nextStatus: "accepted",
      acceptedAt: now,
      auditIntent: {
        organizationId: target.organizationId,
        actorUserId: null,
        action: "invitation.acceptance_planned",
        resourceType: "organization",
        resourceId: target.organizationId,
        metadata: {
          invitationId: target.id,
          email: target.email,
          role: "editor",
          previousStatus: "pending",
          nextStatus: "accepted",
          acceptedAt: "2026-07-10T00:00:00.000Z"
        }
      }
    });
    expect(JSON.stringify(plan)).not.toMatch(/invite-token|tokenHash/i);
  });

  it("rejects organization mismatches safely", () => {
    expect(() =>
      createInvitationAcceptancePlan({
        payload: parseInvitationAcceptancePayload({
          invitationId: target.id,
          token: "invite-token",
          email: target.email,
          organizationId: "99999999-9999-4999-8999-999999999999"
        }),
        target,
        now
      })
    ).toThrow("Invitation was not found.");
  });

  it("rejects email mismatches safely", () => {
    expect(() =>
      createInvitationAcceptancePlan({
        payload: parseInvitationAcceptancePayload({
          invitationId: target.id,
          token: "invite-token",
          email: "other@example.com"
        }),
        target,
        now
      })
    ).toThrow("Invitation was not found.");
  });

  it("rejects invalid tokens", () => {
    expect(() =>
      createInvitationAcceptancePlan({
        payload: parseInvitationAcceptancePayload({
          invitationId: target.id,
          token: "wrong-token",
          email: target.email
        }),
        target,
        now
      })
    ).toThrow("Invitation token is invalid.");
  });

  it("rejects expired invitations", () => {
    expectInvitationError(
      () =>
        createInvitationAcceptancePlan({
          payload: parseInvitationAcceptancePayload({
            invitationId: target.id,
            token: "invite-token",
            email: target.email
          }),
          target: {
            ...target,
            expiresAt: new Date("2026-07-09T23:59:59.000Z")
          },
          now
        }),
      "expired_invitation"
    );
  });

  it("rejects revoked invitations", () => {
    expectInvitationError(
      () =>
        createInvitationAcceptancePlan({
          payload: parseInvitationAcceptancePayload({
            invitationId: target.id,
            token: "invite-token",
            email: target.email
          }),
          target: {
            ...target,
            status: "revoked"
          },
          now
        }),
      "revoked_invitation"
    );
  });

  it("rejects accepted invitations", () => {
    expectInvitationError(
      () =>
        createInvitationAcceptancePlan({
          payload: parseInvitationAcceptancePayload({
            invitationId: target.id,
            token: "invite-token",
            email: target.email
          }),
          target: {
            ...target,
            status: "accepted"
          },
          now
        }),
      "accepted_invitation"
    );
  });

  it("keeps lifecycle errors typed for future API mapping", () => {
    expect(
      () =>
        createInvitationAcceptancePlan({
          payload: parseInvitationAcceptancePayload({
            invitationId: "missing",
            token: "invite-token",
            email: target.email
          }),
          target,
          now
        })
    ).toThrow(InvitationLifecycleError);
  });
});

import { describe, expect, it } from "vitest";

import { InvitationLifecycleError } from "./lifecycle";
import {
  createInvitationAcceptancePayloadFromDeliveryPlan,
  createInvitationDeliveryPlan,
  parseInvitationResendPayload,
  type InvitationDeliveryTarget
} from "./delivery";
import { hashInvitationToken } from "./tokens";

const now = new Date("2026-07-10T00:00:00.000Z");

const target: InvitationDeliveryTarget = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: "11111111-1111-4111-8111-111111111111",
  email: " Member@Example.COM ",
  role: "editor",
  status: "pending",
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

describe("parseInvitationResendPayload", () => {
  it("accepts a trimmed invitation id and optional delivery TTL", () => {
    expect(
      parseInvitationResendPayload({
        invitationId: " invitation_1 ",
        deliveryTtlHours: 12
      })
    ).toEqual({
      invitationId: "invitation_1",
      deliveryTtlHours: 12
    });
  });

  it("rejects missing invitation ids and unsafe TTL values", () => {
    expectInvitationError(
      () => parseInvitationResendPayload({}),
      "invalid_payload"
    );
    expectInvitationError(
      () =>
        parseInvitationResendPayload({
          invitationId: target.id,
          deliveryTtlHours: 0
        }),
      "invalid_payload"
    );
  });
});

describe("createInvitationDeliveryPlan", () => {
  it("creates a token-safe public delivery plan with secret material split out", () => {
    const plan = createInvitationDeliveryPlan({
      target,
      options: {
        now,
        deliveryTtlHours: 12,
        rawToken: " delivery-token "
      }
    });

    expect(plan.publicPlan).toMatchObject({
      invitationId: target.id,
      organizationId: target.organizationId,
      email: "member@example.com",
      role: "editor",
      status: "pending",
      acceptanceRoute: "/api/invitations/accept",
      deliveryExpiresAt: new Date("2026-07-10T12:00:00.000Z"),
      invitationExpiresAt: target.expiresAt,
      tokenExposure: "not_exposed",
      auditIntent: {
        organizationId: target.organizationId,
        actorUserId: null,
        action: "invitation.delivery_planned",
        resourceType: "organization",
        resourceId: target.organizationId,
        metadata: {
          invitationId: target.id,
          email: "member@example.com",
          role: "editor",
          deliveryExpiresAt: "2026-07-10T12:00:00.000Z",
          invitationExpiresAt: "2026-07-17T00:00:00.000Z",
          tokenExposure: "not_exposed"
        }
      }
    });
    expect(plan.secret).toEqual({
      rawToken: "delivery-token",
      tokenHash: hashInvitationToken("delivery-token")
    });
    expect(JSON.stringify(plan.publicPlan)).not.toMatch(
      /delivery-token|tokenHash/i
    );
    expect(JSON.stringify(plan.publicPlan.auditIntent)).not.toMatch(
      /delivery-token|tokenHash/i
    );
  });

  it("caps delivery expiration at the invitation expiration", () => {
    const plan = createInvitationDeliveryPlan({
      target: {
        ...target,
        expiresAt: new Date("2026-07-10T03:00:00.000Z")
      },
      options: {
        now,
        deliveryTtlHours: 24,
        rawToken: "delivery-token"
      }
    });

    expect(plan.publicPlan.deliveryExpiresAt).toEqual(
      new Date("2026-07-10T03:00:00.000Z")
    );
  });

  it("creates an acceptance payload compatible with the acceptance API", () => {
    const plan = createInvitationDeliveryPlan({
      target,
      options: {
        now,
        rawToken: "delivery-token"
      }
    });

    const payload = createInvitationAcceptancePayloadFromDeliveryPlan(plan);

    expect(payload).toEqual({
      invitationId: target.id,
      token: "delivery-token",
      email: "member@example.com",
      organizationId: target.organizationId
    });
    expect(hashInvitationToken(payload.token)).toBe(plan.secret.tokenHash);
  });

  it("rejects accepted invitation delivery", () => {
    expectInvitationError(
      () =>
        createInvitationDeliveryPlan({
          target: {
            ...target,
            status: "accepted"
          },
          options: {
            now,
            rawToken: "delivery-token"
          }
        }),
      "accepted_invitation"
    );
  });

  it("rejects revoked invitation delivery", () => {
    expectInvitationError(
      () =>
        createInvitationDeliveryPlan({
          target: {
            ...target,
            status: "revoked"
          },
          options: {
            now,
            rawToken: "delivery-token"
          }
        }),
      "revoked_invitation"
    );
  });

  it("rejects expired invitation delivery", () => {
    expectInvitationError(
      () =>
        createInvitationDeliveryPlan({
          target: {
            ...target,
            expiresAt: new Date("2026-07-09T23:59:59.000Z")
          },
          options: {
            now,
            rawToken: "delivery-token"
          }
        }),
      "expired_invitation"
    );
  });

  it("rejects unsafe delivery token and TTL inputs", () => {
    expectInvitationError(
      () =>
        createInvitationDeliveryPlan({
          target,
          options: {
            now,
            rawToken: " "
          }
        }),
      "invalid_token"
    );

    expectInvitationError(
      () =>
        createInvitationDeliveryPlan({
          target,
          options: {
            now,
            deliveryTtlHours: 0,
            rawToken: "delivery-token"
          }
        }),
      "invalid_payload"
    );
  });
});

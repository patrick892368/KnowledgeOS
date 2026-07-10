import { randomBytes } from "node:crypto";

import type { MembershipRole } from "@/db/model";
import type { auditEvents } from "@/db/schema";

import {
  InvitationLifecycleError,
  normalizeInvitationEmail
} from "./lifecycle";
import { hashInvitationToken } from "./tokens";

export interface InvitationDeliveryTarget {
  id: string;
  organizationId: string;
  email: string;
  role: Exclude<MembershipRole, "owner">;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: Date;
}

export interface InvitationDeliverySecret {
  rawToken: string;
  tokenHash: string;
}

export interface PublicInvitationDeliveryPlan {
  invitationId: string;
  organizationId: string;
  email: string;
  role: Exclude<MembershipRole, "owner">;
  status: "pending";
  acceptanceRoute: "/api/invitations/accept";
  deliveryExpiresAt: Date;
  invitationExpiresAt: Date;
  tokenExposure: "not_exposed";
  auditIntent: typeof auditEvents.$inferInsert;
}

export interface InvitationDeliveryPlan {
  publicPlan: PublicInvitationDeliveryPlan;
  secret: InvitationDeliverySecret;
}

export interface InvitationDeliveryOptions {
  now?: Date;
  deliveryTtlHours?: number;
  rawToken?: string;
}

const defaultDeliveryTtlHours = 24;
const hourInMs = 60 * 60 * 1000;

function createRawDeliveryToken(): string {
  return randomBytes(32).toString("base64url");
}

function createDeliveryExpiresAt(input: {
  invitationExpiresAt: Date;
  now: Date;
  deliveryTtlHours: number;
}): Date {
  if (
    !Number.isInteger(input.deliveryTtlHours) ||
    input.deliveryTtlHours < 1 ||
    input.deliveryTtlHours > 168
  ) {
    throw new InvitationLifecycleError(
      "invalid_payload",
      "deliveryTtlHours must be an integer between 1 and 168."
    );
  }

  const ttlExpiresAt = new Date(
    input.now.getTime() + input.deliveryTtlHours * hourInMs
  );

  return ttlExpiresAt.getTime() < input.invitationExpiresAt.getTime()
    ? ttlExpiresAt
    : input.invitationExpiresAt;
}

function rejectUnsafeDeliveryTarget(target: InvitationDeliveryTarget, now: Date) {
  if (target.status === "accepted") {
    throw new InvitationLifecycleError(
      "accepted_invitation",
      "Accepted invitations cannot be delivered again."
    );
  }

  if (target.status === "revoked") {
    throw new InvitationLifecycleError(
      "revoked_invitation",
      "Revoked invitations cannot be delivered again."
    );
  }

  if (target.status === "expired" || target.expiresAt.getTime() <= now.getTime()) {
    throw new InvitationLifecycleError(
      "expired_invitation",
      "Expired invitations require a new invitation before delivery."
    );
  }
}

export function createInvitationDeliveryPlan(input: {
  target: InvitationDeliveryTarget;
  options?: InvitationDeliveryOptions;
}): InvitationDeliveryPlan {
  const now = input.options?.now ?? new Date();
  const rawToken = (input.options?.rawToken ?? createRawDeliveryToken()).trim();

  if (!rawToken.trim()) {
    throw new InvitationLifecycleError(
      "invalid_token",
      "Delivery token could not be created."
    );
  }

  rejectUnsafeDeliveryTarget(input.target, now);

  const deliveryExpiresAt = createDeliveryExpiresAt({
    invitationExpiresAt: input.target.expiresAt,
    now,
    deliveryTtlHours:
      input.options?.deliveryTtlHours ?? defaultDeliveryTtlHours
  });
  const email = normalizeInvitationEmail(input.target.email);

  return {
    publicPlan: {
      invitationId: input.target.id,
      organizationId: input.target.organizationId,
      email,
      role: input.target.role,
      status: "pending",
      acceptanceRoute: "/api/invitations/accept",
      deliveryExpiresAt,
      invitationExpiresAt: input.target.expiresAt,
      tokenExposure: "not_exposed",
      auditIntent: {
        organizationId: input.target.organizationId,
        actorUserId: null,
        action: "invitation.delivery_planned",
        resourceType: "organization",
        resourceId: input.target.organizationId,
        metadata: {
          invitationId: input.target.id,
          email,
          role: input.target.role,
          deliveryExpiresAt: deliveryExpiresAt.toISOString(),
          invitationExpiresAt: input.target.expiresAt.toISOString(),
          tokenExposure: "not_exposed"
        }
      }
    },
    secret: {
      rawToken,
      tokenHash: hashInvitationToken(rawToken)
    }
  };
}

export function createInvitationAcceptancePayloadFromDeliveryPlan(
  plan: InvitationDeliveryPlan
) {
  return {
    invitationId: plan.publicPlan.invitationId,
    token: plan.secret.rawToken,
    email: plan.publicPlan.email,
    organizationId: plan.publicPlan.organizationId
  };
}

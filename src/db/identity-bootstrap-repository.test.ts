import { describe, expect, it } from "vitest";

import {
  createBootstrapMembershipId,
  createIdentityBootstrapPlan,
  createIdentityBootstrapSession
} from "./identity-bootstrap-repository";

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "KnowledgeOS",
  organizationSlug: "knowledgeos",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "owner" as const,
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner"
};

describe("createBootstrapMembershipId", () => {
  it("creates a stable membership id from organization and user ids", () => {
    expect(
      createBootstrapMembershipId(input.organizationId, input.userId)
    ).toBe(createBootstrapMembershipId(input.organizationId, input.userId));
  });
});

describe("createIdentityBootstrapPlan", () => {
  it("builds organization, user, membership, audit, and session records", () => {
    const plan = createIdentityBootstrapPlan(input);
    const membershipId = createBootstrapMembershipId(
      input.organizationId,
      input.userId
    );

    expect(plan.organization).toMatchObject({
      id: input.organizationId,
      name: "KnowledgeOS",
      slug: "knowledgeos",
      metadata: {
        bootstrap: true
      }
    });
    expect(plan.user).toMatchObject({
      id: input.userId,
      email: "owner@knowledgeos.local",
      name: "KnowledgeOS Owner",
      metadata: {
        bootstrap: true
      }
    });
    expect(plan.membership).toMatchObject({
      id: membershipId,
      organizationId: input.organizationId,
      userId: input.userId,
      role: "owner"
    });
    expect(plan.auditEvent).toMatchObject({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "identity.bootstrap_membership",
      resourceType: "organization",
      resourceId: input.organizationId,
      metadata: {
        membershipId,
        role: "owner",
        source: "bootstrap-login"
      }
    });
    expect(plan.session).toEqual({
      userId: input.userId,
      organizationId: input.organizationId,
      membershipId,
      role: "owner",
      email: "owner@knowledgeos.local",
      name: "KnowledgeOS Owner"
    });
  });

  it("uses an explicit server-configured membership id when provided", () => {
    const plan = createIdentityBootstrapPlan({
      ...input,
      membershipId: "33333333-3333-4333-8333-333333333333"
    });

    expect(plan.membership.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(plan.session.membershipId).toBe(
      "33333333-3333-4333-8333-333333333333"
    );
  });
});

describe("createIdentityBootstrapSession", () => {
  it("keeps signed session claims aligned with persisted identity ids", () => {
    expect(
      createIdentityBootstrapSession({
        organizationId: input.organizationId,
        userId: input.userId,
        membershipId: "33333333-3333-4333-8333-333333333333",
        role: "owner",
        email: input.email,
        name: input.name
      })
    ).toEqual({
      userId: input.userId,
      organizationId: input.organizationId,
      membershipId: "33333333-3333-4333-8333-333333333333",
      role: "owner",
      email: input.email,
      name: input.name
    });
  });
});

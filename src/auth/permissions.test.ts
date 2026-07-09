import { describe, expect, it } from "vitest";

import type { AuthSession } from "./session";
import {
  actionCovers,
  canAccessResource,
  grantMatchesSessionSubject,
  roleAllowsAction
} from "./permissions";

const viewerSession: AuthSession = {
  userId: "user_1",
  organizationId: "org_1",
  membershipId: "membership_1",
  role: "viewer",
  source: "development-headers"
};

describe("permission checks", () => {
  it("maps role hierarchy to actions", () => {
    expect(roleAllowsAction("viewer", "read")).toBe(true);
    expect(roleAllowsAction("viewer", "write")).toBe(false);
    expect(roleAllowsAction("editor", "write")).toBe(true);
    expect(roleAllowsAction("editor", "admin")).toBe(false);
    expect(roleAllowsAction("admin", "admin")).toBe(true);
    expect(roleAllowsAction("owner", "admin")).toBe(true);
  });

  it("lets higher grant actions cover lower requested actions", () => {
    expect(actionCovers("admin", "read")).toBe(true);
    expect(actionCovers("write", "read")).toBe(true);
    expect(actionCovers("read", "write")).toBe(false);
  });

  it("blocks cross-organization access before grant checks", () => {
    expect(
      canAccessResource(viewerSession, {
        organizationId: "org_2",
        resourceType: "document",
        resourceId: "doc_1",
        action: "read"
      })
    ).toBe(false);
  });

  it("allows organization readers to read organization resources", () => {
    expect(
      canAccessResource(viewerSession, {
        organizationId: "org_1",
        resourceType: "document",
        resourceId: "doc_1",
        action: "read"
      })
    ).toBe(true);
  });

  it("allows explicit grants to elevate a matching user", () => {
    expect(
      canAccessResource(
        viewerSession,
        {
          organizationId: "org_1",
          resourceType: "document",
          resourceId: "doc_1",
          action: "write"
        },
        [
          {
            organizationId: "org_1",
            subjectType: "user",
            subjectId: "user_1",
            resourceType: "document",
            resourceId: "doc_1",
            action: "write"
          }
        ]
      )
    ).toBe(true);
  });

  it("matches membership and role grant subjects", () => {
    expect(
      grantMatchesSessionSubject(viewerSession, {
        organizationId: "org_1",
        subjectType: "membership",
        subjectId: "membership_1",
        resourceType: "source",
        resourceId: "source_1",
        action: "read"
      })
    ).toBe(true);

    expect(
      grantMatchesSessionSubject(viewerSession, {
        organizationId: "org_1",
        subjectType: "role",
        subjectId: "viewer",
        resourceType: "source",
        resourceId: "source_1",
        action: "read"
      })
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import {
  combineHybridScore,
  hasReadGrantForResource,
  hybridSemanticWeight,
  isReadAllowedBySession
} from "./search-repository";

const viewerSession: AuthSession = {
  userId: "user_1",
  organizationId: "org_1",
  membershipId: "membership_1",
  role: "viewer",
  source: "development-headers"
};

describe("database search permission helpers", () => {
  it("allows every current membership role to read by role", () => {
    expect(isReadAllowedBySession(viewerSession)).toBe(true);
  });

  it("matches explicit read grants against organization, source, and document resources", () => {
    expect(
      hasReadGrantForResource(
        viewerSession,
        {
          organizationId: "org_1",
          subjectType: "membership",
          subjectId: "membership_1",
          resourceType: "document",
          resourceId: "doc_1",
          action: "read"
        },
        {
          organizationId: "org_1",
          sourceId: "source_1",
          documentId: "doc_1"
        }
      )
    ).toBe(true);

    expect(
      hasReadGrantForResource(
        viewerSession,
        {
          organizationId: "org_1",
          subjectType: "role",
          subjectId: "viewer",
          resourceType: "source",
          resourceId: "source_1",
          action: "admin"
        },
        {
          organizationId: "org_1",
          sourceId: "source_1",
          documentId: "doc_1"
        }
      )
    ).toBe(true);
  });

  it("rejects grants outside the organization or resource scope", () => {
    expect(
      hasReadGrantForResource(
        viewerSession,
        {
          organizationId: "org_2",
          subjectType: "user",
          subjectId: "user_1",
          resourceType: "document",
          resourceId: "doc_1",
          action: "read"
        },
        {
          organizationId: "org_1",
          sourceId: "source_1",
          documentId: "doc_1"
        }
      )
    ).toBe(false);
  });
});

describe("database hybrid search scoring", () => {
  it("adds semantic similarity to keyword score with the configured weight", () => {
    expect(combineHybridScore(3, 0.5)).toBe(3 + 0.5 * hybridSemanticWeight);
  });
});

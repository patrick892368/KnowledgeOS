import { describe, expect, it } from "vitest";

import { parseInvitationAcceptanceDeepLink } from "./deep-link";

describe("parseInvitationAcceptanceDeepLink", () => {
  it("loads trimmed non-secret invitation context", () => {
    expect(
      parseInvitationAcceptanceDeepLink(
        "?invitationId=%20invitation_1%20&email=%20member%40example.com%20&organizationId=%20org_1%20"
      )
    ).toEqual({
      context: {
        invitationId: "invitation_1",
        email: "member@example.com",
        organizationId: "org_1"
      },
      issue: null,
      consumedContextParameters: true,
      sensitiveParametersRemoved: false,
      sanitizedSearch: ""
    });
  });

  it("never imports secrets and removes managed values from the URL", () => {
    const result = parseInvitationAcceptanceDeepLink(
      "?tab=operations&invitationId=invitation_1&email=member%40example.com&token=raw-token&token_hash=hash&secret=value"
    );

    expect(result).toMatchObject({
      context: {
        invitationId: "invitation_1",
        email: "member@example.com"
      },
      issue: null,
      consumedContextParameters: true,
      sensitiveParametersRemoved: true,
      sanitizedSearch: "?tab=operations"
    });
    expect(JSON.stringify(result.context)).not.toMatch(/raw-token|hash|secret/);
  });

  it("rejects incomplete and duplicate context", () => {
    expect(
      parseInvitationAcceptanceDeepLink("?invitationId=invitation_1")
    ).toMatchObject({
      context: null,
      issue: {
        code: "incomplete_link"
      },
      sanitizedSearch: ""
    });
    expect(
      parseInvitationAcceptanceDeepLink(
        "?invitationId=one&invitationId=two&email=member%40example.com"
      )
    ).toMatchObject({
      context: null,
      issue: {
        code: "ambiguous_link"
      },
      sanitizedSearch: ""
    });
  });

  it("rejects oversized context without retaining it in the URL", () => {
    const result = parseInvitationAcceptanceDeepLink(
      `?invitationId=${"a".repeat(201)}&email=member%40example.com`
    );

    expect(result).toMatchObject({
      context: null,
      issue: {
        code: "invalid_link"
      },
      sanitizedSearch: ""
    });
  });

  it("removes secret-only parameters without treating them as context", () => {
    expect(
      parseInvitationAcceptanceDeepLink("?view=console&invitation_token=value")
    ).toEqual({
      context: null,
      issue: null,
      consumedContextParameters: false,
      sensitiveParametersRemoved: true,
      sanitizedSearch: "?view=console"
    });
  });
});

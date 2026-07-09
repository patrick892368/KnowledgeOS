import { describe, expect, it } from "vitest";

import { parseCurrentSession, parseSignedSessionToken } from "./session";
import {
  authenticateBootstrapLogin,
  authenticateBootstrapLoginWithIdentityBootstrap,
  BootstrapLoginError,
  parseBootstrapLoginPayload
} from "./bootstrap-login";

const now = new Date("2026-07-08T00:00:00.000Z");
const sessionSecret = "test-secret-123456789012345678901234";
const environment = {
  NODE_ENV: "production",
  KNOWLEDGEOS_SESSION_SECRET: sessionSecret,
  KNOWLEDGEOS_BOOTSTRAP_EMAIL: "owner@knowledgeos.local",
  KNOWLEDGEOS_BOOTSTRAP_PASSWORD: "correct-password",
  KNOWLEDGEOS_BOOTSTRAP_USER_ID: "22222222-2222-4222-8222-222222222222",
  KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_ID:
    "11111111-1111-4111-8111-111111111111",
  KNOWLEDGEOS_BOOTSTRAP_MEMBERSHIP_ID:
    "33333333-3333-4333-8333-333333333333",
  KNOWLEDGEOS_BOOTSTRAP_ROLE: "owner",
  KNOWLEDGEOS_BOOTSTRAP_NAME: "KnowledgeOS Owner",
  KNOWLEDGEOS_BOOTSTRAP_SESSION_TTL_SECONDS: "60"
};

describe("parseBootstrapLoginPayload", () => {
  it("accepts only email and password as login inputs", () => {
    expect(
      parseBootstrapLoginPayload({
        email: " owner@knowledgeos.local ",
        password: "correct-password",
        role: "admin",
        organizationId: "attacker-org"
      })
    ).toEqual({
      email: "owner@knowledgeos.local",
      password: "correct-password"
    });
  });

  it("rejects invalid login payloads", () => {
    expect(() =>
      parseBootstrapLoginPayload({
        email: "",
        password: ""
      })
    ).toThrow(BootstrapLoginError);
  });
});

describe("authenticateBootstrapLogin", () => {
  it("creates a signed session from server-controlled bootstrap identity", () => {
    const login = authenticateBootstrapLogin(
      {
        email: "OWNER@knowledgeos.local",
        password: "correct-password",
        organizationId: "client-controlled-org",
        role: "viewer"
      },
      environment,
      now
    );

    expect(login.session).toEqual({
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      membershipId: "33333333-3333-4333-8333-333333333333",
      role: "owner",
      email: "owner@knowledgeos.local",
      name: "KnowledgeOS Owner"
    });
    expect(login.identity).toEqual({
      mode: "environment",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      membershipId: "33333333-3333-4333-8333-333333333333"
    });
    expect(login.maxAgeSeconds).toBe(60);
    expect(parseSignedSessionToken(login.token, sessionSecret, now)).toEqual({
      ...login.session,
      source: "signed-cookie"
    });
  });

  it("creates a signed session from database-bootstrapped identity records", async () => {
    const login = await authenticateBootstrapLoginWithIdentityBootstrap(
      {
        email: "owner@knowledgeos.local",
        password: "correct-password"
      },
      {
        env: {
          ...environment,
          KNOWLEDGEOS_BOOTSTRAP_MEMBERSHIP_ID: undefined
        },
        now,
        bootstrapIdentity: async (identityInput) => ({
          mode: "database",
          organizationId: identityInput.organizationId,
          userId: identityInput.userId,
          membershipId: "44444444-4444-4444-8444-444444444444",
          role: identityInput.role,
          session: {
            userId: identityInput.userId,
            organizationId: identityInput.organizationId,
            membershipId: "44444444-4444-4444-8444-444444444444",
            role: identityInput.role,
            email: identityInput.email,
            name: identityInput.name
          }
        })
      }
    );

    expect(login.identity).toEqual({
      mode: "database",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      membershipId: "44444444-4444-4444-8444-444444444444"
    });
    expect(parseSignedSessionToken(login.token, sessionSecret, now)).toEqual({
      ...login.session,
      source: "signed-cookie"
    });
  });

  it("rejects invalid credentials", () => {
    expect(() =>
      authenticateBootstrapLogin(
        {
          email: "owner@knowledgeos.local",
          password: "wrong-password"
        },
        environment,
        now
      )
    ).toThrow("Invalid email or password.");
  });

  it("rejects missing bootstrap configuration", () => {
    expect(() =>
      authenticateBootstrapLogin(
        {
          email: "owner@knowledgeos.local",
          password: "correct-password"
        },
        {
          ...environment,
          KNOWLEDGEOS_BOOTSTRAP_PASSWORD: undefined
        },
        now
      )
    ).toThrow("KNOWLEDGEOS_BOOTSTRAP_PASSWORD is required");
  });

  it("keeps production development-header rejection intact", () => {
    const session = parseCurrentSession(
      new Headers({
        "x-knowledgeos-user-id": "dev-user",
        "x-knowledgeos-organization-id": "dev-org",
        "x-knowledgeos-role": "owner"
      }),
      {
        NODE_ENV: "production",
        KNOWLEDGEOS_SESSION_SECRET: sessionSecret
      },
      now
    );

    expect(session).toBeNull();
  });
});

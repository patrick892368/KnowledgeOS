import { describe, expect, it } from "vitest";

import {
  AuthError,
  authCookieName,
  createSessionCookieHeader,
  createSignedSessionToken,
  expireSessionCookieHeader,
  parseCurrentSession,
  parseDevelopmentSession,
  parseSignedSessionToken,
  sessionHeaderNames
} from "./session";

function makeHeaders(values: Record<string, string>) {
  return new Headers(values);
}

const sessionSecret = "test-secret-123456789012345678901234";
const sessionClaims = {
  userId: "user_1",
  organizationId: "org_1",
  membershipId: "membership_1",
  role: "admin" as const,
  email: "admin@example.com",
  name: "Admin User"
};
const issuedAt = new Date("2026-07-08T00:00:00.000Z");

describe("development session parsing", () => {
  it("returns null when no development session headers are present", () => {
    expect(parseDevelopmentSession(makeHeaders({}))).toBeNull();
  });

  it("parses a valid development session", () => {
    const session = parseDevelopmentSession(
      makeHeaders({
        [sessionHeaderNames.userId]: "user_1",
        [sessionHeaderNames.organizationId]: "org_1",
        [sessionHeaderNames.membershipId]: "membership_1",
        [sessionHeaderNames.role]: "admin",
        [sessionHeaderNames.email]: "admin@example.com"
      })
    );

    expect(session).toEqual({
      userId: "user_1",
      organizationId: "org_1",
      membershipId: "membership_1",
      role: "admin",
      email: "admin@example.com",
      name: undefined,
      source: "development-headers"
    });
  });

  it("rejects partial development session headers", () => {
    expect(() =>
      parseDevelopmentSession(
        makeHeaders({
          [sessionHeaderNames.userId]: "user_1"
        })
      )
    ).toThrow(AuthError);
  });

  it("rejects unknown membership roles", () => {
    expect(() =>
      parseDevelopmentSession(
        makeHeaders({
          [sessionHeaderNames.userId]: "user_1",
          [sessionHeaderNames.organizationId]: "org_1",
          [sessionHeaderNames.role]: "guest"
        })
      )
    ).toThrow("Invalid development session role");
  });
});

describe("signed session parsing", () => {
  it("creates and parses a signed session token", () => {
    const token = createSignedSessionToken(sessionClaims, sessionSecret, {
      now: issuedAt,
      ttlSeconds: 60
    });

    expect(parseSignedSessionToken(token, sessionSecret, issuedAt)).toEqual({
      ...sessionClaims,
      source: "signed-cookie"
    });
  });

  it("rejects tampered signed session tokens", () => {
    const token = createSignedSessionToken(sessionClaims, sessionSecret, {
      now: issuedAt,
      ttlSeconds: 60
    });

    expect(() =>
      parseSignedSessionToken(`${token.slice(0, -1)}x`, sessionSecret, issuedAt)
    ).toThrow("Signed session token is invalid");
  });

  it("rejects expired signed session tokens", () => {
    const token = createSignedSessionToken(sessionClaims, sessionSecret, {
      now: issuedAt,
      ttlSeconds: 1
    });

    expect(() =>
      parseSignedSessionToken(
        token,
        sessionSecret,
        new Date("2026-07-08T00:00:02.000Z")
      )
    ).toThrow("Signed session token has expired");
  });

  it("parses signed cookies before development headers", () => {
    const token = createSignedSessionToken(sessionClaims, sessionSecret, {
      now: issuedAt,
      ttlSeconds: 60
    });
    const session = parseCurrentSession(
      makeHeaders({
        cookie: `${authCookieName}=${token}`,
        [sessionHeaderNames.userId]: "dev_user",
        [sessionHeaderNames.organizationId]: "dev_org",
        [sessionHeaderNames.role]: "viewer"
      }),
      {
        NODE_ENV: "production",
        KNOWLEDGEOS_SESSION_SECRET: sessionSecret
      },
      issuedAt
    );

    expect(session).toEqual({
      ...sessionClaims,
      source: "signed-cookie"
    });
  });

  it("ignores development headers in production mode", () => {
    expect(
      parseCurrentSession(
        makeHeaders({
          [sessionHeaderNames.userId]: "user_1",
          [sessionHeaderNames.organizationId]: "org_1",
          [sessionHeaderNames.role]: "admin"
        }),
        {
          NODE_ENV: "production"
        },
        issuedAt
      )
    ).toBeNull();
  });

  it("requires a configured session secret when a signed cookie is present", () => {
    const token = createSignedSessionToken(sessionClaims, sessionSecret, {
      now: issuedAt,
      ttlSeconds: 60
    });

    expect(() =>
      parseCurrentSession(
        makeHeaders({
          cookie: `${authCookieName}=${token}`
        }),
        {
          NODE_ENV: "production"
        },
        issuedAt
      )
    ).toThrow("KNOWLEDGEOS_SESSION_SECRET is required");
  });

  it("creates secure cookie headers and logout expiration headers", () => {
    const token = createSignedSessionToken(sessionClaims, sessionSecret, {
      now: issuedAt,
      ttlSeconds: 60
    });

    expect(
      createSessionCookieHeader(token, {
        maxAgeSeconds: 60,
        secure: true
      })
    ).toContain("HttpOnly; SameSite=Lax; Max-Age=60; Secure");

    expect(expireSessionCookieHeader({ secure: true })).toContain(
      "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure"
    );
  });
});

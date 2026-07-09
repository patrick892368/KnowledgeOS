import { afterEach, describe, expect, it, vi } from "vitest";

import { authCookieName } from "@/auth/session";

import { POST } from "./route";

function stubBootstrapEnvironment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv(
    "KNOWLEDGEOS_SESSION_SECRET",
    "test-secret-123456789012345678901234"
  );
  vi.stubEnv("KNOWLEDGEOS_BOOTSTRAP_EMAIL", "owner@knowledgeos.local");
  vi.stubEnv("KNOWLEDGEOS_BOOTSTRAP_PASSWORD", "correct-password");
  vi.stubEnv(
    "KNOWLEDGEOS_BOOTSTRAP_USER_ID",
    "22222222-2222-4222-8222-222222222222"
  );
  vi.stubEnv(
    "KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_ID",
    "11111111-1111-4111-8111-111111111111"
  );
  vi.stubEnv(
    "KNOWLEDGEOS_BOOTSTRAP_MEMBERSHIP_ID",
    "33333333-3333-4333-8333-333333333333"
  );
  vi.stubEnv("KNOWLEDGEOS_BOOTSTRAP_ROLE", "owner");
  vi.stubEnv("KNOWLEDGEOS_BOOTSTRAP_NAME", "KnowledgeOS Owner");
  vi.stubEnv("KNOWLEDGEOS_BOOTSTRAP_SESSION_TTL_SECONDS", "60");
}

function loginRequest(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/auth/login", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/auth/login", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("issues a signed session cookie for valid bootstrap credentials", async () => {
    stubBootstrapEnvironment();

    const response = await POST(
      loginRequest({
        email: "owner@knowledgeos.local",
        password: "correct-password"
      })
    );
    const payload = (await response.json()) as {
      session: {
        source: string;
        role: string;
        organizationId: string;
      };
      identity: {
        mode: string;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(authCookieName);
    expect(payload.session).toMatchObject({
      source: "signed-cookie",
      role: "owner",
      organizationId: "11111111-1111-4111-8111-111111111111"
    });
    expect(payload.identity.mode).toBe("environment");
  });

  it("rejects invalid credentials without issuing a cookie", async () => {
    stubBootstrapEnvironment();

    const response = await POST(
      loginRequest({
        email: "owner@knowledgeos.local",
        password: "wrong-password"
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns a recoverable payload error for invalid JSON", async () => {
    stubBootstrapEnvironment();

    const response = await POST(loginRequest("{invalid-json"));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_payload");
  });
});

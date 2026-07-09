import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn()
}));

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();

  return {
    ...actual,
    requireSession: mocks.requireSession
  };
});

import { POST } from "./route";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "editor",
  email: "editor@knowledgeos.local",
  name: "KnowledgeOS Editor",
  source: "development-headers"
};

function ingestRequest(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/ingest/repository", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/ingest/repository", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized repository metadata ingestion for a safe URL", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      ingestRequest({
        repositoryUrl: "https://93.184.216.34/acme/knowledgeos",
        description: "Enterprise knowledge repository",
        defaultBranch: "main",
        visibility: "public"
      })
    );
    const payload = (await response.json()) as {
      ingestion: {
        organizationId: string;
        source: {
          type: string;
          name: string;
          uri: string;
        };
        chunks: Array<{ content: string }>;
        citations: unknown[];
      };
      persistence: {
        mode: string;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.ingestion).toMatchObject({
      organizationId: session.organizationId,
      source: {
        type: "repository",
        name: "acme/knowledgeos",
        uri: "https://93.184.216.34/acme/knowledgeos"
      }
    });
    expect(payload.ingestion.chunks[0]?.content).toContain(
      "repository code was not cloned or indexed"
    );
    expect(payload.ingestion.citations).toHaveLength(1);
    expect(payload.persistence.mode).toBe("request-scoped");
  });

  it("accepts owner/name repository metadata", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      ingestRequest({
        host: "93.184.216.34",
        owner: "acme",
        name: "platform",
        topics: ["rag", "workflow"]
      })
    );
    const payload = (await response.json()) as {
      ingestion: {
        source: {
          name: string;
          uri: string;
        };
      };
    };

    expect(response.status).toBe(201);
    expect(payload.ingestion.source).toMatchObject({
      name: "acme/platform",
      uri: "https://93.184.216.34/acme/platform"
    });
  });

  it("rejects unsafe repository URLs before normalization", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      ingestRequest({
        repositoryUrl: "http://localhost:3000/acme/private"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("unsafe_url");
  });
});

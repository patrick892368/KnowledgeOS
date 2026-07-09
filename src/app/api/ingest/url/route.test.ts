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
  return new Request("http://knowledgeos.local/api/ingest/url", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/ingest/url", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns normalized URL ingestion for a safe URL", async () => {
    mocks.requireSession.mockResolvedValue(session);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          "<html><head><title>Public Docs</title></head><body><p>External source material with citations.</p></body></html>",
          {
            headers: {
              "content-type": "text/html"
            }
          }
        )
      )
    );

    const response = await POST(
      ingestRequest({
        url: "https://93.184.216.34/docs"
      })
    );
    const payload = (await response.json()) as {
      ingestion: {
        organizationId: string;
        source: {
          type: string;
          uri: string;
        };
        chunks: unknown[];
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
        type: "url",
        uri: "https://93.184.216.34/docs"
      }
    });
    expect(payload.ingestion.chunks).toHaveLength(1);
    expect(payload.ingestion.citations).toHaveLength(1);
    expect(payload.persistence.mode).toBe("request-scoped");
  });

  it("rejects unsafe localhost URLs before fetch", async () => {
    const fetchMock = vi.fn();
    mocks.requireSession.mockResolvedValue(session);
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      ingestRequest({
        url: "http://localhost:3000/private"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("unsafe_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns recoverable errors for unsupported content types", async () => {
    mocks.requireSession.mockResolvedValue(session);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("binary", {
          headers: {
            "content-type": "application/octet-stream"
          }
        })
      )
    );

    const response = await POST(
      ingestRequest({
        url: "https://93.184.216.34/file"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
        recoverable: boolean;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error).toMatchObject({
      code: "unsupported_content_type",
      recoverable: true
    });
  });
});

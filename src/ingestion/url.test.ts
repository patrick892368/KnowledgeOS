import { describe, expect, it, vi } from "vitest";

import { IngestionError } from "./errors";
import {
  createUrlIngestionResult,
  extractReadableUrlText,
  fetchUrlContent,
  ingestUrl,
  isUnsafeIpAddress,
  parseUrlIngestionPayload,
  resolveSafeUrl
} from "./url";

const context = {
  organizationId: "org_1",
  createdBy: "user_1"
};

const publicResolver = async () => [
  {
    address: "93.184.216.34",
    family: 4
  }
];

describe("URL safety validation", () => {
  it("rejects invalid schemes and localhost before fetch", async () => {
    await expect(
      resolveSafeUrl("file:///etc/passwd", {
        resolveHostAddresses: publicResolver
      })
    ).rejects.toThrow(IngestionError);
    await expect(
      resolveSafeUrl("http://localhost:3000", {
        resolveHostAddresses: publicResolver
      })
    ).rejects.toThrow("Localhost URLs are not allowed.");
  });

  it("rejects loopback, link-local, and private IP addresses", () => {
    expect(isUnsafeIpAddress("127.0.0.1")).toBe(true);
    expect(isUnsafeIpAddress("169.254.1.1")).toBe(true);
    expect(isUnsafeIpAddress("10.0.0.5")).toBe(true);
    expect(isUnsafeIpAddress("172.16.0.10")).toBe(true);
    expect(isUnsafeIpAddress("192.168.1.10")).toBe(true);
    expect(isUnsafeIpAddress("::1")).toBe(true);
    expect(isUnsafeIpAddress("93.184.216.34")).toBe(false);
  });

  it("rejects hostnames that resolve to unsafe addresses", async () => {
    await expect(
      resolveSafeUrl("https://internal.example", {
        resolveHostAddresses: async () => [
          {
            address: "10.0.0.9",
            family: 4
          }
        ]
      })
    ).rejects.toThrow("URL resolves to a local, private, or reserved network address.");
  });
});

describe("URL content ingestion", () => {
  it("extracts readable HTML text and title", () => {
    expect(
      extractReadableUrlText(
        "<html><head><title>Docs</title><style>.x{}</style></head><body><h1>Knowledge</h1><script>bad()</script><p>Trusted citations</p></body></html>",
        "text/html"
      )
    ).toEqual({
      title: "Docs",
      content: "Knowledge\nTrusted citations"
    });
  });

  it("fetches HTML content with safe redirects", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "https://example.com/start") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/docs"
          }
        });
      }

      return new Response(
        "<html><head><title>Knowledge Docs</title></head><body><p>Permission-aware retrieval.</p></body></html>",
        {
          headers: {
            "content-type": "text/html"
          }
        }
      );
    });

    const fetched = await fetchUrlContent(
      {
        ...context,
        url: "https://example.com/start"
      },
      {
        fetcher,
        resolveHostAddresses: publicResolver,
        now: new Date("2026-07-09T00:00:00.000Z")
      }
    );

    expect(fetched).toMatchObject({
      requestedUrl: "https://example.com/start",
      finalUrl: "https://example.com/docs",
      title: "Knowledge Docs",
      content: "Permission-aware retrieval.",
      contentType: "text/html"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported content types and empty extracted content", async () => {
    await expect(
      fetchUrlContent(
        {
          ...context,
          url: "https://example.com/archive.zip"
        },
        {
          fetcher: async () =>
            new Response("zip", {
              headers: {
                "content-type": "application/zip"
              }
            }),
          resolveHostAddresses: publicResolver
        }
      )
    ).rejects.toMatchObject({
      code: "unsupported_content_type"
    });

    await expect(
      fetchUrlContent(
        {
          ...context,
          url: "https://example.com/empty"
        },
        {
          fetcher: async () =>
            new Response("<html><script>bad()</script></html>", {
              headers: {
                "content-type": "text/html"
              }
            }),
          resolveHostAddresses: publicResolver
        }
      )
    ).rejects.toMatchObject({
      code: "empty_content"
    });
  });

  it("returns a recoverable fetch error when the network request fails", async () => {
    await expect(
      fetchUrlContent(
        {
          ...context,
          url: "https://example.com/down"
        },
        {
          fetcher: async () => {
            throw new Error("network down");
          },
          resolveHostAddresses: publicResolver
        }
      )
    ).rejects.toMatchObject({
      code: "fetch_failed"
    });
  });

  it("normalizes URL content into source, document, chunks, and citations", async () => {
    const ingestion = await ingestUrl(
      {
        ...context,
        url: "https://example.com/docs",
        metadata: {
          connector: "manual-url"
        }
      },
      {
        fetcher: async () =>
          new Response(
            "<html><head><title>Knowledge Docs</title></head><body><p>Permission-aware retrieval keeps citations attached.</p></body></html>",
            {
              headers: {
                "content-type": "text/html"
              }
            }
          ),
        resolveHostAddresses: publicResolver,
        now: new Date("2026-07-09T00:00:00.000Z")
      }
    );

    expect(ingestion).toMatchObject({
      organizationId: "org_1",
      source: {
        type: "url",
        name: "Knowledge Docs",
        uri: "https://example.com/docs",
        createdBy: "user_1",
        metadata: {
          connector: "manual-url",
          requestedUrl: "https://example.com/docs",
          finalUrl: "https://example.com/docs",
          contentType: "text/html"
        }
      },
      document: {
        title: "Knowledge Docs",
        status: "indexed",
        metadata: {
          sourceType: "url"
        }
      }
    });
    expect(ingestion.chunks).toHaveLength(1);
    expect(ingestion.citations[0]).toMatchObject({
      label: "Knowledge Docs #1",
      uri: "https://example.com/docs"
    });
  });

  it("creates an ingestion result from already fetched content", () => {
    const result = createUrlIngestionResult(
      {
        ...context,
        url: "https://example.com/source"
      },
      {
        requestedUrl: "https://example.com/source",
        finalUrl: "https://example.com/source",
        title: "Fetched Source",
        content: "Useful source text.",
        contentType: "text/plain",
        fetchedAt: new Date("2026-07-09T00:00:00.000Z")
      }
    );

    expect(result.source.type).toBe("url");
    expect(result.document.title).toBe("Fetched Source");
  });
});

describe("parseUrlIngestionPayload", () => {
  it("parses URL payload with session context", () => {
    expect(
      parseUrlIngestionPayload(
        {
          url: "https://example.com/docs",
          title: "Docs"
        },
        context
      )
    ).toMatchObject({
      organizationId: "org_1",
      createdBy: "user_1",
      url: "https://example.com/docs",
      title: "Docs"
    });
  });
});

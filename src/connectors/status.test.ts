import { describe, expect, it } from "vitest";

import { ingestLocalNote } from "@/ingestion/local-note";

import {
  createBlockedConnectorStatus,
  createConnectorStatusFromIngestion,
  sanitizeConnectorError,
  sanitizeConnectorUri
} from "./status";

const ingestion = ingestLocalNote({
  organizationId: "org_1",
  createdBy: "user_1",
  title: "Connector Note",
  content: "Connector status should be visible.",
  uri: "https://example.com/source?token=secret#private"
});

const now = new Date("2026-07-09T00:00:00.000Z");

describe("connector status", () => {
  it("creates request-scoped status for non-persisted ingestion", () => {
    expect(
      createConnectorStatusFromIngestion(
        ingestion,
        {
          mode: "request-scoped"
        },
        now
      )
    ).toMatchObject({
      sourceType: "note",
      sourceName: "Connector Note",
      sourceUri: "https://example.com/source",
      syncMode: "request_scoped",
      outcome: "request_scoped",
      lastActivityAt: "2026-07-09T00:00:00.000Z",
      metadata: {
        chunks: 1,
        vectors: 0
      }
    });
  });

  it("creates synced status for persisted ingestion", () => {
    expect(
      createConnectorStatusFromIngestion(
        ingestion,
        {
          mode: "postgres",
          embeddingIds: ["embedding_1"],
          embeddingModel: "knowledgeos-local-hash-embedding-v1"
        },
        now
      )
    ).toMatchObject({
      syncMode: "persisted",
      outcome: "synced",
      message: "1 chunks and 1 vectors persisted.",
      metadata: {
        chunks: 1,
        vectors: 1,
        embeddingModel: "knowledgeos-local-hash-embedding-v1"
      }
    });
  });

  it("creates blocked status with sanitized error details", () => {
    expect(
      createBlockedConnectorStatus(
        {
          sourceType: "url",
          sourceName: "Blocked URL",
          sourceUri: "https://example.com/private?access_token=secret",
          syncMode: "request_scoped",
          errorMessage:
            "Fetch failed for https://example.com/private?access_token=secret\n    at handler(secret.ts:10:1)"
        },
        now
      )
    ).toMatchObject({
      sourceType: "url",
      sourceUri: "https://example.com/private",
      outcome: "blocked",
      safeError: "Fetch failed for https://example.com/private?[redacted]"
    });
  });

  it("sanitizes URLs and secret-like values", () => {
    expect(
      sanitizeConnectorUri("https://user:pass@example.com/path?token=secret#hash")
    ).toBe("https://example.com/path");
    expect(
      sanitizeConnectorError("Connector blocked password=secret token=secret")
    ).toBe("Connector blocked password=[redacted] token=[redacted]");
  });
});

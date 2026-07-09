import { describe, expect, it } from "vitest";

import {
  createBlockedConnectorStatus,
  createConnectorStatusFromIngestion
} from "@/connectors/status";
import { ingestLocalNote } from "@/ingestion/local-note";

import { createSourceQualitySummary } from "./source";

const ingestion = ingestLocalNote({
  organizationId: "org_1",
  createdBy: "user_1",
  title: "Source Quality",
  content: "Source quality indicators should use aggregate metrics only.",
  uri: "https://example.com/source"
});

const now = new Date("2026-07-09T00:00:00.000Z");

describe("createSourceQualitySummary", () => {
  it("returns a no-data summary for an empty workspace", () => {
    expect(
      createSourceQualitySummary({
        ingestions: [],
        connectorStatuses: []
      })
    ).toEqual({
      status: "no_data",
      sourceCount: 0,
      chunkCount: 0,
      citationCount: 0,
      citationCoverage: 0,
      connectorEventCount: 0,
      blockedConnectorCount: 0,
      connectorBlockRate: 0,
      persistedConnectorCount: 0,
      requestScopedConnectorCount: 0
    });
  });

  it("reports healthy source quality when chunks and citations align", () => {
    const summary = createSourceQualitySummary({
      ingestions: [ingestion],
      connectorStatuses: [
        createConnectorStatusFromIngestion(
          ingestion,
          {
            mode: "postgres",
            embeddingIds: ["embedding_1"]
          },
          now
        )
      ]
    });

    expect(summary).toMatchObject({
      status: "healthy",
      sourceCount: 1,
      chunkCount: ingestion.chunks.length,
      citationCount: ingestion.citations.length,
      citationCoverage: 1,
      connectorEventCount: 1,
      blockedConnectorCount: 0,
      persistedConnectorCount: 1
    });
  });

  it("marks blocked connectors as needing attention", () => {
    const summary = createSourceQualitySummary({
      ingestions: [ingestion],
      connectorStatuses: [
        createBlockedConnectorStatus(
          {
            sourceType: "url",
            sourceName: "Blocked URL",
            sourceUri: "https://example.com/private?token=secret",
            syncMode: "request_scoped",
            errorMessage: "Fetch failed token=secret"
          },
          now
        )
      ]
    });

    expect(summary).toMatchObject({
      status: "needs_attention",
      blockedConnectorCount: 1,
      connectorBlockRate: 1
    });
  });

  it("marks missing citations as needing attention", () => {
    const summary = createSourceQualitySummary({
      ingestions: [
        {
          ...ingestion,
          citations: []
        }
      ],
      connectorStatuses: []
    });

    expect(summary).toMatchObject({
      status: "needs_attention",
      citationCoverage: 0
    });
  });
});

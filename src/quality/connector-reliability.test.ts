import { describe, expect, it } from "vitest";

import {
  createBlockedConnectorStatus,
  createConnectorStatusFromIngestion
} from "@/connectors/status";
import { ingestLocalNote } from "@/ingestion/local-note";

import { createConnectorReliabilitySummary } from "./connector-reliability";

const ingestion = ingestLocalNote({
  organizationId: "org_1",
  createdBy: "user_1",
  title: "Connector Reliability",
  content: "Connector reliability should use aggregate status outcomes only.",
  uri: "https://example.com/reliability"
});

const now = new Date("2026-07-10T00:00:00.000Z");
const earlier = new Date("2026-07-09T00:00:00.000Z");

describe("createConnectorReliabilitySummary", () => {
  it("returns no-data when there are no connector statuses", () => {
    expect(
      createConnectorReliabilitySummary({
        connectorStatuses: []
      })
    ).toEqual({
      status: "no_data",
      connectorEventCount: 0,
      successfulConnectorCount: 0,
      blockedConnectorCount: 0,
      requestScopedConnectorCount: 0,
      persistedConnectorCount: 0,
      reliabilityRate: 0,
      blockRate: 0,
      persistedRate: 0,
      latestActivityAt: undefined
    });
  });

  it("reports healthy reliability for successful connector statuses", () => {
    const summary = createConnectorReliabilitySummary({
      connectorStatuses: [
        createConnectorStatusFromIngestion(
          ingestion,
          { mode: "request-scoped" },
          earlier
        ),
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
      connectorEventCount: 2,
      successfulConnectorCount: 2,
      blockedConnectorCount: 0,
      requestScopedConnectorCount: 1,
      persistedConnectorCount: 1,
      reliabilityRate: 1,
      blockRate: 0,
      persistedRate: 0.5,
      latestActivityAt: now.toISOString()
    });
  });

  it("reports degraded reliability when a connector is blocked", () => {
    const summary = createConnectorReliabilitySummary({
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
      status: "degraded",
      connectorEventCount: 1,
      successfulConnectorCount: 0,
      blockedConnectorCount: 1,
      reliabilityRate: 0,
      blockRate: 1
    });
  });

  it("calculates mixed connector reliability rates", () => {
    const summary = createConnectorReliabilitySummary({
      connectorStatuses: [
        createConnectorStatusFromIngestion(
          ingestion,
          { mode: "request-scoped" },
          earlier
        ),
        createBlockedConnectorStatus(
          {
            sourceType: "repository",
            sourceName: "blocked/repo",
            sourceUri: "https://example.com/blocked/repo",
            syncMode: "persisted",
            errorMessage: "Repository blocked"
          },
          now
        )
      ]
    });

    expect(summary).toMatchObject({
      status: "degraded",
      connectorEventCount: 2,
      successfulConnectorCount: 1,
      blockedConnectorCount: 1,
      reliabilityRate: 0.5,
      blockRate: 0.5,
      persistedRate: 0
    });
  });
});

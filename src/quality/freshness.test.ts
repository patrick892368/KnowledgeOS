import { describe, expect, it } from "vitest";

import {
  createBlockedConnectorStatus,
  createConnectorStatusFromIngestion
} from "@/connectors/status";
import { ingestLocalNote } from "@/ingestion/local-note";

import { createSourceFreshnessSummary } from "./freshness";

const baseIngestion = ingestLocalNote({
  organizationId: "org_1",
  createdBy: "user_1",
  title: "Freshness",
  content: "Freshness indicators should rely on aggregate activity timestamps.",
  uri: "https://example.com/freshness"
});

const now = new Date("2026-07-10T00:00:00.000Z");
const freshActivity = new Date("2026-07-09T00:00:00.000Z");
const staleActivity = new Date("2026-05-01T00:00:00.000Z");

describe("createSourceFreshnessSummary", () => {
  it("returns a no-data summary for an empty workspace", () => {
    expect(
      createSourceFreshnessSummary({
        ingestions: [],
        connectorStatuses: [],
        now
      })
    ).toEqual({
      status: "no_data",
      sourceCount: 0,
      connectorEventCount: 0,
      latestActivityAt: undefined,
      staleThresholdDays: 30,
      trackedSourceCount: 0,
      freshSourceCount: 0,
      staleSourceCount: 0,
      unknownSourceCount: 0,
      blockedConnectorCount: 0,
      staleRate: 0
    });
  });

  it("reports fresh sources when recent connector activity exists", () => {
    const summary = createSourceFreshnessSummary({
      ingestions: [baseIngestion],
      connectorStatuses: [
        createConnectorStatusFromIngestion(
          baseIngestion,
          { mode: "request-scoped" },
          freshActivity
        )
      ],
      now
    });

    expect(summary).toMatchObject({
      status: "fresh",
      sourceCount: 1,
      trackedSourceCount: 1,
      freshSourceCount: 1,
      staleSourceCount: 0,
      unknownSourceCount: 0,
      latestActivityAt: freshActivity.toISOString(),
      staleRate: 0
    });
  });

  it("marks old source activity as stale", () => {
    const summary = createSourceFreshnessSummary({
      ingestions: [baseIngestion],
      connectorStatuses: [
        createConnectorStatusFromIngestion(
          baseIngestion,
          { mode: "request-scoped" },
          staleActivity
        )
      ],
      now
    });

    expect(summary).toMatchObject({
      status: "stale",
      trackedSourceCount: 1,
      freshSourceCount: 0,
      staleSourceCount: 1,
      staleRate: 1,
      latestActivityAt: staleActivity.toISOString()
    });
  });

  it("marks blocked connector activity as needing attention", () => {
    const summary = createSourceFreshnessSummary({
      ingestions: [baseIngestion],
      connectorStatuses: [
        createConnectorStatusFromIngestion(
          baseIngestion,
          { mode: "request-scoped" },
          freshActivity
        ),
        createBlockedConnectorStatus(
          {
            sourceType: "url",
            sourceName: "Blocked URL",
            sourceUri: "https://example.com/private?token=secret",
            syncMode: "request_scoped",
            errorMessage: "Fetch failed token=secret"
          },
          freshActivity
        )
      ],
      now
    });

    expect(summary).toMatchObject({
      status: "needs_attention",
      blockedConnectorCount: 1,
      trackedSourceCount: 1,
      staleSourceCount: 0
    });
  });
});

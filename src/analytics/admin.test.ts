import { describe, expect, it } from "vitest";

import { createAdminAnalyticsSummary } from "./admin";

describe("createAdminAnalyticsSummary", () => {
  it("returns no-data when all analytics inputs are missing or empty", () => {
    expect(
      createAdminAnalyticsSummary({
        retrievalQuality: "no_data",
        sourceQuality: "no_data",
        sourceFreshness: "no_data",
        connectorReliability: "no_data",
        workflowMetrics: "no_data",
        operationalReliability: "no_data"
      })
    ).toMatchObject({
      status: "no_data",
      signalCount: 7,
      noDataSignals: 7,
      governanceEventCount: 0,
      permissionViolationCount: 0
    });
  });

  it("returns healthy when quality, workflow, reliability, and governance signals are healthy", () => {
    const summary = createAdminAnalyticsSummary({
      retrievalQuality: "healthy",
      sourceQuality: "healthy",
      sourceFreshness: "fresh",
      connectorReliability: "healthy",
      workflowMetrics: "healthy",
      operationalReliability: "healthy",
      governance: {
        auditEventCount: 4,
        permissionViolationCount: 0,
        highSeverityViolationCount: 0
      }
    });

    expect(summary).toMatchObject({
      status: "healthy",
      healthySignals: 7,
      warningSignals: 0,
      blockedSignals: 0,
      governanceEventCount: 4
    });
  });

  it("returns warning when aggregate analytics need attention but are not blocked", () => {
    const summary = createAdminAnalyticsSummary({
      retrievalQuality: "insufficient_context",
      sourceQuality: "needs_attention",
      sourceFreshness: "stale",
      connectorReliability: "degraded",
      workflowMetrics: "review_heavy",
      operationalReliability: "warning",
      governance: {
        auditEventCount: 8,
        permissionViolationCount: 2,
        highSeverityViolationCount: 0
      }
    });

    expect(summary).toMatchObject({
      status: "warning",
      warningSignals: 7,
      blockedSignals: 0,
      permissionViolationCount: 2
    });
    expect(summary.signals.map((signal) => signal.label)).toEqual([
      "Retrieval quality",
      "Source quality",
      "Source freshness",
      "Connector reliability",
      "Workflow metrics",
      "Operational reliability",
      "Governance risk"
    ]);
  });

  it("returns blocked when unsupported retrieval or high-severity governance risk exists", () => {
    const summary = createAdminAnalyticsSummary({
      retrievalQuality: "needs_review",
      sourceQuality: "healthy",
      sourceFreshness: "fresh",
      connectorReliability: "healthy",
      workflowMetrics: "healthy",
      operationalReliability: "blocked",
      governance: {
        auditEventCount: 10,
        permissionViolationCount: 3,
        highSeverityViolationCount: 1
      }
    });

    expect(summary).toMatchObject({
      status: "blocked",
      blockedSignals: 3,
      highSeverityViolationCount: 1
    });
  });
});

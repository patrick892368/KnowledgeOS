import { describe, expect, it } from "vitest";

import { createOperationalReliabilitySummary } from "./operational-reliability";

describe("createOperationalReliabilitySummary", () => {
  it("returns no-data when every reliability signal has no data", () => {
    expect(
      createOperationalReliabilitySummary({
        sourceQuality: "no_data",
        sourceFreshness: "no_data",
        connectorReliability: "no_data",
        workflowMetrics: "no_data",
        releaseReadiness: "no_data"
      })
    ).toMatchObject({
      status: "no_data",
      signalCount: 5,
      noDataSignals: 5,
      warningSignals: 0
    });
  });

  it("returns healthy when all source, workflow, and release signals are healthy", () => {
    const summary = createOperationalReliabilitySummary({
      sourceQuality: "healthy",
      sourceFreshness: "fresh",
      connectorReliability: "healthy",
      workflowMetrics: "healthy",
      releaseReadiness: "ready"
    });

    expect(summary).toMatchObject({
      status: "healthy",
      healthySignals: 5,
      warningSignals: 0,
      blockedSignals: 0
    });
  });

  it("returns warning for degraded operational signals without release blockers", () => {
    const summary = createOperationalReliabilitySummary({
      sourceQuality: "needs_attention",
      sourceFreshness: "stale",
      connectorReliability: "degraded",
      workflowMetrics: "review_heavy",
      releaseReadiness: "warning"
    });

    expect(summary).toMatchObject({
      status: "warning",
      warningSignals: 5,
      blockedSignals: 0
    });
    expect(summary.signals.map((signal) => signal.label)).toEqual([
      "Source quality",
      "Source freshness",
      "Connector reliability",
      "Workflow metrics",
      "Release readiness"
    ]);
  });

  it("returns blocked when release readiness is blocked", () => {
    expect(
      createOperationalReliabilitySummary({
        sourceQuality: "healthy",
        sourceFreshness: "fresh",
        connectorReliability: "healthy",
        workflowMetrics: "healthy",
        releaseReadiness: "blocked"
      })
    ).toMatchObject({
      status: "blocked",
      healthySignals: 4,
      blockedSignals: 1
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  createKpiTelemetryEvent,
  KpiTelemetryValidationError
} from "./kpi";

describe("createKpiTelemetryEvent", () => {
  it("creates an aggregate-safe KPI telemetry event", () => {
    expect(
      createKpiTelemetryEvent({
        metricName: "Operational Reliability Healthy Rate",
        category: "reliability",
        organizationId: "org_123",
        value: 0.92,
        unit: "ratio",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "local_summary",
        metadata: {
          signalCount: 7,
          blockedSignals: 0,
          localOnly: true
        }
      })
    ).toEqual({
      id: "kpi_operational_reliability_healthy_rate_1783648800000",
      metricName: "Operational Reliability Healthy Rate",
      category: "reliability",
      organizationId: "org_123",
      value: 0.92,
      unit: "ratio",
      capturedAt: "2026-07-10T02:00:00.000Z",
      source: "local_summary",
      metadata: {
        signalCount: 7,
        blockedSignals: 0,
        localOnly: true
      }
    });
  });

  it("rejects unknown categories, units, and sources", () => {
    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Search Success Rate",
        category: "sales",
        organizationId: "org_123",
        value: 1,
        unit: "ratio",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "local_summary"
      })
    ).toThrow(KpiTelemetryValidationError);

    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Search Success Rate",
        category: "product",
        organizationId: "org_123",
        value: 1,
        unit: "dollars",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "local_summary"
      })
    ).toThrow(KpiTelemetryValidationError);

    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Search Success Rate",
        category: "product",
        organizationId: "org_123",
        value: 1,
        unit: "ratio",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "external_stream"
      })
    ).toThrow(KpiTelemetryValidationError);
  });

  it("rejects invalid scope, value, and timestamp", () => {
    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Search Success Rate",
        category: "product",
        organizationId: " ",
        value: 1,
        unit: "ratio",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "local_summary"
      })
    ).toThrow(KpiTelemetryValidationError);

    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Search Success Rate",
        category: "product",
        organizationId: "org_123",
        value: Number.NaN,
        unit: "ratio",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "local_summary"
      })
    ).toThrow(KpiTelemetryValidationError);

    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Search Success Rate",
        category: "product",
        organizationId: "org_123",
        value: 1,
        unit: "ratio",
        capturedAt: "not-a-date",
        source: "local_summary"
      })
    ).toThrow(KpiTelemetryValidationError);
  });

  it("rejects unsafe metadata keys and non-primitive metadata values", () => {
    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Permission Violations",
        category: "governance",
        organizationId: "org_123",
        value: 1,
        unit: "count",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "governance_summary",
        metadata: {
          rawAuditMetadata: "forbidden"
        }
      })
    ).toThrow(KpiTelemetryValidationError);

    expect(() =>
      createKpiTelemetryEvent({
        metricName: "Permission Violations",
        category: "governance",
        organizationId: "org_123",
        value: 1,
        unit: "count",
        capturedAt: "2026-07-10T02:00:00.000Z",
        source: "governance_summary",
        metadata: {
          groupedValues: ["unsafe"]
        }
      })
    ).toThrow(KpiTelemetryValidationError);
  });
});

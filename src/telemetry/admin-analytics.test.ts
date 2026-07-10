import { describe, expect, it } from "vitest";

import { createAdminAnalyticsSummary } from "@/analytics/admin";

import { createAdminAnalyticsKpiTelemetryEvents } from "./admin-analytics";
import { KpiTelemetryValidationError } from "./kpi";

describe("createAdminAnalyticsKpiTelemetryEvents", () => {
  it("maps healthy admin analytics into aggregate-safe KPI telemetry events", () => {
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

    const events = createAdminAnalyticsKpiTelemetryEvents({
      summary,
      organizationId: "org_123",
      capturedAt: "2026-07-10T03:00:00.000Z"
    });

    expect(events).toHaveLength(7);
    expect(events.map((event) => event.metricName)).toEqual([
      "Admin Analytics Health Score",
      "Admin Analytics Healthy Signal Rate",
      "Admin Analytics Blocked Signal Count",
      "Admin Analytics No Data Signal Count",
      "Permission Violation Count",
      "High Severity Permission Violation Count",
      "Governance Event Count"
    ]);
    expect(events[0]).toMatchObject({
      category: "business",
      unit: "score",
      value: 1,
      organizationId: "org_123",
      source: "local_summary",
      metadata: {
        status: "healthy",
        signalCount: 7,
        healthySignals: 7,
        localOnly: true
      }
    });
    expect(events[1]).toMatchObject({
      category: "product",
      unit: "ratio",
      value: 1
    });
  });

  it("maps blocked admin analytics into risk and governance telemetry events", () => {
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

    const events = createAdminAnalyticsKpiTelemetryEvents({
      summary,
      organizationId: "org_123",
      capturedAt: "2026-07-10T03:00:00.000Z"
    });

    expect(events[0]).toMatchObject({
      metricName: "Admin Analytics Health Score",
      value: 0,
      metadata: {
        status: "blocked",
        blockedSignals: 3,
        permissionViolationCount: 3,
        highSeverityViolationCount: 1
      }
    });
    expect(
      events.find(
        (event) => event.metricName === "Permission Violation Count"
      )
    ).toMatchObject({
      category: "governance",
      value: 3,
      unit: "count"
    });
    expect(
      events.find(
        (event) =>
          event.metricName === "High Severity Permission Violation Count"
      )
    ).toMatchObject({
      category: "governance",
      value: 1,
      unit: "count"
    });
  });

  it("maps no-data admin analytics without unsafe telemetry metadata", () => {
    const summary = createAdminAnalyticsSummary({
      retrievalQuality: "no_data",
      sourceQuality: "no_data",
      sourceFreshness: "no_data",
      connectorReliability: "no_data",
      workflowMetrics: "no_data",
      operationalReliability: "no_data"
    });

    const events = createAdminAnalyticsKpiTelemetryEvents({
      summary,
      organizationId: "org_123",
      capturedAt: "2026-07-10T03:00:00.000Z"
    });

    expect(events[0]).toMatchObject({
      value: 0,
      metadata: {
        status: "no_data",
        noDataSignals: 7
      }
    });
    expect(events[1]).toMatchObject({
      metricName: "Admin Analytics Healthy Signal Rate",
      value: 0
    });
    expect(
      events.flatMap((event) => Object.keys(event.metadata))
    ).not.toContain("auditEventCount");
  });

  it("reuses KPI telemetry validation for missing scope and invalid timestamps", () => {
    const summary = createAdminAnalyticsSummary({
      retrievalQuality: "healthy",
      sourceQuality: "healthy",
      sourceFreshness: "fresh",
      connectorReliability: "healthy",
      workflowMetrics: "healthy",
      operationalReliability: "healthy",
      governance: {
        auditEventCount: 1
      }
    });

    expect(() =>
      createAdminAnalyticsKpiTelemetryEvents({
        summary,
        organizationId: " ",
        capturedAt: "2026-07-10T03:00:00.000Z"
      })
    ).toThrow(KpiTelemetryValidationError);

    expect(() =>
      createAdminAnalyticsKpiTelemetryEvents({
        summary,
        organizationId: "org_123",
        capturedAt: "not-a-date"
      })
    ).toThrow(KpiTelemetryValidationError);
  });
});

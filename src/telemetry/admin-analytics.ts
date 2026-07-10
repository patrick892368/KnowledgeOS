import type {
  AdminAnalyticsStatus,
  AdminAnalyticsSummary
} from "@/analytics/admin";

import {
  createKpiTelemetryEvent,
  type KpiTelemetryCategory,
  type KpiTelemetryEvent,
  type KpiTelemetryUnit
} from "./kpi";

export interface AdminAnalyticsKpiTelemetryInput {
  summary: AdminAnalyticsSummary;
  organizationId: string;
  capturedAt: string;
}

interface AdminAnalyticsKpiMetric {
  metricName: string;
  category: KpiTelemetryCategory;
  value: number;
  unit: KpiTelemetryUnit;
}

function statusScore(status: AdminAnalyticsStatus): number {
  return status === "healthy"
    ? 1
    : status === "warning"
      ? 0.66
      : status === "blocked"
        ? 0
        : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function adminAnalyticsMetrics(
  summary: AdminAnalyticsSummary
): AdminAnalyticsKpiMetric[] {
  return [
    {
      metricName: "Admin Analytics Health Score",
      category: "business",
      value: statusScore(summary.status),
      unit: "score"
    },
    {
      metricName: "Admin Analytics Healthy Signal Rate",
      category: "product",
      value: ratio(summary.healthySignals, summary.signalCount),
      unit: "ratio"
    },
    {
      metricName: "Admin Analytics Blocked Signal Count",
      category: "reliability",
      value: summary.blockedSignals,
      unit: "count"
    },
    {
      metricName: "Admin Analytics No Data Signal Count",
      category: "product",
      value: summary.noDataSignals,
      unit: "count"
    },
    {
      metricName: "Permission Violation Count",
      category: "governance",
      value: summary.permissionViolationCount,
      unit: "count"
    },
    {
      metricName: "High Severity Permission Violation Count",
      category: "governance",
      value: summary.highSeverityViolationCount,
      unit: "count"
    },
    {
      metricName: "Governance Event Count",
      category: "governance",
      value: summary.governanceEventCount,
      unit: "count"
    }
  ];
}

export function createAdminAnalyticsKpiTelemetryEvents(
  input: AdminAnalyticsKpiTelemetryInput
): KpiTelemetryEvent[] {
  const metadata = {
    status: input.summary.status,
    signalCount: input.summary.signalCount,
    healthySignals: input.summary.healthySignals,
    warningSignals: input.summary.warningSignals,
    blockedSignals: input.summary.blockedSignals,
    noDataSignals: input.summary.noDataSignals,
    permissionViolationCount: input.summary.permissionViolationCount,
    highSeverityViolationCount: input.summary.highSeverityViolationCount,
    governanceEventCount: input.summary.governanceEventCount,
    localOnly: true
  };

  return adminAnalyticsMetrics(input.summary).map((metric) =>
    createKpiTelemetryEvent({
      metricName: metric.metricName,
      category: metric.category,
      organizationId: input.organizationId,
      value: metric.value,
      unit: metric.unit,
      capturedAt: input.capturedAt,
      source: "local_summary",
      metadata
    })
  );
}

import type { OperationalReliabilityStatus } from "@/quality/operational-reliability";
import type { ConnectorReliabilityStatus } from "@/quality/connector-reliability";
import type { SourceFreshnessStatus } from "@/quality/freshness";
import type { RetrievalQualityStatus } from "@/quality/retrieval";
import type { SourceQualityStatus } from "@/quality/source";
import type { WorkflowMetricsStatus } from "@/workflows/metrics";

export type AdminAnalyticsStatus = "no_data" | "healthy" | "warning" | "blocked";

export type AdminAnalyticsCategory =
  | "knowledge"
  | "governance"
  | "workflow"
  | "reliability";

export interface AdminAnalyticsSignal {
  label: string;
  category: AdminAnalyticsCategory;
  sourceStatus: string;
  status: AdminAnalyticsStatus;
}

export interface AdminAnalyticsSummary {
  status: AdminAnalyticsStatus;
  signalCount: number;
  healthySignals: number;
  warningSignals: number;
  blockedSignals: number;
  noDataSignals: number;
  governanceEventCount: number;
  permissionViolationCount: number;
  highSeverityViolationCount: number;
  signals: AdminAnalyticsSignal[];
}

interface GovernanceAnalyticsInput {
  auditEventCount?: number;
  permissionViolationCount?: number;
  highSeverityViolationCount?: number;
}

function boundedCount(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}

function mapRetrievalQuality(
  status: RetrievalQualityStatus
): AdminAnalyticsStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : status === "needs_review"
        ? "blocked"
        : "warning";
}

function mapSourceQuality(status: SourceQualityStatus): AdminAnalyticsStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapSourceFreshness(status: SourceFreshnessStatus): AdminAnalyticsStatus {
  return status === "fresh"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapConnectorReliability(
  status: ConnectorReliabilityStatus
): AdminAnalyticsStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapWorkflowMetrics(status: WorkflowMetricsStatus): AdminAnalyticsStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapOperationalReliability(
  status: OperationalReliabilityStatus
): AdminAnalyticsStatus {
  return status === "healthy"
    ? "healthy"
    : status === "blocked"
      ? "blocked"
      : status === "warning"
        ? "warning"
        : "no_data";
}

function mapGovernance(input?: GovernanceAnalyticsInput): AdminAnalyticsStatus {
  if (!input) {
    return "no_data";
  }

  const permissionViolationCount = boundedCount(input.permissionViolationCount);
  const highSeverityViolationCount = boundedCount(input.highSeverityViolationCount);
  const auditEventCount = boundedCount(input.auditEventCount);

  if (highSeverityViolationCount > 0) {
    return "blocked";
  }

  if (permissionViolationCount > 0) {
    return "warning";
  }

  return auditEventCount > 0 ? "healthy" : "no_data";
}

function signal(
  label: string,
  category: AdminAnalyticsCategory,
  sourceStatus: string,
  status: AdminAnalyticsStatus
): AdminAnalyticsSignal {
  return {
    label,
    category,
    sourceStatus,
    status
  };
}

export function createAdminAnalyticsSummary(input: {
  retrievalQuality: RetrievalQualityStatus;
  sourceQuality: SourceQualityStatus;
  sourceFreshness: SourceFreshnessStatus;
  connectorReliability: ConnectorReliabilityStatus;
  workflowMetrics: WorkflowMetricsStatus;
  operationalReliability: OperationalReliabilityStatus;
  governance?: GovernanceAnalyticsInput;
}): AdminAnalyticsSummary {
  const governanceEventCount = boundedCount(input.governance?.auditEventCount);
  const permissionViolationCount = boundedCount(
    input.governance?.permissionViolationCount
  );
  const highSeverityViolationCount = boundedCount(
    input.governance?.highSeverityViolationCount
  );
  const governanceStatus = mapGovernance(input.governance);
  const signals = [
    signal(
      "Retrieval quality",
      "knowledge",
      input.retrievalQuality,
      mapRetrievalQuality(input.retrievalQuality)
    ),
    signal(
      "Source quality",
      "knowledge",
      input.sourceQuality,
      mapSourceQuality(input.sourceQuality)
    ),
    signal(
      "Source freshness",
      "knowledge",
      input.sourceFreshness,
      mapSourceFreshness(input.sourceFreshness)
    ),
    signal(
      "Connector reliability",
      "knowledge",
      input.connectorReliability,
      mapConnectorReliability(input.connectorReliability)
    ),
    signal(
      "Workflow metrics",
      "workflow",
      input.workflowMetrics,
      mapWorkflowMetrics(input.workflowMetrics)
    ),
    signal(
      "Operational reliability",
      "reliability",
      input.operationalReliability,
      mapOperationalReliability(input.operationalReliability)
    ),
    signal("Governance risk", "governance", governanceStatus, governanceStatus)
  ];
  const blockedSignals = signals.filter(
    (item) => item.status === "blocked"
  ).length;
  const warningSignals = signals.filter(
    (item) => item.status === "warning"
  ).length;
  const noDataSignals = signals.filter((item) => item.status === "no_data").length;
  const healthySignals = signals.filter(
    (item) => item.status === "healthy"
  ).length;

  return {
    status:
      blockedSignals > 0
        ? "blocked"
        : warningSignals > 0
          ? "warning"
          : noDataSignals === signals.length
            ? "no_data"
            : "healthy",
    signalCount: signals.length,
    healthySignals,
    warningSignals,
    blockedSignals,
    noDataSignals,
    governanceEventCount,
    permissionViolationCount,
    highSeverityViolationCount,
    signals
  };
}

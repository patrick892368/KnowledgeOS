import type { ConnectorReliabilityStatus } from "./connector-reliability";
import type { ReleaseReadinessStatus } from "./release-readiness";
import type { SourceFreshnessStatus } from "./freshness";
import type { SourceQualityStatus } from "./source";
import type { WorkflowMetricsStatus } from "@/workflows/metrics";

export type OperationalReliabilityStatus =
  | "no_data"
  | "healthy"
  | "warning"
  | "blocked";

export interface OperationalReliabilitySignal {
  label: string;
  sourceStatus: string;
  status: OperationalReliabilityStatus;
}

export interface OperationalReliabilitySummary {
  status: OperationalReliabilityStatus;
  signalCount: number;
  healthySignals: number;
  warningSignals: number;
  blockedSignals: number;
  noDataSignals: number;
  signals: OperationalReliabilitySignal[];
}

function mapSourceQuality(status: SourceQualityStatus): OperationalReliabilityStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapSourceFreshness(
  status: SourceFreshnessStatus
): OperationalReliabilityStatus {
  return status === "fresh"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapConnectorReliability(
  status: ConnectorReliabilityStatus
): OperationalReliabilityStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapWorkflowMetrics(
  status: WorkflowMetricsStatus
): OperationalReliabilityStatus {
  return status === "healthy"
    ? "healthy"
    : status === "no_data"
      ? "no_data"
      : "warning";
}

function mapReleaseReadiness(
  status: ReleaseReadinessStatus | "no_data"
): OperationalReliabilityStatus {
  return status === "no_data"
    ? "no_data"
    : status === "ready"
    ? "healthy"
    : status === "blocked"
      ? "blocked"
      : "warning";
}

function signal(
  label: string,
  sourceStatus: string,
  status: OperationalReliabilityStatus
): OperationalReliabilitySignal {
  return {
    label,
    sourceStatus,
    status
  };
}

export function createOperationalReliabilitySummary(input: {
  sourceQuality: SourceQualityStatus;
  sourceFreshness: SourceFreshnessStatus;
  connectorReliability: ConnectorReliabilityStatus;
  workflowMetrics: WorkflowMetricsStatus;
  releaseReadiness: ReleaseReadinessStatus | "no_data";
}): OperationalReliabilitySummary {
  const signals = [
    signal(
      "Source quality",
      input.sourceQuality,
      mapSourceQuality(input.sourceQuality)
    ),
    signal(
      "Source freshness",
      input.sourceFreshness,
      mapSourceFreshness(input.sourceFreshness)
    ),
    signal(
      "Connector reliability",
      input.connectorReliability,
      mapConnectorReliability(input.connectorReliability)
    ),
    signal(
      "Workflow metrics",
      input.workflowMetrics,
      mapWorkflowMetrics(input.workflowMetrics)
    ),
    signal(
      "Release readiness",
      input.releaseReadiness,
      mapReleaseReadiness(input.releaseReadiness)
    )
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
    signals
  };
}

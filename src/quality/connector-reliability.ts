import type { ConnectorStatus } from "@/connectors/status";

export type ConnectorReliabilityStatus = "no_data" | "healthy" | "degraded";

export interface ConnectorReliabilitySummary {
  status: ConnectorReliabilityStatus;
  connectorEventCount: number;
  successfulConnectorCount: number;
  blockedConnectorCount: number;
  requestScopedConnectorCount: number;
  persistedConnectorCount: number;
  reliabilityRate: number;
  blockRate: number;
  persistedRate: number;
  latestActivityAt?: string;
}

function activityTime(value: string): number | undefined {
  const parsed = new Date(value).getTime();

  return Number.isNaN(parsed) ? undefined : parsed;
}

export function createConnectorReliabilitySummary(input: {
  connectorStatuses: readonly ConnectorStatus[];
}): ConnectorReliabilitySummary {
  const connectorEventCount = input.connectorStatuses.length;
  const blockedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "blocked"
  ).length;
  const requestScopedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "request_scoped"
  ).length;
  const persistedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "synced"
  ).length;
  const successfulConnectorCount =
    requestScopedConnectorCount + persistedConnectorCount;
  const reliabilityRate =
    connectorEventCount === 0
      ? 0
      : successfulConnectorCount / connectorEventCount;
  const blockRate =
    connectorEventCount === 0
      ? 0
      : blockedConnectorCount / connectorEventCount;
  const persistedRate =
    connectorEventCount === 0
      ? 0
      : persistedConnectorCount / connectorEventCount;
  const latest = input.connectorStatuses
    .map((status) => ({
      at: status.lastActivityAt,
      time: activityTime(status.lastActivityAt)
    }))
    .filter((status): status is { at: string; time: number } => {
      return status.time !== undefined;
    })
    .sort((left, right) => right.time - left.time)[0];
  const status =
    connectorEventCount === 0
      ? "no_data"
      : blockedConnectorCount > 0
        ? "degraded"
        : "healthy";

  return {
    status,
    connectorEventCount,
    successfulConnectorCount,
    blockedConnectorCount,
    requestScopedConnectorCount,
    persistedConnectorCount,
    reliabilityRate,
    blockRate,
    persistedRate,
    latestActivityAt: latest?.at
  };
}

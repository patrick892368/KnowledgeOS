import type { ConnectorStatus } from "@/connectors/status";
import type { NormalizedIngestionResult } from "@/ingestion/types";

export type SourceQualityStatus = "no_data" | "healthy" | "needs_attention";

export interface SourceQualitySummary {
  status: SourceQualityStatus;
  sourceCount: number;
  chunkCount: number;
  citationCount: number;
  citationCoverage: number;
  connectorEventCount: number;
  blockedConnectorCount: number;
  connectorBlockRate: number;
  persistedConnectorCount: number;
  requestScopedConnectorCount: number;
}

export function createSourceQualitySummary(input: {
  ingestions: readonly NormalizedIngestionResult[];
  connectorStatuses: readonly ConnectorStatus[];
}): SourceQualitySummary {
  const sourceCount = input.ingestions.length;
  const chunkCount = input.ingestions.reduce(
    (total, ingestion) => total + ingestion.chunks.length,
    0
  );
  const citationCount = input.ingestions.reduce(
    (total, ingestion) => total + ingestion.citations.length,
    0
  );
  const connectorEventCount = input.connectorStatuses.length;
  const blockedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "blocked"
  ).length;
  const persistedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "synced"
  ).length;
  const requestScopedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "request_scoped"
  ).length;
  const citationCoverage =
    chunkCount === 0 ? 0 : Math.min(citationCount / chunkCount, 1);
  const connectorBlockRate =
    connectorEventCount === 0 ? 0 : blockedConnectorCount / connectorEventCount;
  const status =
    sourceCount === 0 && connectorEventCount === 0
      ? "no_data"
      : blockedConnectorCount > 0 || citationCoverage < 1
        ? "needs_attention"
        : "healthy";

  return {
    status,
    sourceCount,
    chunkCount,
    citationCount,
    citationCoverage,
    connectorEventCount,
    blockedConnectorCount,
    connectorBlockRate,
    persistedConnectorCount,
    requestScopedConnectorCount
  };
}

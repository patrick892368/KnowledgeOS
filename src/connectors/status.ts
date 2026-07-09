import type { SourceType } from "@/db/model";
import type { NormalizedIngestionResult } from "@/ingestion/types";

export type ConnectorSyncMode = "request_scoped" | "persisted";
export type ConnectorStatusOutcome = "request_scoped" | "synced" | "blocked";

export interface ConnectorPersistenceSummary {
  mode: "request-scoped" | "postgres";
  chunkIds?: string[];
  embeddingIds?: string[];
  embeddingModel?: string;
}

export interface ConnectorStatus {
  id: string;
  sourceType: SourceType;
  sourceName: string;
  sourceUri?: string;
  syncMode: ConnectorSyncMode;
  outcome: ConnectorStatusOutcome;
  lastActivityAt: string;
  message: string;
  safeError?: string;
  metadata: {
    chunks?: number;
    vectors?: number;
    embeddingModel?: string;
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

export function sanitizeConnectorUri(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);

    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return undefined;
  }
}

export function sanitizeConnectorError(message: string): string {
  const firstLine = message.split(/\r?\n/)[0]?.trim() || "Connector failed.";
  const withoutQuerySecrets = firstLine
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[redacted]")
    .replace(
      /\b(token|secret|password|api_key|apikey|access_token)=([^&\s]+)/gi,
      "$1=[redacted]"
    )
    .replace(/\bat\s+[\w.<>]+\s*\(.+\)/g, "")
    .trim();

  return truncate(withoutQuerySecrets || "Connector failed.", 180);
}

function statusId(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("|");
}

export function createConnectorStatusFromIngestion(
  ingestion: NormalizedIngestionResult,
  persistence: ConnectorPersistenceSummary,
  now = new Date()
): ConnectorStatus {
  const persisted = persistence.mode === "postgres";
  const chunks = ingestion.chunks.length;
  const vectors = persistence.embeddingIds?.length ?? 0;
  const sourceUri = sanitizeConnectorUri(
    ingestion.source.uri ?? ingestion.document.uri
  );

  return {
    id: statusId([
      ingestion.source.type,
      ingestion.source.name,
      ingestion.document.contentHash,
      now.toISOString()
    ]),
    sourceType: ingestion.source.type,
    sourceName: ingestion.source.name,
    sourceUri,
    syncMode: persisted ? "persisted" : "request_scoped",
    outcome: persisted ? "synced" : "request_scoped",
    lastActivityAt: now.toISOString(),
    message: persisted
      ? `${chunks} chunks and ${vectors} vectors persisted.`
      : `${chunks} chunks available in the current workspace only.`,
    metadata: {
      chunks,
      vectors,
      embeddingModel: persistence.embeddingModel
    }
  };
}

export function createBlockedConnectorStatus(
  input: {
    sourceType: SourceType;
    sourceName: string;
    sourceUri?: string;
    syncMode: ConnectorSyncMode;
    errorMessage: string;
  },
  now = new Date()
): ConnectorStatus {
  const safeError = sanitizeConnectorError(input.errorMessage);

  return {
    id: statusId([
      input.sourceType,
      input.sourceName,
      "blocked",
      now.toISOString()
    ]),
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    sourceUri: sanitizeConnectorUri(input.sourceUri),
    syncMode: input.syncMode,
    outcome: "blocked",
    lastActivityAt: now.toISOString(),
    message: safeError,
    safeError,
    metadata: {}
  };
}

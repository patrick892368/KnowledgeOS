import type { ConnectorStatus } from "@/connectors/status";
import type { NormalizedIngestionResult } from "@/ingestion/types";

export type SourceFreshnessStatus =
  | "no_data"
  | "fresh"
  | "stale"
  | "needs_attention";

export interface SourceFreshnessSummary {
  status: SourceFreshnessStatus;
  sourceCount: number;
  connectorEventCount: number;
  latestActivityAt?: string;
  staleThresholdDays: number;
  trackedSourceCount: number;
  freshSourceCount: number;
  staleSourceCount: number;
  unknownSourceCount: number;
  blockedConnectorCount: number;
  staleRate: number;
}

interface FreshnessRecord {
  isSource: boolean;
  lastActivityAt?: string;
  lastActivityTime?: number;
  blocked: boolean;
}

const defaultStaleThresholdDays = 30;
const activityMetadataKeys = [
  "lastActivityAt",
  "lastSyncedAt",
  "updatedAt",
  "fetchedAt",
  "resolvedAt",
  "createdAt"
];

function sourceKey(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("|");
}

function ingestionKey(ingestion: NormalizedIngestionResult): string {
  return sourceKey([
    ingestion.source.type,
    ingestion.source.name,
    ingestion.source.uri ?? ingestion.document.uri ?? ingestion.document.contentHash
  ]);
}

function connectorKey(status: ConnectorStatus): string {
  return sourceKey([status.sourceType, status.sourceName, status.sourceUri]);
}

function parseActivityTime(value: unknown): { iso: string; time: number } | undefined {
  if (value instanceof Date) {
    const time = value.getTime();

    return Number.isNaN(time) ? undefined : { iso: value.toISOString(), time };
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);
  const time = parsed.getTime();

  return Number.isNaN(time) ? undefined : { iso: parsed.toISOString(), time };
}

function metadataActivityAt(
  ...metadataRecords: Array<Record<string, unknown>>
): { iso: string; time: number } | undefined {
  for (const metadata of metadataRecords) {
    for (const key of activityMetadataKeys) {
      const parsed = parseActivityTime(metadata[key]);

      if (parsed) {
        return parsed;
      }
    }
  }

  return undefined;
}

function upsertActivity(
  records: Map<string, FreshnessRecord>,
  key: string,
  input: {
    isSource?: boolean;
    activity?: { iso: string; time: number };
    blocked?: boolean;
  }
): void {
  const current = records.get(key) ?? {
    isSource: false,
    blocked: false
  };
  const next: FreshnessRecord = {
    ...current,
    isSource: current.isSource || Boolean(input.isSource),
    blocked: current.blocked || Boolean(input.blocked)
  };

  if (
    input.activity &&
    (next.lastActivityTime === undefined ||
      input.activity.time > next.lastActivityTime)
  ) {
    next.lastActivityAt = input.activity.iso;
    next.lastActivityTime = input.activity.time;
  }

  records.set(key, next);
}

export function createSourceFreshnessSummary(input: {
  ingestions: readonly NormalizedIngestionResult[];
  connectorStatuses: readonly ConnectorStatus[];
  now?: Date;
  staleThresholdDays?: number;
}): SourceFreshnessSummary {
  const records = new Map<string, FreshnessRecord>();
  const staleThresholdDays =
    input.staleThresholdDays ?? defaultStaleThresholdDays;
  const staleBefore =
    (input.now ?? new Date()).getTime() -
    staleThresholdDays * 24 * 60 * 60 * 1000;

  for (const ingestion of input.ingestions) {
    upsertActivity(records, ingestionKey(ingestion), {
      isSource: true,
      activity: metadataActivityAt(
        ingestion.source.metadata,
        ingestion.document.metadata
      )
    });
  }

  for (const status of input.connectorStatuses) {
    upsertActivity(records, connectorKey(status), {
      activity: parseActivityTime(status.lastActivityAt),
      blocked: status.outcome === "blocked"
    });
  }

  const sourceRecords = [...records.values()].filter((record) => record.isSource);
  const sourceRecordsWithActivity = sourceRecords.filter(
    (record) => record.lastActivityTime !== undefined
  );
  const staleSourceCount = sourceRecordsWithActivity.filter(
    (record) => record.lastActivityTime !== undefined && record.lastActivityTime < staleBefore
  ).length;
  const freshSourceCount = sourceRecordsWithActivity.length - staleSourceCount;
  const blockedConnectorCount = input.connectorStatuses.filter(
    (status) => status.outcome === "blocked"
  ).length;
  const latest = [...records.values()]
    .filter(
      (record): record is FreshnessRecord & { lastActivityAt: string; lastActivityTime: number } =>
        record.lastActivityAt !== undefined && record.lastActivityTime !== undefined
    )
    .sort((left, right) => right.lastActivityTime - left.lastActivityTime)[0];
  const unknownSourceCount =
    sourceRecords.length - sourceRecordsWithActivity.length;
  const staleRate =
    sourceRecordsWithActivity.length === 0
      ? 0
      : staleSourceCount / sourceRecordsWithActivity.length;
  const status =
    input.ingestions.length === 0 && input.connectorStatuses.length === 0
      ? "no_data"
      : blockedConnectorCount > 0 || unknownSourceCount > 0
        ? "needs_attention"
        : staleSourceCount > 0
          ? "stale"
          : "fresh";

  return {
    status,
    sourceCount: input.ingestions.length,
    connectorEventCount: input.connectorStatuses.length,
    latestActivityAt: latest?.lastActivityAt,
    staleThresholdDays,
    trackedSourceCount: sourceRecordsWithActivity.length,
    freshSourceCount,
    staleSourceCount,
    unknownSourceCount,
    blockedConnectorCount,
    staleRate
  };
}

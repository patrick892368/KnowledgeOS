import { desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import { canManageKpiTelemetry } from "@/db/model";
import {
  createKpiTelemetryEvent,
  KpiTelemetryValidationError,
  type KpiTelemetryEvent,
  type KpiTelemetryEventInput,
  type KpiTelemetryMetadataValue
} from "@/telemetry/kpi";

import type { Database } from "./client";
import { kpiTelemetryEvents } from "./schema";

export type KpiTelemetryPersistenceMode = "created" | "existing";
export type KpiTelemetryPersistenceErrorCode =
  | "forbidden"
  | "cross_scope"
  | "database_unavailable"
  | "invalid_payload";

export class KpiTelemetryPersistenceError extends Error {
  constructor(
    public readonly code: KpiTelemetryPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "KpiTelemetryPersistenceError";
  }
}

export interface PersistedKpiTelemetryEvent {
  id: string;
  organizationId: string;
  metricName: string;
  category: KpiTelemetryEvent["category"];
  value: number;
  unit: KpiTelemetryEvent["unit"];
  capturedAt: Date;
  source: KpiTelemetryEvent["source"];
  metadata: Record<string, KpiTelemetryMetadataValue>;
  createdAt: Date;
}

export interface KpiTelemetryPersistenceResult {
  mode: KpiTelemetryPersistenceMode;
  event: PersistedKpiTelemetryEvent;
}

const kpiTelemetrySelection = {
  id: kpiTelemetryEvents.id,
  organizationId: kpiTelemetryEvents.organizationId,
  metricName: kpiTelemetryEvents.metricName,
  category: kpiTelemetryEvents.category,
  value: kpiTelemetryEvents.value,
  unit: kpiTelemetryEvents.unit,
  capturedAt: kpiTelemetryEvents.capturedAt,
  source: kpiTelemetryEvents.source,
  metadata: kpiTelemetryEvents.metadata,
  createdAt: kpiTelemetryEvents.createdAt
};

type KpiTelemetryEventRow = typeof kpiTelemetryEvents.$inferSelect;

function toPersistedKpiTelemetryEvent(
  row: KpiTelemetryEventRow
): PersistedKpiTelemetryEvent {
  return {
    ...row,
    metadata: row.metadata as Record<string, KpiTelemetryMetadataValue>
  };
}

function boundedLimit(value: number | undefined): number {
  return Math.min(100, Math.max(1, Math.floor(value ?? 50)));
}

function assertKpiTelemetryManager(session: AuthSession) {
  if (!canManageKpiTelemetry(session.role)) {
    throw new KpiTelemetryPersistenceError(
      "forbidden",
      "Only owner or admin members can manage KPI telemetry."
    );
  }
}

function assertEventScope(session: AuthSession, event: KpiTelemetryEvent) {
  if (event.organizationId !== session.organizationId) {
    throw new KpiTelemetryPersistenceError(
      "cross_scope",
      "KPI telemetry event organization must match the current session."
    );
  }
}

export async function persistKpiTelemetryEvent(
  db: Database,
  input: {
    session: AuthSession;
    event: KpiTelemetryEventInput;
  }
): Promise<KpiTelemetryPersistenceResult> {
  assertKpiTelemetryManager(input.session);

  const event = createKpiTelemetryEvent(input.event);

  assertEventScope(input.session, event);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(kpiTelemetryEvents)
      .values({
        id: event.id,
        organizationId: event.organizationId,
        metricName: event.metricName,
        category: event.category,
        value: event.value,
        unit: event.unit,
        capturedAt: new Date(event.capturedAt),
        source: event.source,
        metadata: event.metadata
      })
      .onConflictDoNothing({
        target: kpiTelemetryEvents.id
      })
      .returning(kpiTelemetrySelection);

    const mode: KpiTelemetryPersistenceMode = inserted ? "created" : "existing";
    const persisted =
      inserted ??
      (
        await tx
          .select(kpiTelemetrySelection)
          .from(kpiTelemetryEvents)
          .where(eq(kpiTelemetryEvents.id, event.id))
          .limit(1)
      )[0];

    if (!persisted) {
      throw new Error("KPI telemetry persistence state could not be resolved.");
    }

    return {
      mode,
      event: toPersistedKpiTelemetryEvent(persisted)
    };
  });
}

export async function listOrganizationKpiTelemetryEvents(
  db: Database,
  input: {
    session: AuthSession;
    limit?: number;
  }
): Promise<PersistedKpiTelemetryEvent[]> {
  assertKpiTelemetryManager(input.session);

  return db
    .select(kpiTelemetrySelection)
    .from(kpiTelemetryEvents)
    .where(eq(kpiTelemetryEvents.organizationId, input.session.organizationId))
    .orderBy(desc(kpiTelemetryEvents.capturedAt))
    .limit(boundedLimit(input.limit))
    .then((events) => events.map(toPersistedKpiTelemetryEvent));
}

export { KpiTelemetryValidationError };

import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { KpiTelemetryValidationError } from "@/telemetry/kpi";

import type { Database } from "./client";
import {
  KpiTelemetryPersistenceError,
  listOrganizationKpiTelemetryEvents,
  persistKpiTelemetryEvent
} from "./kpi-telemetry-repository";
import { kpiTelemetryEvents } from "./schema";

const ownerSession: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const telemetryInput = {
  metricName: "Admin Analytics Health Score",
  category: "business",
  organizationId: ownerSession.organizationId,
  value: 1,
  unit: "score",
  capturedAt: "2026-07-10T02:30:00.000Z",
  source: "local_summary",
  metadata: {
    status: "healthy",
    signalCount: 7,
    localOnly: true
  }
};

const telemetryRow = {
  id: "kpi_admin_analytics_health_score_1783650600000",
  organizationId: ownerSession.organizationId,
  metricName: "Admin Analytics Health Score",
  category: "business" as const,
  value: 1,
  unit: "score" as const,
  capturedAt: new Date("2026-07-10T02:30:00.000Z"),
  source: "local_summary" as const,
  metadata: {
    status: "healthy",
    signalCount: 7,
    localOnly: true
  },
  createdAt: new Date("2026-07-10T02:31:00.000Z")
};

function createPersistenceDatabaseDouble(input: {
  insertedRows: unknown[];
  existingRows?: unknown[];
}) {
  const insertReturning = vi.fn(async () => input.insertedRows);
  const onConflictDoNothing = vi.fn(() => ({
    returning: insertReturning
  }));
  const eventValues = vi.fn(() => ({
    onConflictDoNothing
  }));
  const limit = vi.fn(async () => input.existingRows ?? []);
  const where = vi.fn(() => ({
    limit
  }));
  const from = vi.fn(() => ({
    where
  }));
  const select = vi.fn(() => ({
    from
  }));
  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === kpiTelemetryEvents) {
        return {
          values: eventValues
        };
      }

      throw new Error("Unexpected insert table.");
    }),
    select
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx)
    )
  };

  return {
    db: db as unknown as Database,
    eventValues,
    insertReturning,
    onConflictDoNothing,
    select
  };
}

function createListDatabaseDouble(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({
    limit
  }));
  const where = vi.fn(() => ({
    orderBy
  }));
  const from = vi.fn(() => ({
    where
  }));
  const select = vi.fn(() => ({
    from
  }));

  return {
    db: {
      select
    } as unknown as Database,
    limit,
    where,
    orderBy
  };
}

describe("persistKpiTelemetryEvent", () => {
  it("persists a validated scoped KPI telemetry event", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: [telemetryRow]
    });

    const result = await persistKpiTelemetryEvent(db.db, {
      session: ownerSession,
      event: telemetryInput
    });

    expect(result).toMatchObject({
      mode: "created",
      event: telemetryRow
    });
    expect(db.eventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: telemetryRow.id,
        organizationId: ownerSession.organizationId,
        metricName: "Admin Analytics Health Score",
        category: "business",
        value: 1,
        unit: "score",
        source: "local_summary",
        metadata: {
          status: "healthy",
          signalCount: 7,
          localOnly: true
        }
      })
    );
  });

  it("handles duplicate KPI telemetry events idempotently", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: [],
      existingRows: [telemetryRow]
    });

    const result = await persistKpiTelemetryEvent(db.db, {
      session: ownerSession,
      event: telemetryInput
    });

    expect(result).toMatchObject({
      mode: "existing",
      event: telemetryRow
    });
    expect(db.select).toHaveBeenCalled();
  });

  it("rejects unsafe telemetry metadata before opening a transaction", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: []
    });

    await expect(
      persistKpiTelemetryEvent(db.db, {
        session: ownerSession,
        event: {
          ...telemetryInput,
          metadata: {
            rawAuditMetadata: "unsafe"
          }
        }
      })
    ).rejects.toThrow(KpiTelemetryValidationError);
    expect(db.eventValues).not.toHaveBeenCalled();
  });

  it("rejects cross-organization telemetry before opening a transaction", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: []
    });

    await expect(
      persistKpiTelemetryEvent(db.db, {
        session: ownerSession,
        event: {
          ...telemetryInput,
          organizationId: "99999999-9999-4999-8999-999999999999"
        }
      })
    ).rejects.toThrow(KpiTelemetryPersistenceError);
    expect(db.eventValues).not.toHaveBeenCalled();
  });

  it("rejects non-manager persistence before opening a transaction", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: []
    });

    await expect(
      persistKpiTelemetryEvent(db.db, {
        session: {
          ...ownerSession,
          role: "viewer"
        },
        event: telemetryInput
      })
    ).rejects.toThrow(KpiTelemetryPersistenceError);
    expect(db.eventValues).not.toHaveBeenCalled();
  });
});

describe("listOrganizationKpiTelemetryEvents", () => {
  it("lists current-organization KPI telemetry events with a bounded limit", async () => {
    const db = createListDatabaseDouble([telemetryRow]);

    await expect(
      listOrganizationKpiTelemetryEvents(db.db, {
        session: ownerSession,
        limit: 250
      })
    ).resolves.toEqual([telemetryRow]);

    expect(db.where).toHaveBeenCalled();
    expect(db.orderBy).toHaveBeenCalled();
    expect(db.limit).toHaveBeenCalledWith(100);
  });

  it("rejects non-manager listing before querying the database", async () => {
    const db = createListDatabaseDouble([]);

    await expect(
      listOrganizationKpiTelemetryEvents(db.db, {
        session: {
          ...ownerSession,
          role: "viewer"
        }
      })
    ).rejects.toThrow(KpiTelemetryPersistenceError);
    expect(db.where).not.toHaveBeenCalled();
  });
});

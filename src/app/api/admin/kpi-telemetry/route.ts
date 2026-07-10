import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import {
  KpiTelemetryPersistenceError,
  listOrganizationKpiTelemetryEvents,
  persistKpiTelemetryEvent,
  type PersistedKpiTelemetryEvent
} from "@/db/kpi-telemetry-repository";
import {
  KpiTelemetryValidationError,
  type KpiTelemetryEventInput
} from "@/telemetry/kpi";

function toDatabaseUnavailableError(error: unknown): KpiTelemetryPersistenceError {
  return new KpiTelemetryPersistenceError(
    "database_unavailable",
    error instanceof Error
      ? error.message
      : "KPI telemetry database is unavailable."
  );
}

function telemetryErrorResponse(
  error: KpiTelemetryPersistenceError | KpiTelemetryValidationError
) {
  const status =
    error instanceof KpiTelemetryValidationError ||
    error.code === "invalid_payload"
      ? 400
      : error.code === "database_unavailable"
        ? 503
        : 403;

  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.code === "database_unavailable"
      }
    },
    { status }
  );
}

function serializeEvent(event: PersistedKpiTelemetryEvent) {
  return {
    id: event.id,
    organizationId: event.organizationId,
    metricName: event.metricName,
    category: event.category,
    value: event.value,
    unit: event.unit,
    capturedAt: event.capturedAt.toISOString(),
    source: event.source,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString()
  };
}

function parseLimit(request: Request): number | undefined {
  const value = new URL(request.url).searchParams.get("limit");

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new KpiTelemetryPersistenceError(
      "invalid_payload",
      "Limit must be a finite number."
    );
  }

  return parsed;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const limit = parseLimit(request);

    try {
      const events = await listOrganizationKpiTelemetryEvents(
        createDatabaseClient(),
        {
          session,
          limit
        }
      );

      return Response.json({
        events: events.map(serializeEvent)
      });
    } catch (error) {
      if (error instanceof KpiTelemetryPersistenceError) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (
      error instanceof KpiTelemetryPersistenceError ||
      error instanceof KpiTelemetryValidationError
    ) {
      return telemetryErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: KpiTelemetryEventInput;

    try {
      payload = (await request.json()) as KpiTelemetryEventInput;
    } catch {
      throw new KpiTelemetryPersistenceError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    try {
      const result = await persistKpiTelemetryEvent(createDatabaseClient(), {
        session,
        event: payload
      });

      return Response.json(
        {
          mode: result.mode,
          event: serializeEvent(result.event)
        },
        { status: result.mode === "created" ? 201 : 200 }
      );
    } catch (error) {
      if (
        error instanceof KpiTelemetryPersistenceError ||
        error instanceof KpiTelemetryValidationError
      ) {
        throw error;
      }

      throw toDatabaseUnavailableError(error);
    }
  } catch (error) {
    if (
      error instanceof KpiTelemetryPersistenceError ||
      error instanceof KpiTelemetryValidationError
    ) {
      return telemetryErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

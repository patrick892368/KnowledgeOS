import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import { persistIngestionResult } from "@/db/ingestion-repository";
import { IngestionError, ingestionErrorResponse } from "@/ingestion/errors";
import type { NormalizedIngestionResult } from "@/ingestion/types";
import { ingestUrl, parseUrlIngestionPayload } from "@/ingestion/url";

function shouldPersist(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    "persist" in payload &&
    payload.persist === true
  );
}

async function persistIfRequested(
  payload: unknown,
  ingestion: NormalizedIngestionResult
) {
  if (!shouldPersist(payload)) {
    return null;
  }

  try {
    return await persistIngestionResult(createDatabaseClient(), ingestion);
  } catch (error) {
    throw new IngestionError(
      "persistence_unavailable",
      error instanceof Error
        ? error.message
        : "Database persistence is unavailable."
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new IngestionError("invalid_json", "Request body must be valid JSON.");
    }

    const input = parseUrlIngestionPayload(payload, {
      organizationId: session.organizationId,
      createdBy: session.userId
    });
    const ingestion = await ingestUrl(input);
    const persistence = await persistIfRequested(payload, ingestion);

    return Response.json(
      {
        ingestion,
        persistence: persistence
          ? {
              mode: "postgres",
              ...persistence
            }
          : {
              mode: "request-scoped"
            }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof IngestionError) {
      return ingestionErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

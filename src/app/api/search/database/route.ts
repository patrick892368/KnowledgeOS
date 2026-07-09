import { authErrorResponse, requireSession } from "@/auth/session";
import { createDatabaseClient } from "@/db/client";
import { searchPersistedKnowledge } from "@/db/search-repository";
import { SearchError, searchErrorResponse } from "@/search/errors";

function readSearchPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new SearchError("invalid_payload", "Request body must be an object.");
  }

  const query = "query" in payload && typeof payload.query === "string"
    ? payload.query.trim()
    : "";
  const limit = "limit" in payload && typeof payload.limit === "number"
    ? payload.limit
    : undefined;

  if (!query) {
    throw new SearchError("empty_query", "A search query is required.");
  }

  return {
    query,
    limit
  };
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new SearchError("invalid_payload", "Request body must be valid JSON.");
    }

    return Response.json({
      search: await searchPersistedKnowledge(createDatabaseClient(), {
        session,
        ...readSearchPayload(payload)
      })
    });
  } catch (error) {
    if (error instanceof SearchError) {
      return searchErrorResponse(error);
    }

    const authResponse = authErrorResponse(error);

    if (authResponse.status !== 500) {
      return authResponse;
    }

    return searchErrorResponse(
      new SearchError(
        "database_unavailable",
        error instanceof Error
          ? error.message
          : "Database-backed search is unavailable."
      )
    );
  }
}

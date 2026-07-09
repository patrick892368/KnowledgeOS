export type SearchErrorCode =
  | "invalid_payload"
  | "empty_query"
  | "empty_corpus"
  | "organization_mismatch"
  | "database_unavailable";

export class SearchError extends Error {
  constructor(
    public readonly code: SearchErrorCode,
    message: string,
    public readonly recoverable = true
  ) {
    super(message);
    this.name = "SearchError";
  }
}

export function searchErrorResponse(error: SearchError): Response {
  const status = error.code === "database_unavailable" ? 503 : 400;

  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable
      }
    },
    { status }
  );
}

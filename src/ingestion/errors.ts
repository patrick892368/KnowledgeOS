export type IngestionErrorCode =
  | "invalid_json"
  | "invalid_payload"
  | "invalid_repository"
  | "invalid_url"
  | "unsafe_url"
  | "fetch_failed"
  | "unsupported_content_type"
  | "empty_title"
  | "empty_content"
  | "persistence_unavailable";

export class IngestionError extends Error {
  constructor(
    public readonly code: IngestionErrorCode,
    message: string,
    public readonly recoverable = true
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

export function ingestionErrorResponse(error: IngestionError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable
      }
    },
    { status: 400 }
  );
}

import { authErrorResponse, requireSession } from "@/auth/session";
import { SearchError, searchErrorResponse } from "@/search/errors";
import { parseLocalSearchPayload, searchLocalCorpus } from "@/search/local-search";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new SearchError("invalid_payload", "Request body must be valid JSON.");
    }

    const input = parseLocalSearchPayload(payload, session.organizationId);

    return Response.json({
      search: searchLocalCorpus(input)
    });
  } catch (error) {
    if (error instanceof SearchError) {
      return searchErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

import type { NormalizedIngestionResult } from "@/ingestion/types";

import { SearchError } from "./errors";
import type {
  LocalSearchInput,
  LocalSearchResponse,
  LocalSearchResult
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function scoreChunk(queryTokens: string[], title: string, content: string) {
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.toLowerCase();

  return queryTokens.reduce((score, token) => {
    const titleHit = lowerTitle.includes(token) ? 3 : 0;
    const contentHit = lowerContent.includes(token) ? 1 : 0;
    return score + titleHit + contentHit;
  }, 0);
}

function createSnippet(content: string, queryTokens: string[], maxLength = 220) {
  const lowerContent = content.toLowerCase();
  const firstHit = queryTokens
    .map((token) => lowerContent.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const start =
    firstHit === undefined ? 0 : Math.max(0, firstHit - Math.floor(maxLength / 3));
  const snippet = content.slice(start, start + maxLength).trim();

  return `${start > 0 ? "... " : ""}${snippet}${
    start + maxLength < content.length ? " ..." : ""
  }`;
}

function validateCorpusItem(value: unknown): value is NormalizedIngestionResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.organizationId === "string" &&
    isRecord(value.source) &&
    isRecord(value.document) &&
    Array.isArray(value.chunks) &&
    Array.isArray(value.citations)
  );
}

export function parseLocalSearchPayload(
  payload: unknown,
  organizationId: string
): LocalSearchInput {
  if (!isRecord(payload)) {
    throw new SearchError("invalid_payload", "Request body must be an object.");
  }

  const query = typeof payload.query === "string" ? payload.query.trim() : "";

  if (!query) {
    throw new SearchError("empty_query", "A search query is required.");
  }

  if (!Array.isArray(payload.corpus) || payload.corpus.length === 0) {
    throw new SearchError(
      "empty_corpus",
      "A non-empty normalized ingestion corpus is required."
    );
  }

  if (!payload.corpus.every(validateCorpusItem)) {
    throw new SearchError(
      "invalid_payload",
      "Corpus must contain normalized local ingestion results."
    );
  }

  const corpus = payload.corpus;

  if (corpus.some((item) => item.organizationId !== organizationId)) {
    throw new SearchError(
      "organization_mismatch",
      "Search corpus must belong to the current organization.",
      false
    );
  }

  const limit =
    typeof payload.limit === "number" && Number.isInteger(payload.limit)
      ? Math.min(Math.max(payload.limit, 1), 20)
      : undefined;

  return {
    organizationId,
    query,
    corpus,
    limit
  };
}

export function searchLocalCorpus(input: LocalSearchInput): LocalSearchResponse {
  const queryTokens = tokenize(input.query);

  if (queryTokens.length === 0) {
    throw new SearchError("empty_query", "A searchable query is required.");
  }

  const results: LocalSearchResult[] = [];
  let searchedChunks = 0;

  for (const ingestion of input.corpus) {
    for (const chunk of ingestion.chunks) {
      searchedChunks += 1;
      const score = scoreChunk(queryTokens, ingestion.document.title, chunk.content);

      if (score <= 0) {
        continue;
      }

      const citation = ingestion.citations.find(
        (candidate) => candidate.chunkIndex === chunk.chunkIndex
      );

      if (!citation) {
        continue;
      }

      results.push({
        score,
        snippet: createSnippet(chunk.content, queryTokens),
        source: {
          type: ingestion.source.type,
          name: ingestion.source.name,
          uri: ingestion.source.uri,
          documentTitle: ingestion.document.title,
          documentContentHash: ingestion.document.contentHash
        },
        citation: {
          label: citation.label,
          uri: citation.uri,
          chunkIndex: citation.chunkIndex,
          documentTitle: ingestion.document.title,
          contentHash: ingestion.document.contentHash
        }
      });
    }
  }

  const sortedResults = results
    .sort((a, b) => b.score - a.score || a.citation.label.localeCompare(b.citation.label))
    .slice(0, input.limit ?? 10);

  return {
    query: input.query,
    results: sortedResults,
    metrics: {
      searchedDocuments: input.corpus.length,
      searchedChunks,
      returnedResults: sortedResults.length,
      citationCoverage:
        sortedResults.length === 0
          ? 1
          : sortedResults.filter((result) => result.citation.label).length /
            sortedResults.length
    }
  };
}

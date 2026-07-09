import type { LocalAnswerResponse } from "@/answers/types";
import type { LocalSearchResponse } from "@/search/types";

export type RetrievalQualityStatus =
  | "no_data"
  | "healthy"
  | "insufficient_context"
  | "needs_review";

export interface RetrievalQualitySummary {
  status: RetrievalQualityStatus;
  searchedDocuments: number;
  searchedChunks: number;
  returnedResults: number;
  searchCitationCoverage: number;
  answerSupportRate: number;
  answerUnsupportedRate: number;
  answerCitationCoverage: number;
  evidenceCount: number;
  hasSearchData: boolean;
  hasAnswerData: boolean;
}

export function createRetrievalQualitySummary(input: {
  search: LocalSearchResponse | null;
  answer: LocalAnswerResponse | null;
}): RetrievalQualitySummary {
  const search = input.answer?.search ?? input.search;
  const answer = input.answer;
  const hasSearchData = search !== null;
  const hasAnswerData = answer !== null;
  let status: RetrievalQualityStatus = "no_data";

  if (answer?.verification.status === "unsupported") {
    status = "needs_review";
  } else if (answer?.verification.status === "insufficient_context") {
    status = "insufficient_context";
  } else if (search && search.metrics.returnedResults === 0) {
    status = "insufficient_context";
  } else if (hasSearchData || hasAnswerData) {
    status = "healthy";
  }

  return {
    status,
    searchedDocuments: search?.metrics.searchedDocuments ?? 0,
    searchedChunks: search?.metrics.searchedChunks ?? 0,
    returnedResults: search?.metrics.returnedResults ?? 0,
    searchCitationCoverage: search?.metrics.citationCoverage ?? 0,
    answerSupportRate: answer?.quality.supportRate ?? 0,
    answerUnsupportedRate: answer?.quality.unsupportedRate ?? 0,
    answerCitationCoverage: answer?.quality.citationCoverage ?? 0,
    evidenceCount: answer?.quality.evidenceCount ?? 0,
    hasSearchData,
    hasAnswerData
  };
}

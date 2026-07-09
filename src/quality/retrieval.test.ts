import { describe, expect, it } from "vitest";

import type { LocalAnswerResponse } from "@/answers/types";
import type { LocalSearchResponse } from "@/search/types";

import { createRetrievalQualitySummary } from "./retrieval";

const search: LocalSearchResponse = {
  query: "permission citations",
  results: [],
  metrics: {
    searchedDocuments: 2,
    searchedChunks: 4,
    returnedResults: 1,
    citationCoverage: 1
  }
};

function createAnswer(
  status: LocalAnswerResponse["verification"]["status"],
  supportRate: number,
  unsupportedRate: number
): LocalAnswerResponse {
  return {
    query: search.query,
    answer: "Supported answer.",
    confidence: "medium",
    citations: [],
    evidence: [],
    verification: {
      status,
      checkedCitations: 2,
      supportedCitations: supportRate > 0 ? 1 : 0,
      partiallySupportedCitations: 0,
      unsupportedCitations: unsupportedRate > 0 ? 1 : 0,
      citationCoverage: supportRate
    },
    quality: {
      evidenceCount: 2,
      supportedEvidenceCount: supportRate > 0 ? 1 : 0,
      partiallySupportedEvidenceCount: 0,
      unsupportedEvidenceCount: unsupportedRate > 0 ? 1 : 0,
      insufficientContextCount: 0,
      supportRate,
      unsupportedRate,
      citationCoverage: supportRate
    },
    search
  };
}

describe("createRetrievalQualitySummary", () => {
  it("returns an empty no-data summary without source content", () => {
    expect(
      createRetrievalQualitySummary({
        search: null,
        answer: null
      })
    ).toEqual({
      status: "no_data",
      searchedDocuments: 0,
      searchedChunks: 0,
      returnedResults: 0,
      searchCitationCoverage: 0,
      answerSupportRate: 0,
      answerUnsupportedRate: 0,
      answerCitationCoverage: 0,
      evidenceCount: 0,
      hasSearchData: false,
      hasAnswerData: false
    });
  });

  it("uses search metrics for search-only quality state", () => {
    const summary = createRetrievalQualitySummary({
      search,
      answer: null
    });

    expect(summary).toMatchObject({
      status: "healthy",
      searchedDocuments: 2,
      searchedChunks: 4,
      returnedResults: 1,
      searchCitationCoverage: 1,
      hasSearchData: true,
      hasAnswerData: false
    });
  });

  it("uses answer quality metrics when answer data exists", () => {
    const answer = createAnswer("supported", 1, 0);
    const summary = createRetrievalQualitySummary({
      search: null,
      answer
    });

    expect(summary).toMatchObject({
      status: "healthy",
      answerSupportRate: 1,
      answerUnsupportedRate: 0,
      answerCitationCoverage: 1,
      evidenceCount: 2,
      returnedResults: 1,
      hasAnswerData: true
    });
  });

  it("marks unsupported answers as needing review", () => {
    const summary = createRetrievalQualitySummary({
      search,
      answer: createAnswer("unsupported", 0.5, 0.5)
    });

    expect(summary).toMatchObject({
      status: "needs_review",
      answerSupportRate: 0.5,
      answerUnsupportedRate: 0.5
    });
  });
});

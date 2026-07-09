import type { LocalSearchInput, LocalSearchResult } from "@/search/types";
import { searchLocalCorpus } from "@/search/local-search";

import { verifyCitationSupport } from "./citation-verification";
import {
  createAnswerQualityReport,
  isSupportedAnswerEvidence
} from "./metrics";
import type {
  AnswerConfidence,
  AnswerCitationEvidence,
  LocalAnswerResponse
} from "./types";

function normalizeSnippet(snippet: string): string {
  return snippet
    .replace(/\s+/g, " ")
    .replace(/^\.\.\.\s*/, "")
    .replace(/\s*\.\.\.$/, "")
    .trim();
}

function confidenceForEvidence(evidenceCount: number): AnswerConfidence {
  if (evidenceCount >= 3) {
    return "high";
  }

  if (evidenceCount >= 1) {
    return "medium";
  }

  return "low";
}

function createEvidence(result: LocalSearchResult): AnswerCitationEvidence {
  const snippet = normalizeSnippet(result.snippet);
  const verification = verifyCitationSupport({
    claim: snippet,
    evidence: snippet,
    citationLabel: result.citation.label
  });

  return {
    citation: result.citation,
    source: result.source,
    claim: snippet,
    snippet,
    supportStatus: verification.status,
    overlapRatio: verification.overlapRatio,
    reason: verification.reason
  };
}

function createAnswer(
  query: string,
  evidence: AnswerCitationEvidence[]
): string {
  if (evidence.length === 0) {
    return `I do not have enough authorized context to answer "${query}" with citations.`;
  }

  const citedSentences = evidence.map(
    (item) => `${item.snippet} [${item.citation.label}]`
  );

  return `Based on the authorized context: ${citedSentences.join(" ")}`;
}

export function generateLocalAnswer(
  input: LocalSearchInput
): LocalAnswerResponse {
  const search = searchLocalCorpus({
    ...input,
    limit: Math.min(input.limit ?? 3, 5)
  });
  const evidence = search.results.map(createEvidence);
  const supportedEvidence = evidence.filter(isSupportedAnswerEvidence);
  const qualityReport = createAnswerQualityReport(evidence);

  return {
    query: input.query,
    answer: createAnswer(input.query, supportedEvidence),
    confidence: confidenceForEvidence(supportedEvidence.length),
    citations: supportedEvidence.map((item) => item.citation),
    evidence,
    verification: qualityReport.verification,
    quality: qualityReport.quality,
    search
  };
}

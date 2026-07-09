import type {
  LocalSearchResponse,
  SearchCitation,
  SearchSourceReference
} from "@/search/types";

import type { CitationVerificationStatus } from "./citation-verification";

export type AnswerConfidence = "high" | "medium" | "low";

export interface AnswerCitationEvidence {
  citation: SearchCitation;
  source: SearchSourceReference;
  claim: string;
  snippet: string;
  supportStatus: CitationVerificationStatus;
  overlapRatio: number;
  reason: string;
}

export interface AnswerVerificationSummary {
  status: CitationVerificationStatus;
  checkedCitations: number;
  supportedCitations: number;
  partiallySupportedCitations: number;
  unsupportedCitations: number;
  citationCoverage: number;
}

export interface AnswerQualityMetrics {
  evidenceCount: number;
  supportedEvidenceCount: number;
  partiallySupportedEvidenceCount: number;
  unsupportedEvidenceCount: number;
  insufficientContextCount: number;
  supportRate: number;
  unsupportedRate: number;
  citationCoverage: number;
}

export interface LocalAnswerResponse {
  query: string;
  answer: string;
  confidence: AnswerConfidence;
  citations: SearchCitation[];
  evidence: AnswerCitationEvidence[];
  verification: AnswerVerificationSummary;
  quality: AnswerQualityMetrics;
  search: LocalSearchResponse;
}

import type { NormalizedIngestionResult } from "@/ingestion/types";
import type { SourceType } from "@/db/model";

export interface LocalSearchInput {
  organizationId: string;
  query: string;
  corpus: NormalizedIngestionResult[];
  limit?: number;
}

export interface SearchSourceReference {
  type: SourceType;
  name: string;
  uri?: string;
  documentTitle: string;
  documentContentHash: string;
}

export interface SearchCitation {
  label: string;
  uri?: string;
  chunkIndex: number;
  documentTitle: string;
  contentHash: string;
}

export interface LocalSearchResult {
  score: number;
  snippet: string;
  source: SearchSourceReference;
  citation: SearchCitation;
}

export interface LocalSearchResponse {
  query: string;
  results: LocalSearchResult[];
  metrics: {
    searchedDocuments: number;
    searchedChunks: number;
    returnedResults: number;
    citationCoverage: number;
  };
}

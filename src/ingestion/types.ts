import type { SourceType } from "@/db/model";

export interface LocalNoteInput {
  organizationId: string;
  createdBy: string;
  title: string;
  content: string;
  sourceName?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedSource {
  type: SourceType;
  name: string;
  status: "ready";
  uri?: string;
  metadata: Record<string, unknown>;
  createdBy: string;
}

export interface NormalizedDocument {
  title: string;
  uri?: string;
  contentHash: string;
  status: "indexed";
  metadata: Record<string, unknown>;
}

export interface NormalizedChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface NormalizedCitation {
  label: string;
  uri?: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

export interface LocalNoteIngestionResult {
  organizationId: string;
  source: NormalizedSource;
  document: NormalizedDocument;
  chunks: NormalizedChunk[];
  citations: NormalizedCitation[];
}

export type NormalizedIngestionResult = LocalNoteIngestionResult;

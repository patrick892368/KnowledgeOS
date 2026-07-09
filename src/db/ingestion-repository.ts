import type { NormalizedIngestionResult } from "@/ingestion/types";
import { createLocalEmbedding, localEmbeddingModel } from "@/ai/embeddings";

import type { Database } from "./client";
import { embeddingDimensions } from "./model";
import { deterministicUuid } from "./ids";
import { chunks, citations, documents, embeddings, sources } from "./schema";

type SourceInsert = typeof sources.$inferInsert & { id: string };
type DocumentInsert = typeof documents.$inferInsert & { id: string };
type ChunkInsert = typeof chunks.$inferInsert & { id: string };
type EmbeddingInsert = typeof embeddings.$inferInsert & { id: string };
type CitationInsert = typeof citations.$inferInsert & { id: string };

export interface IngestionPersistencePlan {
  source: SourceInsert;
  document: DocumentInsert;
  chunks: ChunkInsert[];
  embeddings: EmbeddingInsert[];
  citations: CitationInsert[];
}

export interface PersistedIngestionResult {
  sourceId: string;
  documentId: string;
  chunkIds: string[];
  embeddingIds: string[];
  citationIds: string[];
  embeddingModel: string;
  duplicateKey: {
    sourceId: string;
    contentHash: string;
  };
}

function sourceFingerprint(ingestion: NormalizedIngestionResult): string {
  return [
    ingestion.organizationId,
    ingestion.source.type,
    ingestion.source.name,
    ingestion.source.uri ?? ""
  ].join("|");
}

export function createIngestionPersistencePlan(
  ingestion: NormalizedIngestionResult
): IngestionPersistencePlan {
  const sourceId = deterministicUuid("knowledgeos.source", sourceFingerprint(ingestion));
  const documentId = deterministicUuid(
    "knowledgeos.document",
    `${sourceId}|${ingestion.document.contentHash}`
  );

  const chunkRows = ingestion.chunks.map((chunk) => {
    const id = deterministicUuid(
      "knowledgeos.chunk",
      `${documentId}|${chunk.chunkIndex}`
    );

    return {
      id,
      organizationId: ingestion.organizationId,
      documentId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      metadata: chunk.metadata
    } satisfies typeof chunks.$inferInsert;
  });

  const embeddingRows = chunkRows.map((chunk) => ({
    id: deterministicUuid(
      "knowledgeos.embedding",
      `${chunk.id}|${localEmbeddingModel}`
    ),
    organizationId: ingestion.organizationId,
    chunkId: chunk.id,
    model: localEmbeddingModel,
    dimensions: embeddingDimensions,
    embedding: createLocalEmbedding(chunk.content)
  })) satisfies EmbeddingInsert[];

  return {
    source: {
      id: sourceId,
      organizationId: ingestion.organizationId,
      type: ingestion.source.type,
      name: ingestion.source.name,
      status: ingestion.source.status,
      uri: ingestion.source.uri,
      metadata: ingestion.source.metadata,
      createdBy: ingestion.source.createdBy
    },
    document: {
      id: documentId,
      organizationId: ingestion.organizationId,
      sourceId,
      title: ingestion.document.title,
      uri: ingestion.document.uri,
      contentHash: ingestion.document.contentHash,
      status: ingestion.document.status,
      metadata: ingestion.document.metadata
    },
    chunks: chunkRows,
    embeddings: embeddingRows,
    citations: ingestion.citations.map((citation) => {
      const chunkId =
        chunkRows.find((chunk) => chunk.chunkIndex === citation.chunkIndex)?.id ??
        null;
      const id = deterministicUuid(
        "knowledgeos.citation",
        `${documentId}|${citation.chunkIndex}|${citation.label}`
      );

      return {
        id,
        organizationId: ingestion.organizationId,
        documentId,
        chunkId,
        label: citation.label,
        uri: citation.uri,
        metadata: citation.metadata
      } satisfies typeof citations.$inferInsert;
    })
  };
}

export async function persistIngestionResult(
  db: Database,
  ingestion: NormalizedIngestionResult
): Promise<PersistedIngestionResult> {
  const plan = createIngestionPersistencePlan(ingestion);

  return db.transaction(async (tx) => {
    await tx
      .insert(sources)
      .values(plan.source)
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          name: plan.source.name,
          status: plan.source.status,
          uri: plan.source.uri,
          metadata: plan.source.metadata,
          updatedAt: new Date()
        }
      });

    await tx
      .insert(documents)
      .values(plan.document)
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          title: plan.document.title,
          uri: plan.document.uri,
          status: plan.document.status,
          metadata: plan.document.metadata,
          updatedAt: new Date()
        }
      });

    for (const chunk of plan.chunks) {
      await tx
        .insert(chunks)
        .values(chunk)
        .onConflictDoUpdate({
          target: chunks.id,
          set: {
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            metadata: chunk.metadata
          }
        });
    }

    for (const embedding of plan.embeddings) {
      await tx
        .insert(embeddings)
        .values(embedding)
        .onConflictDoUpdate({
          target: embeddings.id,
          set: {
            dimensions: embedding.dimensions,
            embedding: embedding.embedding
          }
        });
    }

    for (const citation of plan.citations) {
      await tx
        .insert(citations)
        .values(citation)
        .onConflictDoUpdate({
          target: citations.id,
          set: {
            chunkId: citation.chunkId,
            label: citation.label,
            uri: citation.uri,
            metadata: citation.metadata
          }
        });
    }

    return {
      sourceId: plan.source.id,
      documentId: plan.document.id,
      chunkIds: plan.chunks.map((chunk) => chunk.id),
      embeddingIds: plan.embeddings.map((embedding) => embedding.id),
      citationIds: plan.citations.map((citation) => citation.id),
      embeddingModel: localEmbeddingModel,
      duplicateKey: {
        sourceId: plan.source.id,
        contentHash: plan.document.contentHash
      }
    };
  });
}

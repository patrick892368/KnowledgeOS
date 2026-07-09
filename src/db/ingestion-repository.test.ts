import { describe, expect, it } from "vitest";

import { ingestLocalNote } from "@/ingestion/local-note";
import { embeddingDimensions } from "@/db/model";
import { localEmbeddingModel } from "@/ai/embeddings";

import { createIngestionPersistencePlan } from "./ingestion-repository";

const ingestion = ingestLocalNote({
  organizationId: "11111111-1111-4111-8111-111111111111",
  createdBy: "22222222-2222-4222-8222-222222222222",
  title: "Persistent Note",
  content: "Persist sources, documents, chunks, and citations.",
  uri: "local://persistent-note"
});

describe("createIngestionPersistencePlan", () => {
  it("maps normalized ingestion into Drizzle insert rows", () => {
    const plan = createIngestionPersistencePlan(ingestion);

    expect(plan.source).toMatchObject({
      organizationId: ingestion.organizationId,
      type: "note",
      status: "ready",
      createdBy: ingestion.source.createdBy
    });
    expect(plan.document).toMatchObject({
      organizationId: ingestion.organizationId,
      sourceId: plan.source.id,
      contentHash: ingestion.document.contentHash,
      status: "indexed"
    });
    expect(plan.chunks).toHaveLength(ingestion.chunks.length);
    expect(plan.embeddings).toHaveLength(ingestion.chunks.length);
    expect(plan.embeddings[0]).toMatchObject({
      organizationId: ingestion.organizationId,
      chunkId: plan.chunks[0]?.id,
      model: localEmbeddingModel,
      dimensions: embeddingDimensions
    });
    expect(plan.embeddings[0]?.embedding).toHaveLength(embeddingDimensions);
    expect(plan.citations).toHaveLength(ingestion.citations.length);
    expect(plan.citations[0]?.chunkId).toBe(plan.chunks[0]?.id);
  });

  it("uses deterministic IDs so duplicate source and content hash map to one document", () => {
    const first = createIngestionPersistencePlan(ingestion);
    const second = createIngestionPersistencePlan(ingestion);

    expect(first.source.id).toBe(second.source.id);
    expect(first.document.id).toBe(second.document.id);
    expect(first.chunks.map((chunk) => chunk.id)).toEqual(
      second.chunks.map((chunk) => chunk.id)
    );
    expect(first.embeddings.map((embedding) => embedding.id)).toEqual(
      second.embeddings.map((embedding) => embedding.id)
    );
  });

  it("changes document ID when content hash changes for the same source", () => {
    const changed = ingestLocalNote({
      organizationId: ingestion.organizationId,
      createdBy: ingestion.source.createdBy,
      title: "Persistent Note",
      content: "Different content.",
      uri: "local://persistent-note"
    });

    const first = createIngestionPersistencePlan(ingestion);
    const second = createIngestionPersistencePlan(changed);

    expect(first.source.id).toBe(second.source.id);
    expect(first.document.id).not.toBe(second.document.id);
  });
});

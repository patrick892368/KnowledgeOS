import { describe, expect, it } from "vitest";

import { embeddingDimensions } from "@/db/model";

import {
  cosineSimilarity,
  createLocalEmbedding,
  toPgVectorLiteral
} from "./embeddings";

function magnitude(vector: number[]) {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

describe("local hash embeddings", () => {
  it("creates deterministic vectors with the configured dimensions", () => {
    const first = createLocalEmbedding("Permission-aware retrieval with citations.");
    const second = createLocalEmbedding("Permission-aware retrieval with citations.");

    expect(first).toHaveLength(embeddingDimensions);
    expect(second).toEqual(first);
    expect(magnitude(first)).toBeCloseTo(1, 4);
  });

  it("keeps related text more similar than unrelated text", () => {
    const query = createLocalEmbedding("permission retrieval citations");
    const related = createLocalEmbedding("Retrieval uses permission filters and citations.");
    const unrelated = createLocalEmbedding("Billing exports monthly invoices.");

    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated)
    );
  });

  it("serializes vectors for pgvector query parameters", () => {
    expect(toPgVectorLiteral([0.1, -0.25])).toBe("[0.10000000,-0.25000000]");
  });
});

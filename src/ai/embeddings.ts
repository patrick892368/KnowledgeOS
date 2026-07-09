import { createHash } from "node:crypto";

import { embeddingDimensions } from "@/db/model";

export const localEmbeddingModel = "knowledgeos-local-hash-embedding-v1";

function tokenizeForEmbedding(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0)
  );

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

export function createLocalEmbedding(
  value: string,
  dimensions = embeddingDimensions
): number[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("Embedding dimensions must be a positive integer.");
  }

  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenizeForEmbedding(value);

  tokens.forEach((token) => {
    const digest = createHash("sha256").update(token).digest();

    for (let offset = 0; offset <= 24; offset += 6) {
      const index = digest.readUInt32BE(offset) % dimensions;
      const sign = digest[offset + 4] % 2 === 0 ? 1 : -1;
      const weight = 1 + digest[offset + 5] / 255;
      vector[index] += sign * weight;
    }
  });

  return normalizeVector(vector);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error("Embedding vectors must have the same dimensions.");
  }

  return left.reduce((total, value, index) => total + value * right[index], 0);
}

export function toPgVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => value.toFixed(8)).join(",")}]`;
}

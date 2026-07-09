import { createHash } from "node:crypto";

import { IngestionError } from "./errors";
import { chunkText, estimateTokenCount } from "./chunk-text";
import type { LocalNoteIngestionResult, LocalNoteInput } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalMetadata(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function parseLocalNotePayload(
  payload: unknown,
  context: Pick<LocalNoteInput, "organizationId" | "createdBy">
): LocalNoteInput {
  if (!isRecord(payload)) {
    throw new IngestionError("invalid_payload", "Request body must be an object.");
  }

  const title = optionalString(payload.title);
  const content = optionalString(payload.content);

  if (!title) {
    throw new IngestionError("empty_title", "A local note title is required.");
  }

  if (!content) {
    throw new IngestionError("empty_content", "Local note content is required.");
  }

  return {
    ...context,
    title,
    content,
    sourceName: optionalString(payload.sourceName),
    uri: optionalString(payload.uri),
    metadata: optionalMetadata(payload.metadata)
  };
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function ingestLocalNote(input: LocalNoteInput): LocalNoteIngestionResult {
  const normalizedTitle = input.title.trim();
  const normalizedContent = input.content.trim();

  if (!normalizedTitle) {
    throw new IngestionError("empty_title", "A local note title is required.");
  }

  if (!normalizedContent) {
    throw new IngestionError("empty_content", "Local note content is required.");
  }

  const contentHash = hashContent(normalizedContent);
  const chunks = chunkText(normalizedContent).map((content, chunkIndex) => ({
    chunkIndex,
    content,
    tokenCount: estimateTokenCount(content),
    metadata: {
      contentHash
    }
  }));

  return {
    organizationId: input.organizationId,
    source: {
      type: "note",
      name: input.sourceName ?? normalizedTitle,
      status: "ready",
      uri: input.uri,
      metadata: input.metadata ?? {},
      createdBy: input.createdBy
    },
    document: {
      title: normalizedTitle,
      uri: input.uri,
      contentHash,
      status: "indexed",
      metadata: {
        sourceType: "note"
      }
    },
    chunks,
    citations: chunks.map((chunk) => ({
      label: `${normalizedTitle} #${chunk.chunkIndex + 1}`,
      uri: input.uri,
      chunkIndex: chunk.chunkIndex,
      metadata: {
        contentHash
      }
    }))
  };
}

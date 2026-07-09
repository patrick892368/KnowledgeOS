import { describe, expect, it } from "vitest";

import { IngestionError } from "./errors";
import {
  hashContent,
  ingestLocalNote,
  parseLocalNotePayload
} from "./local-note";

const context = {
  organizationId: "org_1",
  createdBy: "user_1"
};

describe("local note ingestion", () => {
  it("normalizes a local note into source, document, chunks, and citations", () => {
    const result = ingestLocalNote({
      ...context,
      title: "Launch Notes",
      content: "First paragraph.\n\nSecond paragraph.",
      uri: "file://launch-notes.md"
    });

    expect(result.organizationId).toBe("org_1");
    expect(result.source).toMatchObject({
      type: "note",
      status: "ready",
      createdBy: "user_1"
    });
    expect(result.document).toMatchObject({
      title: "Launch Notes",
      status: "indexed",
      contentHash: hashContent("First paragraph.\n\nSecond paragraph.")
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      chunkIndex: 0,
      tokenCount: expect.any(Number)
    });
    expect(result.citations[0]).toMatchObject({
      label: "Launch Notes #1",
      chunkIndex: 0
    });
  });

  it("splits long notes into multiple recoverable chunks", () => {
    const longContent = Array.from({ length: 700 }, (_, index) => `word${index}`)
      .join(" ");

    const result = ingestLocalNote({
      ...context,
      title: "Long Note",
      content: longContent
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.citations).toHaveLength(result.chunks.length);
  });

  it("parses request payload with session context", () => {
    expect(
      parseLocalNotePayload(
        {
          title: "Research",
          content: "Useful source material.",
          metadata: {
            importedFrom: "manual"
          }
        },
        context
      )
    ).toMatchObject({
      organizationId: "org_1",
      createdBy: "user_1",
      title: "Research"
    });
  });

  it("returns structured recoverable errors for invalid payloads", () => {
    expect(() => parseLocalNotePayload(null, context)).toThrow(IngestionError);

    try {
      parseLocalNotePayload({ title: "Missing content" }, context);
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect((error as IngestionError).code).toBe("empty_content");
      expect((error as IngestionError).recoverable).toBe(true);
    }
  });
});

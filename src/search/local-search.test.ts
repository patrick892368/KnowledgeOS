import { describe, expect, it } from "vitest";

import { ingestLocalNote } from "@/ingestion/local-note";

import { SearchError } from "./errors";
import { parseLocalSearchPayload, searchLocalCorpus } from "./local-search";

const note = ingestLocalNote({
  organizationId: "org_1",
  createdBy: "user_1",
  title: "RAG Architecture",
  content:
    "Retrieval uses permission filters before ranking.\n\nCitations must support generated answers.",
  uri: "file://rag.md"
});

describe("local citation-first search", () => {
  it("returns source references and citations for matching chunks", () => {
    const response = searchLocalCorpus({
      organizationId: "org_1",
      query: "permission citations",
      corpus: [note]
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      source: {
        type: "note",
        name: "RAG Architecture",
        uri: "file://rag.md",
        documentTitle: "RAG Architecture"
      },
      citation: {
        label: "RAG Architecture #1",
        uri: "file://rag.md",
        chunkIndex: 0,
        documentTitle: "RAG Architecture"
      }
    });
    expect(response.metrics.citationCoverage).toBe(1);
  });

  it("orders higher scoring results first", () => {
    const secondNote = ingestLocalNote({
      organizationId: "org_1",
      createdBy: "user_1",
      title: "Permissions",
      content: "Permissions permissions permissions protect search."
    });

    const response = searchLocalCorpus({
      organizationId: "org_1",
      query: "permissions",
      corpus: [note, secondNote]
    });

    expect(response.results[0]?.source.documentTitle).toBe("Permissions");
  });

  it("validates search payload organization boundaries", () => {
    expect(() =>
      parseLocalSearchPayload(
        {
          query: "permission",
          corpus: [
            {
              ...note,
              organizationId: "org_2"
            }
          ]
        },
        "org_1"
      )
    ).toThrow(SearchError);
  });

  it("requires a query and corpus", () => {
    expect(() => parseLocalSearchPayload({}, "org_1")).toThrow(SearchError);
    expect(() =>
      parseLocalSearchPayload({ query: "permission", corpus: [] }, "org_1")
    ).toThrow("non-empty normalized ingestion corpus");
  });
});

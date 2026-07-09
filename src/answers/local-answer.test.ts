import { describe, expect, it } from "vitest";

import { ingestLocalNote } from "@/ingestion/local-note";
import { SearchError } from "@/search/errors";
import { parseLocalSearchPayload } from "@/search/local-search";

import { generateLocalAnswer } from "./local-answer";

const organizationId = "11111111-1111-4111-8111-111111111111";

const corpus = [
  ingestLocalNote({
    organizationId,
    createdBy: "22222222-2222-4222-8222-222222222222",
    title: "Permission Retrieval",
    content:
      "Retrieval must apply permission filters before ranking. Answers must include citations that support each claim.",
    uri: "local://permission-retrieval"
  })
];

describe("generateLocalAnswer", () => {
  it("creates a grounded answer with citations and verification metadata", () => {
    const answer = generateLocalAnswer({
      organizationId,
      query: "permission citations",
      corpus
    });

    expect(answer.answer).toContain("Permission Retrieval #1");
    expect(answer.confidence).toBe("medium");
    expect(answer.citations).toHaveLength(1);
    expect(answer.verification).toEqual({
      status: "supported",
      checkedCitations: 1,
      supportedCitations: 1,
      partiallySupportedCitations: 0,
      unsupportedCitations: 0,
      citationCoverage: 1
    });
    expect(answer.quality).toEqual({
      evidenceCount: 1,
      supportedEvidenceCount: 1,
      partiallySupportedEvidenceCount: 0,
      unsupportedEvidenceCount: 0,
      insufficientContextCount: 0,
      supportRate: 1,
      unsupportedRate: 0,
      citationCoverage: 1
    });
    expect(answer.evidence[0]).toMatchObject({
      supportStatus: "supported",
      reason: "Permission Retrieval #1 directly supports the claim."
    });
  });

  it("returns an insufficient-context answer instead of hallucinating", () => {
    const answer = generateLocalAnswer({
      organizationId,
      query: "billing invoices",
      corpus
    });

    expect(answer.confidence).toBe("low");
    expect(answer.citations).toHaveLength(0);
    expect(answer.verification.status).toBe("insufficient_context");
    expect(answer.verification.unsupportedCitations).toBe(0);
    expect(answer.quality).toMatchObject({
      evidenceCount: 0,
      supportRate: 0,
      unsupportedRate: 0,
      citationCoverage: 1
    });
    expect(answer.answer).toContain("I do not have enough authorized context");
  });

  it("reuses local search validation for organization boundaries", () => {
    expect(() =>
      parseLocalSearchPayload(
        {
          query: "permission",
          corpus
        },
        "99999999-9999-4999-8999-999999999999"
      )
    ).toThrow(SearchError);
  });
});

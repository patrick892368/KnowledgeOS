import { describe, expect, it } from "vitest";

import type { AnswerCitationEvidence } from "./types";
import { createAnswerQualityReport } from "./metrics";

function createEvidence(
  supportStatus: AnswerCitationEvidence["supportStatus"]
): AnswerCitationEvidence {
  return {
    citation: {
      label: `Source #${supportStatus}`,
      chunkIndex: 0,
      documentTitle: "Source",
      contentHash: `hash-${supportStatus}`
    },
    source: {
      type: "note",
      name: "Source",
      documentTitle: "Source",
      documentContentHash: `hash-${supportStatus}`
    },
    claim: "The answer is supported by authorized evidence.",
    snippet: "The answer is supported by authorized evidence.",
    supportStatus,
    overlapRatio: supportStatus === "supported" ? 1 : 0,
    reason: `${supportStatus} fixture`
  };
}

describe("createAnswerQualityReport", () => {
  it("calculates quality metrics for supported answers", () => {
    const report = createAnswerQualityReport([createEvidence("supported")]);

    expect(report.verification).toEqual({
      status: "supported",
      checkedCitations: 1,
      supportedCitations: 1,
      partiallySupportedCitations: 0,
      unsupportedCitations: 0,
      citationCoverage: 1
    });
    expect(report.quality).toEqual({
      evidenceCount: 1,
      supportedEvidenceCount: 1,
      partiallySupportedEvidenceCount: 0,
      unsupportedEvidenceCount: 0,
      insufficientContextCount: 0,
      supportRate: 1,
      unsupportedRate: 0,
      citationCoverage: 1
    });
  });

  it("keeps empty evidence as insufficient context without penalizing coverage", () => {
    const report = createAnswerQualityReport([]);

    expect(report.verification.status).toBe("insufficient_context");
    expect(report.verification.checkedCitations).toBe(0);
    expect(report.quality).toEqual({
      evidenceCount: 0,
      supportedEvidenceCount: 0,
      partiallySupportedEvidenceCount: 0,
      unsupportedEvidenceCount: 0,
      insufficientContextCount: 0,
      supportRate: 0,
      unsupportedRate: 0,
      citationCoverage: 1
    });
  });

  it("counts partial, unsupported, and insufficient evidence in one pass", () => {
    const report = createAnswerQualityReport([
      createEvidence("supported"),
      createEvidence("partially_supported"),
      createEvidence("unsupported"),
      createEvidence("insufficient_context")
    ]);

    expect(report.verification).toEqual({
      status: "unsupported",
      checkedCitations: 4,
      supportedCitations: 1,
      partiallySupportedCitations: 1,
      unsupportedCitations: 2,
      citationCoverage: 0.25
    });
    expect(report.quality).toMatchObject({
      evidenceCount: 4,
      supportedEvidenceCount: 1,
      partiallySupportedEvidenceCount: 1,
      unsupportedEvidenceCount: 1,
      insufficientContextCount: 1,
      supportRate: 0.5,
      unsupportedRate: 0.5,
      citationCoverage: 0.25
    });
  });
});

import type {
  AnswerCitationEvidence,
  AnswerQualityMetrics,
  AnswerVerificationSummary
} from "./types";

type AnswerQualityReport = {
  verification: AnswerVerificationSummary;
  quality: AnswerQualityMetrics;
};

type AnswerQualityCounts = {
  supportedEvidenceCount: number;
  partiallySupportedEvidenceCount: number;
  unsupportedEvidenceCount: number;
  insufficientContextCount: number;
};

const emptyCounts: AnswerQualityCounts = {
  supportedEvidenceCount: 0,
  partiallySupportedEvidenceCount: 0,
  unsupportedEvidenceCount: 0,
  insufficientContextCount: 0
};

export function isSupportedAnswerEvidence(
  evidence: AnswerCitationEvidence
): boolean {
  return (
    evidence.supportStatus === "supported" ||
    evidence.supportStatus === "partially_supported"
  );
}

export function createAnswerQualityReport(
  evidence: readonly AnswerCitationEvidence[]
): AnswerQualityReport {
  const counts = evidence.reduce<AnswerQualityCounts>(
    (current, item) => {
      switch (item.supportStatus) {
        case "supported":
          current.supportedEvidenceCount += 1;
          return current;
        case "partially_supported":
          current.partiallySupportedEvidenceCount += 1;
          return current;
        case "unsupported":
          current.unsupportedEvidenceCount += 1;
          return current;
        case "insufficient_context":
          current.insufficientContextCount += 1;
          return current;
      }
    },
    { ...emptyCounts }
  );
  const evidenceCount = evidence.length;
  const unsupportedCitations =
    counts.unsupportedEvidenceCount + counts.insufficientContextCount;
  const supportedOrPartial =
    counts.supportedEvidenceCount + counts.partiallySupportedEvidenceCount;
  const citationCoverage =
    evidenceCount === 0 ? 1 : counts.supportedEvidenceCount / evidenceCount;
  const supportRate = evidenceCount === 0 ? 0 : supportedOrPartial / evidenceCount;
  const unsupportedRate =
    evidenceCount === 0 ? 0 : unsupportedCitations / evidenceCount;
  const status =
    evidenceCount === 0
      ? "insufficient_context"
      : unsupportedCitations > 0
        ? "unsupported"
        : counts.partiallySupportedEvidenceCount > 0
          ? "partially_supported"
          : "supported";

  return {
    verification: {
      status,
      checkedCitations: evidenceCount,
      supportedCitations: counts.supportedEvidenceCount,
      partiallySupportedCitations: counts.partiallySupportedEvidenceCount,
      unsupportedCitations,
      citationCoverage
    },
    quality: {
      evidenceCount,
      supportedEvidenceCount: counts.supportedEvidenceCount,
      partiallySupportedEvidenceCount: counts.partiallySupportedEvidenceCount,
      unsupportedEvidenceCount: counts.unsupportedEvidenceCount,
      insufficientContextCount: counts.insufficientContextCount,
      supportRate,
      unsupportedRate,
      citationCoverage
    }
  };
}

export const citationVerificationStatuses = [
  "supported",
  "partially_supported",
  "unsupported",
  "insufficient_context"
] as const;

export type CitationVerificationStatus =
  (typeof citationVerificationStatuses)[number];

export interface CitationVerificationInput {
  claim: string;
  evidence: string;
  citationLabel: string;
}

export interface CitationVerificationResult {
  status: CitationVerificationStatus;
  citationLabel: string;
  overlapRatio: number;
  reason: string;
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with"
]);

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !stopWords.has(token))
    )
  );
}

export function verifyCitationSupport(
  input: CitationVerificationInput
): CitationVerificationResult {
  const claimTokens = tokenize(input.claim);
  const evidenceTokens = tokenize(input.evidence);

  if (claimTokens.length === 0 || evidenceTokens.length === 0) {
    return {
      status: "insufficient_context",
      citationLabel: input.citationLabel,
      overlapRatio: 0,
      reason: `${input.citationLabel} does not provide enough text to verify the claim.`
    };
  }

  const evidenceTokenSet = new Set(evidenceTokens);
  const overlap = claimTokens.filter((token) => evidenceTokenSet.has(token));
  const overlapRatio = overlap.length / claimTokens.length;

  if (overlapRatio >= 0.8) {
    return {
      status: "supported",
      citationLabel: input.citationLabel,
      overlapRatio,
      reason: `${input.citationLabel} directly supports the claim.`
    };
  }

  if (overlapRatio > 0) {
    return {
      status: "partially_supported",
      citationLabel: input.citationLabel,
      overlapRatio,
      reason: `${input.citationLabel} partially overlaps with the claim but may not fully support it.`
    };
  }

  return {
    status: "unsupported",
    citationLabel: input.citationLabel,
    overlapRatio,
    reason: `${input.citationLabel} does not support the claim.`
  };
}

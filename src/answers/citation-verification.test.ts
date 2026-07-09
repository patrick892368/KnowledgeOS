import { describe, expect, it } from "vitest";

import { verifyCitationSupport } from "./citation-verification";

describe("verifyCitationSupport", () => {
  it("marks directly overlapping claims as supported", () => {
    expect(
      verifyCitationSupport({
        claim: "Permission filters apply before ranking",
        evidence: "Retrieval systems must apply permission filters before ranking.",
        citationLabel: "Source #1"
      })
    ).toMatchObject({
      status: "supported",
      citationLabel: "Source #1"
    });
  });

  it("marks partial overlap as partially supported", () => {
    expect(
      verifyCitationSupport({
        claim: "Permission filters apply before ranking and citations support answers",
        evidence: "Permission filters apply before ranking.",
        citationLabel: "Source #1"
      }).status
    ).toBe("partially_supported");
  });

  it("marks unrelated evidence as unsupported", () => {
    expect(
      verifyCitationSupport({
        claim: "Invoices are exported monthly",
        evidence: "Permission filters apply before ranking.",
        citationLabel: "Source #1"
      }).status
    ).toBe("unsupported");
  });

  it("marks empty evidence as insufficient context", () => {
    expect(
      verifyCitationSupport({
        claim: "Permission filters apply before ranking",
        evidence: "",
        citationLabel: "Source #1"
      }).status
    ).toBe("insufficient_context");
  });
});

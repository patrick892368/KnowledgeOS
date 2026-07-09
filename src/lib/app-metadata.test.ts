import { describe, expect, it } from "vitest";

import { appMetadata, foundationChecks } from "./app-metadata";

describe("app metadata", () => {
  it("identifies the KnowledgeOS product", () => {
    expect(appMetadata.name).toBe("KnowledgeOS");
    expect(appMetadata.phase).toBe("Foundation");
  });

  it("tracks scaffold readiness checks", () => {
    expect(foundationChecks).toHaveLength(3);
    expect(foundationChecks.some((check) => check.status === "Pending")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { deterministicUuid } from "./ids";

describe("deterministicUuid", () => {
  it("creates stable UUID-shaped identifiers", () => {
    const first = deterministicUuid("knowledgeos.test", "same-input");
    const second = deterministicUuid("knowledgeos.test", "same-input");

    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("separates namespaces", () => {
    expect(deterministicUuid("one", "value")).not.toBe(
      deterministicUuid("two", "value")
    );
  });
});

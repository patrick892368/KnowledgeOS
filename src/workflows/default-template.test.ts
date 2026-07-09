import { describe, expect, it } from "vitest";

import { createWorkflowRunPlan, parseWorkflowRunRequest } from "./run";
import {
  createWorkflowStatusRunRequest,
  workflowStatusTemplate
} from "./default-template";
import { validateWorkflowTemplate } from "./template";

describe("workflow status template", () => {
  it("is a valid plan-only workflow template", () => {
    const result = validateWorkflowTemplate(workflowStatusTemplate);

    expect(result).toMatchObject({
      valid: true,
      issues: []
    });
  });

  it("creates a valid workflow run payload for the console UI", () => {
    const request = parseWorkflowRunRequest(
      createWorkflowStatusRunRequest("T-028")
    );
    const plan = createWorkflowRunPlan({
      ...request,
      session: {
        organizationId: "org_1",
        userId: "user_1"
      },
      now: new Date("2026-07-09T00:00:00.000Z")
    });

    expect(plan.executionMode).toBe("plan_only");
    expect(plan.status).toBe("queued");
    expect(plan.steps).toHaveLength(3);
    expect(plan.reviewGates).toEqual([
      "product",
      "architecture",
      "security",
      "performance",
      "business_value",
      "engineering",
      "pm",
      "ux",
      "release"
    ]);
  });

  it("keeps missing task input as a recoverable planning error", () => {
    expect(() =>
      parseWorkflowRunRequest(createWorkflowStatusRunRequest(""))
    ).toThrow("task_id is required.");
  });
});

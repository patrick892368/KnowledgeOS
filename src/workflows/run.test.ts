import { describe, expect, it } from "vitest";

import {
  createWorkflowRunPlan,
  parseWorkflowRunRequest,
  WorkflowRunPlanningError
} from "./run";

const session = {
  organizationId: "org_1",
  userId: "user_1"
};

const template = {
  name: "Implementation Review",
  description: "Plan implementation review work with required gates.",
  version: "1.0.0",
  inputs: [
    {
      key: "task_id",
      label: "Task ID",
      type: "text",
      required: true
    },
    {
      key: "risk_level",
      label: "Risk level",
      type: "select",
      required: true,
      options: ["low", "medium", "high"]
    }
  ],
  steps: [
    {
      id: "review_scope",
      name: "Review scope",
      description: "Review task scope and acceptance criteria.",
      inputKeys: ["task_id", "risk_level"],
      outputKeys: ["review_summary"],
      reviewGates: ["architecture", "security"]
    }
  ],
  reviewRequirements: [
    {
      gate: "product",
      required: true
    }
  ],
  outputs: [
    {
      key: "review_summary",
      label: "Review summary",
      type: "text",
      required: true
    }
  ]
};

describe("workflow run planning", () => {
  it("creates a deterministic plan for a valid template and inputs", () => {
    const request = parseWorkflowRunRequest({
      template,
      inputs: {
        task_id: "T-027",
        risk_level: "medium"
      }
    });
    const plan = createWorkflowRunPlan({
      ...request,
      session,
      now: new Date("2026-07-09T00:00:00.000Z")
    });
    const secondPlan = createWorkflowRunPlan({
      ...request,
      session,
      now: new Date("2026-07-09T00:00:00.000Z")
    });

    expect(plan).toMatchObject({
      id: secondPlan.id,
      organizationId: "org_1",
      createdBy: "user_1",
      templateName: "Implementation Review",
      templateVersion: "1.0.0",
      status: "queued",
      executionMode: "plan_only",
      reviewGates: ["product", "architecture", "security"],
      outputKeys: ["review_summary"]
    });
    expect(plan.steps).toHaveLength(1);
  });

  it("rejects invalid templates before planning", () => {
    expect(() =>
      parseWorkflowRunRequest({
        template: {
          ...template,
          prompt: "unsafe"
        },
        inputs: {
          task_id: "T-027",
          risk_level: "medium"
        }
      })
    ).toThrow(WorkflowRunPlanningError);
  });

  it("rejects missing required inputs", () => {
    expect(() =>
      parseWorkflowRunRequest({
        template,
        inputs: {
          risk_level: "medium"
        }
      })
    ).toThrow("task_id is required.");
  });

  it("rejects invalid input values and unknown input keys", () => {
    expect(() =>
      parseWorkflowRunRequest({
        template,
        inputs: {
          task_id: "T-027",
          risk_level: "urgent",
          extra: true
        }
      })
    ).toThrow(WorkflowRunPlanningError);
  });
});

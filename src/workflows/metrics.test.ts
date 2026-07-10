import { describe, expect, it } from "vitest";

import {
  createWorkflowStatusRunRequest
} from "./default-template";
import { createWorkflowMetricsSummary } from "./metrics";
import { createWorkflowRunPlan, parseWorkflowRunRequest } from "./run";

const session = {
  organizationId: "org_1",
  userId: "user_1"
};

function createPlan(taskId: string) {
  const request = parseWorkflowRunRequest(
    createWorkflowStatusRunRequest(taskId)
  );

  return createWorkflowRunPlan({
    ...request,
    session,
    now: new Date("2026-07-10T00:00:00.000Z")
  });
}

describe("createWorkflowMetricsSummary", () => {
  it("returns a no-data summary when no workflow plans exist", () => {
    expect(createWorkflowMetricsSummary({ plans: [] })).toEqual({
      status: "no_data",
      planCount: 0,
      planOnlyCount: 0,
      queuedRunCount: 0,
      queuedStepCount: 0,
      reviewGateCount: 0,
      uniqueReviewGateCount: 0,
      outputKeyCount: 0,
      averageStepsPerPlan: 0,
      averageReviewGatesPerPlan: 0,
      planOnlyComplianceRate: 0
    });
  });

  it("summarizes plan-only workflow usage from existing run plans", () => {
    const summary = createWorkflowMetricsSummary({
      plans: [createPlan("T-046")],
      reviewHeavyThreshold: 10
    });

    expect(summary).toMatchObject({
      status: "healthy",
      planCount: 1,
      planOnlyCount: 1,
      queuedRunCount: 1,
      queuedStepCount: 3,
      reviewGateCount: 9,
      uniqueReviewGateCount: 9,
      outputKeyCount: 3,
      averageStepsPerPlan: 3,
      averageReviewGatesPerPlan: 9,
      planOnlyComplianceRate: 1
    });
  });

  it("flags review-heavy planning when average review gates exceed the threshold", () => {
    const summary = createWorkflowMetricsSummary({
      plans: [createPlan("T-046")]
    });

    expect(summary.status).toBe("review_heavy");
    expect(summary.averageReviewGatesPerPlan).toBe(9);
  });
});

import type { WorkflowRunPlan } from "./run";

export type WorkflowMetricsStatus = "no_data" | "healthy" | "review_heavy";

export interface WorkflowMetricsSummary {
  status: WorkflowMetricsStatus;
  planCount: number;
  planOnlyCount: number;
  queuedRunCount: number;
  queuedStepCount: number;
  reviewGateCount: number;
  uniqueReviewGateCount: number;
  outputKeyCount: number;
  averageStepsPerPlan: number;
  averageReviewGatesPerPlan: number;
  planOnlyComplianceRate: number;
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

export function createWorkflowMetricsSummary(input: {
  plans: WorkflowRunPlan[];
  reviewHeavyThreshold?: number;
}): WorkflowMetricsSummary {
  const planCount = input.plans.length;
  const planOnlyCount = input.plans.filter(
    (plan) => plan.executionMode === "plan_only"
  ).length;
  const queuedRunCount = input.plans.filter(
    (plan) => plan.status === "queued"
  ).length;
  const queuedStepCount = input.plans.reduce(
    (total, plan) =>
      total + plan.steps.filter((step) => step.status === "queued").length,
    0
  );
  const reviewGates = input.plans.flatMap((plan) => plan.reviewGates);
  const outputKeyCount = input.plans.reduce(
    (total, plan) => total + plan.outputKeys.length,
    0
  );
  const averageStepsPerPlan = average(queuedStepCount, planCount);
  const averageReviewGatesPerPlan = average(reviewGates.length, planCount);
  const reviewHeavyThreshold = input.reviewHeavyThreshold ?? 6;

  return {
    status:
      planCount === 0
        ? "no_data"
        : averageReviewGatesPerPlan >= reviewHeavyThreshold
          ? "review_heavy"
          : "healthy",
    planCount,
    planOnlyCount,
    queuedRunCount,
    queuedStepCount,
    reviewGateCount: reviewGates.length,
    uniqueReviewGateCount: new Set(reviewGates).size,
    outputKeyCount,
    averageStepsPerPlan,
    averageReviewGatesPerPlan,
    planOnlyComplianceRate: average(planOnlyCount, planCount)
  };
}

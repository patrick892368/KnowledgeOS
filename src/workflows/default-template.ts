import type { WorkflowTemplate } from "./template";

export const workflowStatusTemplate = {
  name: "Sprint Story Review",
  description: "Plan a governed review run for the active Sprint Story.",
  version: "1.0.0",
  inputs: [
    {
      key: "task_id",
      label: "Task ID",
      type: "text",
      required: true,
      description: "Current TASKS.md task identifier."
    },
    {
      key: "risk_level",
      label: "Risk level",
      type: "select",
      required: true,
      options: ["low", "medium", "high"],
      description: "Estimated delivery risk for the current task."
    },
    {
      key: "target_surface",
      label: "Target surface",
      type: "select",
      required: true,
      options: ["api", "console", "documentation", "database"],
      description: "Primary surface affected by the task."
    }
  ],
  steps: [
    {
      id: "confirm_scope",
      name: "Confirm scope",
      description: "Check the Sprint Story, acceptance criteria, and impact area.",
      inputKeys: ["task_id", "risk_level", "target_surface"],
      outputKeys: ["scope_summary"],
      reviewGates: ["product", "architecture"]
    },
    {
      id: "verify_delivery",
      name: "Verify delivery",
      description: "Review build, type safety, test coverage, and runtime status.",
      inputKeys: ["task_id", "risk_level"],
      outputKeys: ["verification_summary"],
      reviewGates: ["engineering", "performance", "security"]
    },
    {
      id: "complete_review",
      name: "Complete review",
      description: "Record final product, UX, release, and business value checks.",
      inputKeys: ["task_id", "target_surface"],
      outputKeys: ["review_summary"],
      reviewGates: ["pm", "ux", "release", "business_value"]
    }
  ],
  reviewRequirements: [
    {
      gate: "product",
      required: true,
      description: "Feature must support the PRD and current Sprint Story."
    },
    {
      gate: "architecture",
      required: true,
      description: "Implementation must respect current architecture decisions."
    },
    {
      gate: "security",
      required: true,
      description: "Permission, secret, and unsafe data risks must be reviewed."
    },
    {
      gate: "performance",
      required: true,
      description: "Runtime and rendering cost must stay bounded."
    },
    {
      gate: "business_value",
      required: true,
      description: "The feature must have measurable user or enterprise value."
    }
  ],
  outputs: [
    {
      key: "scope_summary",
      label: "Scope summary",
      type: "text",
      required: true
    },
    {
      key: "verification_summary",
      label: "Verification summary",
      type: "text",
      required: true
    },
    {
      key: "review_summary",
      label: "Review summary",
      type: "text",
      required: true
    }
  ],
  metadata: {
    owner: "agent_os",
    executionMode: "plan_only"
  }
} satisfies WorkflowTemplate;

export function createWorkflowStatusRunRequest(taskId: string) {
  return {
    template: workflowStatusTemplate,
    inputs: {
      task_id: taskId,
      risk_level: "medium",
      target_surface: "console"
    }
  };
}

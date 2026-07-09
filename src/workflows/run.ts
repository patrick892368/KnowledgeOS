import { createHash } from "node:crypto";

import type { AuthSession } from "@/auth/session";

import {
  parseWorkflowTemplate,
  type WorkflowTemplate,
  type WorkflowTemplateField,
  WorkflowTemplateValidationError
} from "./template";

export type WorkflowRunPlanningErrorCode =
  | "invalid_payload"
  | "invalid_template"
  | "missing_input"
  | "invalid_input";

export class WorkflowRunPlanningError extends Error {
  constructor(
    public readonly code: WorkflowRunPlanningErrorCode,
    message: string,
    public readonly issues: string[] = [message]
  ) {
    super(message);
    this.name = "WorkflowRunPlanningError";
  }
}

export interface WorkflowRunPlanStep {
  id: string;
  name: string;
  description: string;
  status: "queued";
  inputKeys: string[];
  outputKeys: string[];
  reviewGates: string[];
}

export interface WorkflowRunPlan {
  id: string;
  organizationId: string;
  createdBy: string;
  templateName: string;
  templateVersion: string;
  status: "queued";
  inputValues: Record<string, unknown>;
  steps: WorkflowRunPlanStep[];
  reviewGates: string[];
  outputKeys: string[];
  createdAt: string;
  executionMode: "plan_only";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function runId(
  template: WorkflowTemplate,
  inputValues: Record<string, unknown>,
  session: Pick<AuthSession, "organizationId" | "userId">,
  createdAt: string
): string {
  const hash = createHash("sha256")
    .update(
      stableStringify({
        organizationId: session.organizationId,
        userId: session.userId,
        templateName: template.name,
        templateVersion: template.version,
        inputValues,
        createdAt
      }),
      "utf8"
    )
    .digest("hex")
    .slice(0, 24);

  return `workflow_run_${hash}`;
}

function validateInputValue(
  field: WorkflowTemplateField,
  value: unknown,
  issues: string[]
): void {
  if (value === undefined || value === null || value === "") {
    if (field.required) {
      issues.push(`${field.key} is required.`);
    }

    return;
  }

  if (field.type === "text" && typeof value !== "string") {
    issues.push(`${field.key} must be text.`);
  }

  if (field.type === "number" && typeof value !== "number") {
    issues.push(`${field.key} must be a number.`);
  }

  if (field.type === "boolean" && typeof value !== "boolean") {
    issues.push(`${field.key} must be true or false.`);
  }

  if (
    field.type === "select" &&
    (typeof value !== "string" || !field.options?.includes(value))
  ) {
    issues.push(`${field.key} must be one of the configured options.`);
  }

  if (field.type === "json" && !isRecord(value) && !Array.isArray(value)) {
    issues.push(`${field.key} must be JSON object or array.`);
  }
}

function validateInputValues(
  template: WorkflowTemplate,
  inputValues: Record<string, unknown>
): void {
  const issues: string[] = [];
  const allowedKeys = new Set(template.inputs.map((input) => input.key));

  for (const field of template.inputs) {
    validateInputValue(field, inputValues[field.key], issues);
  }

  for (const key of Object.keys(inputValues)) {
    if (!allowedKeys.has(key)) {
      issues.push(`${key} is not a configured template input.`);
    }
  }

  if (issues.length > 0) {
    throw new WorkflowRunPlanningError("invalid_input", issues[0], issues);
  }
}

export function parseWorkflowRunRequest(payload: unknown): {
  template: WorkflowTemplate;
  inputValues: Record<string, unknown>;
} {
  if (!isRecord(payload)) {
    throw new WorkflowRunPlanningError(
      "invalid_payload",
      "Request body must be an object."
    );
  }

  let template: WorkflowTemplate;

  try {
    template = parseWorkflowTemplate(payload.template);
  } catch (error) {
    if (error instanceof WorkflowTemplateValidationError) {
      throw new WorkflowRunPlanningError(
        "invalid_template",
        error.issues[0],
        error.issues
      );
    }

    throw error;
  }

  if (!isRecord(payload.inputs)) {
    throw new WorkflowRunPlanningError(
      "missing_input",
      "inputs must be an object."
    );
  }

  validateInputValues(template, payload.inputs);

  return {
    template,
    inputValues: payload.inputs
  };
}

export function createWorkflowRunPlan(
  input: {
    template: WorkflowTemplate;
    inputValues: Record<string, unknown>;
    session: Pick<AuthSession, "organizationId" | "userId">;
    now?: Date;
  }
): WorkflowRunPlan {
  const createdAt = (input.now ?? new Date()).toISOString();
  const reviewGates = [
    ...new Set([
      ...input.template.reviewRequirements
        .filter((requirement) => requirement.required)
        .map((requirement) => requirement.gate),
      ...input.template.steps.flatMap((step) => step.reviewGates)
    ])
  ];

  return {
    id: runId(input.template, input.inputValues, input.session, createdAt),
    organizationId: input.session.organizationId,
    createdBy: input.session.userId,
    templateName: input.template.name,
    templateVersion: input.template.version,
    status: "queued",
    inputValues: input.inputValues,
    steps: input.template.steps.map((step) => ({
      id: step.id,
      name: step.name,
      description: step.description,
      status: "queued",
      inputKeys: step.inputKeys,
      outputKeys: step.outputKeys,
      reviewGates: step.reviewGates
    })),
    reviewGates,
    outputKeys: input.template.outputs.map((output) => output.key),
    createdAt,
    executionMode: "plan_only"
  };
}

export function workflowRunErrorResponse(
  error: WorkflowRunPlanningError
): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        issues: error.issues,
        recoverable: true
      }
    },
    { status: 400 }
  );
}

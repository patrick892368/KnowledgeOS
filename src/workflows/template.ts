export type WorkflowTemplateFieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "json";

export type WorkflowReviewGate =
  | "product"
  | "pm"
  | "ux"
  | "architecture"
  | "engineering"
  | "ai"
  | "security"
  | "performance"
  | "release"
  | "business_value";

export interface WorkflowTemplateField {
  key: string;
  label: string;
  type: WorkflowTemplateFieldType;
  required: boolean;
  description?: string;
  options?: string[];
}

export interface WorkflowTemplateStep {
  id: string;
  name: string;
  description: string;
  inputKeys: string[];
  outputKeys: string[];
  reviewGates: WorkflowReviewGate[];
}

export interface WorkflowTemplateReviewRequirement {
  gate: WorkflowReviewGate;
  required: boolean;
  description?: string;
}

export interface WorkflowTemplate {
  name: string;
  description: string;
  version: string;
  inputs: WorkflowTemplateField[];
  steps: WorkflowTemplateStep[];
  reviewRequirements: WorkflowTemplateReviewRequirement[];
  outputs: WorkflowTemplateField[];
  metadata: Record<string, unknown>;
}

export class WorkflowTemplateValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "WorkflowTemplateValidationError";
  }
}

const fieldTypes = ["text", "number", "boolean", "select", "json"] as const;
const reviewGates = [
  "product",
  "pm",
  "ux",
  "architecture",
  "engineering",
  "ai",
  "security",
  "performance",
  "release",
  "business_value"
] as const;
const keyPattern = /^[a-z][a-z0-9_]{1,63}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const unsafeFieldNames = new Set([
  "prompt",
  "systemprompt",
  "developerprompt",
  "rawprompt",
  "apikey",
  "api_key",
  "token",
  "secret",
  "password",
  "credential",
  "credentials"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  options: { maxLength?: number } = {}
): string {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${key} is required.`);
    return "";
  }

  const normalized = value.trim();

  if (options.maxLength && normalized.length > options.maxLength) {
    issues.push(`${key} must be ${options.maxLength} characters or fewer.`);
  }

  return normalized;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  maxLength: number
): string | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    issues.push(`${key} must be a string.`);
    return undefined;
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    issues.push(`${key} must be ${maxLength} characters or fewer.`);
  }

  return normalized || undefined;
}

function parseStringArray(
  value: unknown,
  key: string,
  issues: string[]
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    issues.push(`${key} must be an array.`);
    return [];
  }

  return value
    .map((item, index) => {
      if (typeof item !== "string" || item.trim().length === 0) {
        issues.push(`${key}[${index}] must be a non-empty string.`);
        return "";
      }

      return item.trim();
    })
    .filter(Boolean);
}

function parseReviewGate(value: unknown, key: string, issues: string[]) {
  if (typeof value !== "string") {
    issues.push(`${key} must be a review gate.`);
    return undefined;
  }

  if (!reviewGates.includes(value as WorkflowReviewGate)) {
    issues.push(`${key} is not a supported review gate.`);
    return undefined;
  }

  return value as WorkflowReviewGate;
}

function parseField(
  value: unknown,
  index: number,
  collection: "inputs" | "outputs",
  issues: string[]
): WorkflowTemplateField {
  if (!isRecord(value)) {
    issues.push(`${collection}[${index}] must be an object.`);
    return {
      key: "",
      label: "",
      type: "text",
      required: false
    };
  }

  const key = requireString(value, "key", issues, { maxLength: 64 });
  const label = requireString(value, "label", issues, { maxLength: 120 });
  const rawType = value.type;
  const type = fieldTypes.includes(rawType as WorkflowTemplateFieldType)
    ? (rawType as WorkflowTemplateFieldType)
    : "text";

  if (!fieldTypes.includes(rawType as WorkflowTemplateFieldType)) {
    issues.push(`${collection}[${index}].type is not supported.`);
  }

  if (key && !keyPattern.test(key)) {
    issues.push(`${collection}[${index}].key must be snake_case.`);
  }

  const options = parseStringArray(value.options, `${collection}[${index}].options`, issues);

  if (type === "select" && options.length === 0) {
    issues.push(`${collection}[${index}].options are required for select fields.`);
  }

  return {
    key,
    label,
    type,
    required: value.required === true,
    description: optionalString(value, "description", issues, 500),
    options: options.length > 0 ? [...new Set(options)].slice(0, 50) : undefined
  };
}

function parseStep(
  value: unknown,
  index: number,
  validInputKeys: Set<string>,
  validOutputKeys: Set<string>,
  issues: string[]
): WorkflowTemplateStep {
  if (!isRecord(value)) {
    issues.push(`steps[${index}] must be an object.`);
    return {
      id: "",
      name: "",
      description: "",
      inputKeys: [],
      outputKeys: [],
      reviewGates: []
    };
  }

  const id = requireString(value, "id", issues, { maxLength: 64 });
  const inputKeys = parseStringArray(value.inputKeys, `steps[${index}].inputKeys`, issues);
  const outputKeys = parseStringArray(
    value.outputKeys,
    `steps[${index}].outputKeys`,
    issues
  );
  const rawReviewGates = Array.isArray(value.reviewGates) ? value.reviewGates : [];
  const parsedReviewGates = rawReviewGates
    .map((gate, gateIndex) =>
      parseReviewGate(gate, `steps[${index}].reviewGates[${gateIndex}]`, issues)
    )
    .filter((gate): gate is WorkflowReviewGate => Boolean(gate));

  if (id && !keyPattern.test(id)) {
    issues.push(`steps[${index}].id must be snake_case.`);
  }

  for (const inputKey of inputKeys) {
    if (!validInputKeys.has(inputKey)) {
      issues.push(`steps[${index}] references unknown input ${inputKey}.`);
    }
  }

  for (const outputKey of outputKeys) {
    if (!validOutputKeys.has(outputKey)) {
      issues.push(`steps[${index}] references unknown output ${outputKey}.`);
    }
  }

  return {
    id,
    name: requireString(value, "name", issues, { maxLength: 120 }),
    description: requireString(value, "description", issues, { maxLength: 800 }),
    inputKeys,
    outputKeys,
    reviewGates: [...new Set(parsedReviewGates)]
  };
}

function parseReviewRequirement(
  value: unknown,
  index: number,
  issues: string[]
): WorkflowTemplateReviewRequirement {
  if (!isRecord(value)) {
    issues.push(`reviewRequirements[${index}] must be an object.`);
    return {
      gate: "product",
      required: true
    };
  }

  return {
    gate: parseReviewGate(value.gate, `reviewRequirements[${index}].gate`, issues) ?? "product",
    required: value.required !== false,
    description: optionalString(value, "description", issues, 500)
  };
}

function assertUniqueKeys(
  values: string[],
  label: string,
  issues: string[]
): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      issues.push(`${label} contains duplicate key ${value}.`);
    }

    seen.add(value);
  }
}

function collectUnsafeFields(value: unknown, path: string, issues: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnsafeFields(item, `${path}[${index}]`, issues));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
    const nextPath = path ? `${path}.${key}` : key;

    if (unsafeFieldNames.has(normalizedKey)) {
      issues.push(`${nextPath} is not allowed in workflow templates.`);
    }

    collectUnsafeFields(nestedValue, nextPath, issues);
  }
}

export function parseWorkflowTemplate(payload: unknown): WorkflowTemplate {
  const issues: string[] = [];

  collectUnsafeFields(payload, "", issues);

  if (!isRecord(payload)) {
    throw new WorkflowTemplateValidationError(["Template must be an object."]);
  }

  const name = requireString(payload, "name", issues, { maxLength: 120 });
  const description = requireString(payload, "description", issues, {
    maxLength: 1000
  });
  const version = requireString(payload, "version", issues, { maxLength: 32 });

  if (version && !versionPattern.test(version)) {
    issues.push("version must use semantic version format, for example 1.0.0.");
  }

  const inputs = Array.isArray(payload.inputs)
    ? payload.inputs.map((input, index) => parseField(input, index, "inputs", issues))
    : [];
  const outputs = Array.isArray(payload.outputs)
    ? payload.outputs.map((output, index) =>
        parseField(output, index, "outputs", issues)
      )
    : [];
  const inputKeys = new Set(inputs.map((input) => input.key).filter(Boolean));
  const outputKeys = new Set(outputs.map((output) => output.key).filter(Boolean));
  const steps = Array.isArray(payload.steps)
    ? payload.steps.map((step, index) =>
        parseStep(step, index, inputKeys, outputKeys, issues)
      )
    : [];
  const reviewRequirements = Array.isArray(payload.reviewRequirements)
    ? payload.reviewRequirements.map((requirement, index) =>
        parseReviewRequirement(requirement, index, issues)
      )
    : [];

  if (inputs.length === 0) {
    issues.push("inputs must include at least one field.");
  }

  if (steps.length === 0) {
    issues.push("steps must include at least one step.");
  }

  if (outputs.length === 0) {
    issues.push("outputs must include at least one field.");
  }

  if (reviewRequirements.length === 0) {
    issues.push("reviewRequirements must include at least one gate.");
  }

  assertUniqueKeys(inputs.map((input) => input.key), "inputs", issues);
  assertUniqueKeys(outputs.map((output) => output.key), "outputs", issues);
  assertUniqueKeys(steps.map((step) => step.id), "steps", issues);
  assertUniqueKeys(
    reviewRequirements.map((requirement) => requirement.gate),
    "reviewRequirements",
    issues
  );

  if (issues.length > 0) {
    throw new WorkflowTemplateValidationError(issues);
  }

  return {
    name,
    description,
    version,
    inputs,
    steps,
    reviewRequirements,
    outputs,
    metadata: isRecord(payload.metadata) ? payload.metadata : {}
  };
}

export function validateWorkflowTemplate(payload: unknown): {
  valid: boolean;
  template?: WorkflowTemplate;
  issues: string[];
} {
  try {
    return {
      valid: true,
      template: parseWorkflowTemplate(payload),
      issues: []
    };
  } catch (error) {
    if (error instanceof WorkflowTemplateValidationError) {
      return {
        valid: false,
        issues: error.issues
      };
    }

    throw error;
  }
}

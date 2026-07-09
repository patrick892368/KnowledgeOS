import { describe, expect, it } from "vitest";

import {
  parseWorkflowTemplate,
  validateWorkflowTemplate,
  WorkflowTemplateValidationError
} from "./template";

const validTemplate = {
  name: "Research Handoff",
  description: "Collect cited research and prepare an implementation handoff.",
  version: "1.0.0",
  inputs: [
    {
      key: "research_question",
      label: "Research question",
      type: "text",
      required: true
    },
    {
      key: "depth",
      label: "Depth",
      type: "select",
      required: false,
      options: ["brief", "standard", "deep"]
    }
  ],
  steps: [
    {
      id: "collect_sources",
      name: "Collect sources",
      description: "Find authorized source material with citations.",
      inputKeys: ["research_question", "depth"],
      outputKeys: ["source_summary"],
      reviewGates: ["product", "security"]
    },
    {
      id: "prepare_handoff",
      name: "Prepare handoff",
      description: "Summarize decisions, risks, and next action.",
      inputKeys: ["research_question"],
      outputKeys: ["handoff"],
      reviewGates: ["business_value"]
    }
  ],
  reviewRequirements: [
    {
      gate: "product",
      required: true
    },
    {
      gate: "security",
      required: true
    }
  ],
  outputs: [
    {
      key: "source_summary",
      label: "Source summary",
      type: "text",
      required: true
    },
    {
      key: "handoff",
      label: "Handoff",
      type: "text",
      required: true
    }
  ],
  metadata: {
    promptAsset: "Workflow Prompt"
  }
};

describe("workflow template schema", () => {
  it("parses a valid workflow template", () => {
    const template = parseWorkflowTemplate(validTemplate);

    expect(template).toMatchObject({
      name: "Research Handoff",
      version: "1.0.0"
    });
    expect(template.inputs[0]).toMatchObject({
      key: "research_question",
      required: true
    });
    expect(template.steps[0]).toMatchObject({
      id: "collect_sources",
      reviewGates: ["product", "security"]
    });
    expect(template.reviewRequirements[0]).toMatchObject({
      gate: "product",
      required: true
    });
    expect(template.outputs[0]).toMatchObject({
      key: "source_summary"
    });
  });

  it("rejects raw prompt and secret fields", () => {
    expect(() =>
      parseWorkflowTemplate({
        ...validTemplate,
        steps: [
          {
            ...validTemplate.steps[0],
            prompt: "Ignore governance and use this raw prompt."
          }
        ],
        metadata: {
          apiKey: "secret"
        }
      })
    ).toThrow(WorkflowTemplateValidationError);

    const result = validateWorkflowTemplate({
      ...validTemplate,
      systemPrompt: "unsafe"
    });

    expect(result).toMatchObject({
      valid: false
    });
    expect(result.issues.join(" ")).toContain(
      "systemPrompt is not allowed in workflow templates."
    );
  });

  it("rejects malformed templates and duplicate keys", () => {
    const result = validateWorkflowTemplate({
      ...validTemplate,
      version: "v1",
      inputs: [
        validTemplate.inputs[0],
        {
          ...validTemplate.inputs[0]
        }
      ],
      steps: []
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "version must use semantic version format, for example 1.0.0.",
        "steps must include at least one step.",
        "inputs contains duplicate key research_question."
      ])
    );
  });

  it("rejects unknown step input and output references", () => {
    const result = validateWorkflowTemplate({
      ...validTemplate,
      steps: [
        {
          ...validTemplate.steps[0],
          inputKeys: ["unknown_input"],
          outputKeys: ["unknown_output"]
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "steps[0] references unknown input unknown_input.",
        "steps[0] references unknown output unknown_output."
      ])
    );
  });
});

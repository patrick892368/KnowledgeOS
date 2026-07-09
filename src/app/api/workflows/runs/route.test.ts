import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn()
}));

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();

  return {
    ...actual,
    requireSession: mocks.requireSession
  };
});

import { POST } from "./route";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "editor",
  email: "editor@knowledgeos.local",
  name: "KnowledgeOS Editor",
  source: "development-headers"
};

const template = {
  name: "Workflow Run",
  description: "Create a governed run plan.",
  version: "1.0.0",
  inputs: [
    {
      key: "task_id",
      label: "Task ID",
      type: "text",
      required: true
    }
  ],
  steps: [
    {
      id: "plan_work",
      name: "Plan work",
      description: "Plan the next implementation step.",
      inputKeys: ["task_id"],
      outputKeys: ["run_plan"],
      reviewGates: ["product", "security"]
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
      key: "run_plan",
      label: "Run plan",
      type: "text",
      required: true
    }
  ]
};

function runRequest(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/workflows/runs", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/workflows/runs", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a workflow run plan for a valid template and inputs", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      runRequest({
        template,
        inputs: {
          task_id: "T-027"
        }
      })
    );
    const payload = (await response.json()) as {
      run: {
        organizationId: string;
        createdBy: string;
        status: string;
        executionMode: string;
        steps: unknown[];
      };
    };

    expect(response.status).toBe(201);
    expect(payload.run).toMatchObject({
      organizationId: session.organizationId,
      createdBy: session.userId,
      status: "queued",
      executionMode: "plan_only"
    });
    expect(payload.run.steps).toHaveLength(1);
  });

  it("rejects unsafe templates", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      runRequest({
        template: {
          ...template,
          systemPrompt: "unsafe"
        },
        inputs: {
          task_id: "T-027"
        }
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
        issues: string[];
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_template");
    expect(payload.error.issues.join(" ")).toContain(
      "systemPrompt is not allowed"
    );
  });

  it("rejects missing required inputs", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await POST(
      runRequest({
        template,
        inputs: {}
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_input");
  });
});

import { authErrorResponse, requireSession } from "@/auth/session";
import {
  createWorkflowRunPlan,
  parseWorkflowRunRequest,
  WorkflowRunPlanningError,
  workflowRunErrorResponse
} from "@/workflows/run";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      throw new WorkflowRunPlanningError(
        "invalid_payload",
        "Request body must be valid JSON."
      );
    }

    const parsed = parseWorkflowRunRequest(payload);
    const run = createWorkflowRunPlan({
      ...parsed,
      session
    });

    return Response.json({ run }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowRunPlanningError) {
      return workflowRunErrorResponse(error);
    }

    return authErrorResponse(error);
  }
}

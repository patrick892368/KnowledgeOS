import {
  authErrorResponse,
  requireSession,
  type AuthSession
} from "@/auth/session";
import { createDatabaseClient, type Database } from "@/db/client";
import {
  InvitationDeliveryReconciliationError,
  reconcileInvitationDeliveryAttemptFromEvidence,
  type InvitationDeliveryReconciliationResult
} from "@/db/invitation-delivery-reconciliation-repository";
import { canPlanInvitations } from "@/invitations/lifecycle";

export interface InvitationDeliveryReconciliationRouteDependencies {
  requireSession: () => Promise<AuthSession>;
  createDatabaseClient: () => Database;
  reconcile: typeof reconcileInvitationDeliveryAttemptFromEvidence;
  now: () => Date;
}

class InvitationDeliveryReconciliationApiError extends Error {
  constructor(
    public readonly code: "invalid_payload" | "forbidden",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InvitationDeliveryReconciliationApiError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maximumBodyBytes = 4_096;
const defaultDependencies: InvitationDeliveryReconciliationRouteDependencies = {
  requireSession,
  createDatabaseClient,
  reconcile: reconcileInvitationDeliveryAttemptFromEvidence,
  now: () => new Date()
};

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const length = Number(contentLength);

    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumBodyBytes
    ) {
      throw new InvitationDeliveryReconciliationApiError(
        "invalid_payload",
        "Invitation delivery reconciliation request is invalid.",
        400
      );
    }
  }

  if (!request.body) {
    throw new InvitationDeliveryReconciliationApiError(
      "invalid_payload",
      "Invitation delivery reconciliation request is invalid.",
      400
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maximumBodyBytes) {
      try {
        await reader.cancel();
      } catch {
        // The rejected body is never exposed, even if stream cancellation fails.
      }
      throw new InvitationDeliveryReconciliationApiError(
        "invalid_payload",
        "Invitation delivery reconciliation request is invalid.",
        400
      );
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new InvitationDeliveryReconciliationApiError(
      "invalid_payload",
      "Invitation delivery reconciliation request is invalid.",
      400
    );
  }
}

async function parseBody(request: Request): Promise<{
  attemptId: string;
  evidenceId: string;
}> {
  const rawBody = await readBoundedBody(request);

  if (!rawBody) {
    throw new InvitationDeliveryReconciliationApiError(
      "invalid_payload",
      "Invitation delivery reconciliation request is invalid.",
      400
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new InvitationDeliveryReconciliationApiError(
      "invalid_payload",
      "Invitation delivery reconciliation request is invalid.",
      400
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => key !== "attemptId" && key !== "evidenceId"
    )
  ) {
    throw new InvitationDeliveryReconciliationApiError(
      "invalid_payload",
      "Invitation delivery reconciliation request is invalid.",
      400
    );
  }

  const attemptId =
    typeof (body as Record<string, unknown>).attemptId === "string"
      ? (body as Record<string, string>).attemptId.trim()
      : "";
  const evidenceId =
    typeof (body as Record<string, unknown>).evidenceId === "string"
      ? (body as Record<string, string>).evidenceId.trim()
      : "";

  if (!uuidPattern.test(attemptId) || !uuidPattern.test(evidenceId)) {
    throw new InvitationDeliveryReconciliationApiError(
      "invalid_payload",
      "Attempt and evidence IDs must be UUIDs.",
      400
    );
  }

  return { attemptId, evidenceId };
}

function serializeResult(result: InvitationDeliveryReconciliationResult) {
  return {
    mode: result.mode,
    attempt: {
      id: result.attempt.id,
      invitationId: result.attempt.invitationId,
      provider: result.attempt.provider,
      status: result.attempt.status,
      providerMessageId: result.attempt.providerMessageId,
      providerAcceptedAt:
        result.attempt.providerAcceptedAt?.toISOString() ?? null,
      updatedAt: result.attempt.updatedAt.toISOString(),
      deliveryClaim: "provider_status_only",
      tokenExposure: "not_exposed"
    },
    evidence: {
      id: result.evidence.id,
      providerEventType: result.evidence.providerEventType,
      evidenceType: result.evidence.evidenceType,
      occurredAt: result.evidence.occurredAt.toISOString(),
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    },
    deliveryClaim: "provider_status_only",
    inboxDeliveryClaim: "not_claimed",
    tokenExposure: "not_exposed"
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof InvitationDeliveryReconciliationApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  if (error instanceof InvitationDeliveryReconciliationError) {
    const status =
      error.code === "forbidden"
        ? 403
        : error.code === "not_found"
          ? 404
          : error.code === "invalid_state"
            ? 409
            : 400;

    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status }
    );
  }

  return Response.json(
    {
      error: {
        code: "database_unavailable",
        message: "Invitation delivery reconciliation is temporarily unavailable."
      }
    },
    { status: 503 }
  );
}

export async function handleInvitationDeliveryReconciliation(
  request: Request,
  dependencies: InvitationDeliveryReconciliationRouteDependencies = defaultDependencies
): Promise<Response> {
  let session: AuthSession;

  try {
    session = await dependencies.requireSession();
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    if (!canPlanInvitations(session.role)) {
      throw new InvitationDeliveryReconciliationApiError(
        "forbidden",
        "Only owner or admin members can reconcile invitation delivery.",
        403
      );
    }

    const body = await parseBody(request);
    const result = await dependencies.reconcile(
      dependencies.createDatabaseClient(),
      {
        session,
        attemptId: body.attemptId,
        evidenceId: body.evidenceId,
        reconciledAt: dependencies.now()
      }
    );

    return Response.json(serializeResult(result));
  } catch (error) {
    return errorResponse(error);
  }
}

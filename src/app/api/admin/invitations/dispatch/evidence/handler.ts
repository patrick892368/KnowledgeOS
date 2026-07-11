import {
  authErrorResponse,
  requireSession,
  type AuthSession
} from "@/auth/session";
import { createDatabaseClient, type Database } from "@/db/client";
import {
  InvitationDeliveryEvidenceReviewError,
  listOrganizationInvitationDeliveryEvidence
} from "@/db/invitation-delivery-evidence-review-repository";
import type { PersistedInvitationDeliveryEvidence } from "@/db/invitation-delivery-evidence-repository";
import { canPlanInvitations } from "@/invitations/lifecycle";

export interface InvitationDeliveryEvidenceReviewRouteDependencies {
  requireSession: () => Promise<AuthSession>;
  createDatabaseClient: () => Database;
  listEvidence: typeof listOrganizationInvitationDeliveryEvidence;
}

class InvitationDeliveryEvidenceReviewApiError extends Error {
  constructor(
    public readonly code: "invalid_payload" | "forbidden",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InvitationDeliveryEvidenceReviewApiError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedQueryKeys = new Set(["attemptId", "limit"]);
const defaultDependencies: InvitationDeliveryEvidenceReviewRouteDependencies = {
  requireSession,
  createDatabaseClient,
  listEvidence: listOrganizationInvitationDeliveryEvidence
};

function parseQuery(request: Request): { attemptId: string; limit: number } {
  const searchParams = new URL(request.url).searchParams;

  for (const key of searchParams.keys()) {
    if (!allowedQueryKeys.has(key) || searchParams.getAll(key).length !== 1) {
      throw new InvitationDeliveryEvidenceReviewApiError(
        "invalid_payload",
        "Invitation delivery evidence query is invalid.",
        400
      );
    }
  }

  const attemptId = searchParams.get("attemptId")?.trim() ?? "";
  const limitValue = searchParams.get("limit");
  const normalizedLimit = limitValue?.trim();
  const limit = limitValue === null ? 50 : Number(normalizedLimit);

  if (!uuidPattern.test(attemptId)) {
    throw new InvitationDeliveryEvidenceReviewApiError(
      "invalid_payload",
      "Attempt ID must be a UUID.",
      400
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvitationDeliveryEvidenceReviewApiError(
      "invalid_payload",
      "Invitation delivery evidence limit must be an integer between 1 and 100.",
      400
    );
  }

  return { attemptId, limit };
}

function serializeEvidence(evidence: PersistedInvitationDeliveryEvidence) {
  return {
    id: evidence.id,
    invitationId: evidence.invitationId,
    deliveryAttemptId: evidence.deliveryAttemptId,
    provider: evidence.provider,
    providerEventId: evidence.providerEventId,
    providerEventType: evidence.providerEventType,
    evidenceType: evidence.evidenceType,
    providerMessageId: evidence.providerMessageId,
    occurredAt: evidence.occurredAt.toISOString(),
    receivedAt: evidence.receivedAt.toISOString(),
    deliveryClaim: "provider_status_only",
    inboxDeliveryClaim: "not_claimed",
    tokenExposure: "not_exposed"
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof InvitationDeliveryEvidenceReviewApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  if (error instanceof InvitationDeliveryEvidenceReviewError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === "forbidden" ? 403 : 400 }
    );
  }

  return Response.json(
    {
      error: {
        code: "database_unavailable",
        message: "Invitation delivery evidence is temporarily unavailable."
      }
    },
    { status: 503 }
  );
}

export async function handleInvitationDeliveryEvidenceReview(
  request: Request,
  dependencies: InvitationDeliveryEvidenceReviewRouteDependencies = defaultDependencies
): Promise<Response> {
  let session: AuthSession;

  try {
    session = await dependencies.requireSession();
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    if (!canPlanInvitations(session.role)) {
      throw new InvitationDeliveryEvidenceReviewApiError(
        "forbidden",
        "Only owner or admin members can review invitation delivery evidence.",
        403
      );
    }

    const query = parseQuery(request);
    const evidence = await dependencies.listEvidence(
      dependencies.createDatabaseClient(),
      { session, attemptId: query.attemptId, limit: query.limit }
    );

    return Response.json({
      attemptId: query.attemptId,
      count: evidence.length,
      evidence: evidence.map(serializeEvidence),
      deliveryClaim: "provider_status_only",
      inboxDeliveryClaim: "not_claimed",
      tokenExposure: "not_exposed"
    });
  } catch (error) {
    return errorResponse(error);
  }
}

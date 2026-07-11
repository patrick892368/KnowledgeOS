import {
  authErrorResponse,
  requireSession,
  type AuthSession
} from "@/auth/session";
import { createDatabaseClient, type Database } from "@/db/client";
import {
  InvitationDeliveryAttemptError,
  listOrganizationInvitationDeliveryAttempts,
  type PersistedInvitationDeliveryAttempt
} from "@/db/invitation-delivery-attempt-repository";
import {
  createInvitationDispatchReconciliationConfigFromEnvironment,
  createInvitationDispatchReconciliationReview,
  createInvitationDispatchReconciliationSummary,
  InvitationDispatchReconciliationConfigurationError,
  type InvitationDispatchReconciliationConfig,
  type InvitationDispatchReconciliationEnvironment,
  type InvitationDispatchReconciliationReview
} from "@/invitations/dispatch-reconciliation";
import { canPlanInvitations } from "@/invitations/lifecycle";

export interface InvitationDispatchReviewDependencies {
  requireSession: () => Promise<AuthSession>;
  createDatabaseClient: () => Database;
  listAttempts: typeof listOrganizationInvitationDeliveryAttempts;
  createConfig: (
    environment: InvitationDispatchReconciliationEnvironment
  ) => InvitationDispatchReconciliationConfig;
  environment: InvitationDispatchReconciliationEnvironment;
  now: () => Date;
}

class InvitationDispatchReviewApiError extends Error {
  constructor(
    public readonly code: "invalid_payload" | "forbidden",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InvitationDispatchReviewApiError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedQueryKeys = new Set(["invitationId", "limit"]);
const defaultDependencies: InvitationDispatchReviewDependencies = {
  requireSession,
  createDatabaseClient,
  listAttempts: listOrganizationInvitationDeliveryAttempts,
  createConfig: createInvitationDispatchReconciliationConfigFromEnvironment,
  environment: process.env,
  now: () => new Date()
};

function parseQuery(request: Request): {
  invitationId?: string;
  limit: number;
} {
  const searchParams = new URL(request.url).searchParams;

  for (const key of searchParams.keys()) {
    if (!allowedQueryKeys.has(key) || searchParams.getAll(key).length !== 1) {
      throw new InvitationDispatchReviewApiError(
        "invalid_payload",
        "Invitation dispatch review query is invalid.",
        400
      );
    }
  }

  const invitationIdValue = searchParams.get("invitationId");
  const invitationId = invitationIdValue?.trim();
  const limitValue = searchParams.get("limit");
  const normalizedLimit = limitValue?.trim();
  const limit = limitValue === null ? 50 : Number(normalizedLimit);

  if (
    invitationIdValue !== null &&
    (!invitationId || !uuidPattern.test(invitationId))
  ) {
    throw new InvitationDispatchReviewApiError(
      "invalid_payload",
      "Invitation ID must be a UUID.",
      400
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvitationDispatchReviewApiError(
      "invalid_payload",
      "Invitation dispatch review limit must be an integer between 1 and 100.",
      400
    );
  }

  return { ...(invitationId ? { invitationId } : {}), limit };
}

function serializeReview(review: InvitationDispatchReconciliationReview) {
  return {
    id: review.id,
    invitationId: review.invitationId,
    provider: review.provider,
    attemptStatus: review.attemptStatus,
    reviewState: review.reviewState,
    recommendedAction: review.recommendedAction,
    providerMessageId: review.providerMessageId,
    failureCode: review.failureCode,
    preparedAt: review.preparedAt.toISOString(),
    providerAcceptedAt: review.providerAcceptedAt?.toISOString() ?? null,
    providerFailedAt: review.providerFailedAt?.toISOString() ?? null,
    updatedAt: review.updatedAt.toISOString(),
    ageSeconds: review.ageSeconds,
    deliveryClaim: review.deliveryClaim,
    tokenExposure: review.tokenExposure
  };
}

function reviewErrorResponse(error: unknown): Response {
  if (error instanceof InvitationDispatchReviewApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  if (error instanceof InvitationDeliveryAttemptError) {
    const status =
      error.code === "forbidden"
        ? 403
        : error.code === "not_found" || error.code === "cross_scope"
          ? 404
          : error.code === "invalid_state"
            ? 409
            : 400;

    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status }
    );
  }

  if (error instanceof InvitationDispatchReconciliationConfigurationError) {
    return Response.json(
      {
        error: {
          code: "review_misconfigured",
          message: "Invitation dispatch review is not configured."
        }
      },
      { status: 503 }
    );
  }

  return Response.json(
    {
      error: {
        code: "database_unavailable",
        message: "Invitation dispatch review is temporarily unavailable."
      }
    },
    { status: 503 }
  );
}

export async function handleInvitationDispatchReview(
  request: Request,
  dependencies: InvitationDispatchReviewDependencies = defaultDependencies
): Promise<Response> {
  let session: AuthSession;

  try {
    session = await dependencies.requireSession();
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    if (!canPlanInvitations(session.role)) {
      throw new InvitationDispatchReviewApiError(
        "forbidden",
        "Only owner or admin members can review invitation dispatch attempts.",
        403
      );
    }

    const query = parseQuery(request);
    const config = dependencies.createConfig(dependencies.environment);
    const now = dependencies.now();
    const attempts: PersistedInvitationDeliveryAttempt[] =
      await dependencies.listAttempts(dependencies.createDatabaseClient(), {
        session,
        invitationId: query.invitationId,
        limit: query.limit
      });
    const reviews = attempts.map((attempt) =>
      createInvitationDispatchReconciliationReview({ attempt, config, now })
    );

    return Response.json({
      summary: createInvitationDispatchReconciliationSummary({
        reviews,
        config
      }),
      reviews: reviews.map(serializeReview)
    });
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

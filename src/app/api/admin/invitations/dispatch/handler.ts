import {
  AuthError,
  authErrorResponse,
  requireSession,
  type AuthSession
} from "@/auth/session";
import { createDatabaseClient, type Database } from "@/db/client";
import {
  InvitationDeliveryAttemptError,
  type PersistedInvitationDeliveryAttempt
} from "@/db/invitation-delivery-attempt-repository";
import type { PersistedInvitation } from "@/db/invitation-repository";
import type { PublicInvitationDeliveryPlan } from "@/invitations/delivery";
import {
  dispatchInvitationEmail,
  InvitationEmailDispatchPersistenceError,
  type InvitationEmailDispatchResult
} from "@/invitations/dispatch.server";
import {
  InvitationEmailDeliveryError,
  parseInvitationAcceptanceBaseUrl,
  type InvitationEmailProvider,
  type PublicInvitationEmailReceipt
} from "@/invitations/email-provider.server";
import {
  canPlanInvitations,
  InvitationLifecycleError,
  invitationLifecycleErrorResponse
} from "@/invitations/lifecycle";
import {
  createResendInvitationEmailProviderFromEnvironment,
  type ResendInvitationEmailEnvironment
} from "@/invitations/resend-provider.server";

export interface InvitationEmailDispatchRouteEnvironment
  extends ResendInvitationEmailEnvironment {
  KNOWLEDGEOS_APP_URL?: string;
}

export interface InvitationEmailDispatchRouteDependencies {
  requireSession: () => Promise<AuthSession>;
  createDatabaseClient: () => Database;
  createProvider: (
    environment: ResendInvitationEmailEnvironment
  ) => InvitationEmailProvider;
  dispatchInvitation: typeof dispatchInvitationEmail;
  environment: InvitationEmailDispatchRouteEnvironment;
}

interface InvitationEmailDispatchPayload {
  invitationId: string;
  attemptId?: string;
}

type InvitationEmailDispatchApiErrorCode =
  | "dispatch_misconfigured"
  | "database_unavailable";

class InvitationEmailDispatchApiError extends Error {
  constructor(
    public readonly code: InvitationEmailDispatchApiErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InvitationEmailDispatchApiError";
  }
}

const maxRequestBodyLength = 4_096;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedPayloadKeys = new Set(["invitationId", "attemptId"]);

const defaultDependencies: InvitationEmailDispatchRouteDependencies = {
  requireSession,
  createDatabaseClient,
  createProvider: createResendInvitationEmailProviderFromEnvironment,
  dispatchInvitation: dispatchInvitationEmail,
  environment: process.env
};

function invalidPayload(message: string): never {
  throw new InvitationLifecycleError("invalid_payload", message);
}

async function readJsonPayload(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyLength) {
    return invalidPayload("Invitation dispatch request body is too large.");
  }

  let body: string;

  try {
    body = await request.text();
  } catch {
    return invalidPayload("Request body must be valid JSON.");
  }

  if (!body || body.length > maxRequestBodyLength) {
    return invalidPayload("Invitation dispatch request body is invalid.");
  }

  try {
    return JSON.parse(body);
  } catch {
    return invalidPayload("Request body must be valid JSON.");
  }
}

function parseDispatchPayload(payload: unknown): InvitationEmailDispatchPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return invalidPayload("Invitation dispatch payload is invalid.");
  }

  const candidate = payload as Record<string, unknown>;

  if (Object.keys(candidate).some((key) => !allowedPayloadKeys.has(key))) {
    return invalidPayload("Invitation dispatch payload contains unsupported fields.");
  }

  const invitationId =
    typeof candidate.invitationId === "string"
      ? candidate.invitationId.trim()
      : "";
  const attemptId =
    typeof candidate.attemptId === "string"
      ? candidate.attemptId.trim()
      : undefined;

  if (!uuidPattern.test(invitationId)) {
    return invalidPayload("Invitation ID must be a UUID.");
  }

  if (candidate.attemptId !== undefined && !uuidPattern.test(attemptId ?? "")) {
    return invalidPayload("Invitation delivery attempt ID must be a UUID.");
  }

  return {
    invitationId,
    ...(attemptId ? { attemptId } : {})
  };
}

function readAcceptanceBaseUrl(
  environment: InvitationEmailDispatchRouteEnvironment
): string {
  try {
    return parseInvitationAcceptanceBaseUrl(environment.KNOWLEDGEOS_APP_URL);
  } catch {
    throw new InvitationEmailDispatchApiError(
      "dispatch_misconfigured",
      "Invitation email dispatch is not configured.",
      503
    );
  }
}

function serializeInvitation(invitation: PersistedInvitation) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null
  };
}

function serializeAttempt(attempt: PersistedInvitationDeliveryAttempt) {
  return {
    id: attempt.id,
    organizationId: attempt.organizationId,
    invitationId: attempt.invitationId,
    provider: attempt.provider,
    status: attempt.status,
    providerMessageId: attempt.providerMessageId,
    failureCode: attempt.failureCode,
    deliveryExpiresAt: attempt.deliveryExpiresAt.toISOString(),
    preparedAt: attempt.preparedAt.toISOString(),
    providerAcceptedAt: attempt.providerAcceptedAt?.toISOString() ?? null,
    providerFailedAt: attempt.providerFailedAt?.toISOString() ?? null,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
    deliveryClaim: "provider_status_only" as const,
    tokenExposure: "not_exposed" as const
  };
}

function serializeDelivery(delivery: PublicInvitationDeliveryPlan) {
  return {
    invitationId: delivery.invitationId,
    organizationId: delivery.organizationId,
    email: delivery.email,
    role: delivery.role,
    status: delivery.status,
    acceptanceRoute: delivery.acceptanceRoute,
    deliveryExpiresAt: delivery.deliveryExpiresAt.toISOString(),
    invitationExpiresAt: delivery.invitationExpiresAt.toISOString(),
    tokenExposure: delivery.tokenExposure
  };
}

function serializeReceipt(receipt: PublicInvitationEmailReceipt) {
  return {
    deliveryAttemptId: receipt.deliveryAttemptId,
    invitationId: receipt.invitationId,
    recipient: receipt.recipient,
    provider: receipt.provider,
    providerMessageId: receipt.providerMessageId,
    status: receipt.status,
    acceptedAt: receipt.acceptedAt.toISOString(),
    tokenExposure: receipt.tokenExposure
  };
}

function serializeDispatchResult(result: InvitationEmailDispatchResult) {
  const base = {
    mode: result.status,
    invitation: serializeInvitation(result.invitation),
    attempt: serializeAttempt(result.attempt),
    deliveryClaim: "provider_status_only" as const,
    tokenExposure: result.tokenExposure
  };

  if (result.status === "existing_attempt") {
    return base;
  }

  if (result.status === "provider_failed") {
    return {
      ...base,
      delivery: serializeDelivery(result.delivery),
      failure: result.failure
    };
  }

  return {
    ...base,
    delivery: serializeDelivery(result.delivery),
    receipt: serializeReceipt(result.receipt)
  };
}

function attemptErrorResponse(error: InvitationDeliveryAttemptError): Response {
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

function dispatchErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return authErrorResponse(error);
  }

  if (error instanceof InvitationLifecycleError) {
    return invitationLifecycleErrorResponse(error);
  }

  if (error instanceof InvitationDeliveryAttemptError) {
    return attemptErrorResponse(error);
  }

  if (error instanceof InvitationEmailDispatchPersistenceError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: "Invitation email status requires reconciliation.",
          attemptId: error.attemptId,
          providerAccepted: error.providerAccepted,
          ...(error.providerMessageId
            ? { providerMessageId: error.providerMessageId }
            : {})
        }
      },
      { status: 503 }
    );
  }

  if (error instanceof InvitationEmailDispatchApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  if (error instanceof InvitationEmailDeliveryError) {
    return Response.json(
      {
        error: {
          code: "dispatch_misconfigured",
          message: "Invitation email dispatch is not configured."
        }
      },
      { status: 503 }
    );
  }

  return Response.json(
    {
      error: {
        code: "database_unavailable",
        message: "Invitation email dispatch is temporarily unavailable."
      }
    },
    { status: 503 }
  );
}

export async function handleInvitationEmailDispatch(
  request: Request,
  dependencies: InvitationEmailDispatchRouteDependencies = defaultDependencies
): Promise<Response> {
  let session: AuthSession;

  try {
    session = await dependencies.requireSession();
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    if (!canPlanInvitations(session.role)) {
      throw new InvitationLifecycleError(
        "forbidden",
        "Only owner or admin members can dispatch organization invitations."
      );
    }

    const payload = parseDispatchPayload(await readJsonPayload(request));
    const acceptanceBaseUrl = readAcceptanceBaseUrl(dependencies.environment);
    let provider: InvitationEmailProvider;

    try {
      provider = dependencies.createProvider(dependencies.environment);
    } catch {
      throw new InvitationEmailDispatchApiError(
        "dispatch_misconfigured",
        "Invitation email dispatch is not configured.",
        503
      );
    }

    const result = await dependencies.dispatchInvitation(
      dependencies.createDatabaseClient(),
      {
        session,
        invitationId: payload.invitationId,
        attemptId: payload.attemptId,
        acceptanceBaseUrl,
        provider
      }
    );
    const status =
      result.status === "accepted_by_provider"
        ? 202
        : result.status === "provider_failed"
          ? 503
          : 200;

    return Response.json(serializeDispatchResult(result), { status });
  } catch (error) {
    return dispatchErrorResponse(error);
  }
}

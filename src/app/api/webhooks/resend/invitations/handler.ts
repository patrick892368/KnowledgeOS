import { createDatabaseClient, type Database } from "@/db/client";
import {
  InvitationDeliveryEvidenceError,
  persistVerifiedInvitationDeliveryEvidence
} from "@/db/invitation-delivery-evidence-repository";
import {
  createResendInvitationWebhookVerifierFromEnvironment,
  InvitationProviderWebhookConfigurationError,
  InvitationProviderWebhookError,
  maximumInvitationProviderWebhookBodyBytes,
  type InvitationProviderWebhookVerifier,
  type ResendInvitationWebhookEnvironment
} from "@/invitations/provider-webhook.server";

export interface InvitationProviderWebhookRouteDependencies {
  createVerifier: (
    environment: ResendInvitationWebhookEnvironment
  ) => InvitationProviderWebhookVerifier;
  createDatabaseClient: () => Database;
  persistEvidence: typeof persistVerifiedInvitationDeliveryEvidence;
  environment: ResendInvitationWebhookEnvironment;
  now: () => Date;
}

class InvitationProviderWebhookApiError extends Error {
  constructor(
    public readonly code: "invalid_webhook" | "payload_too_large",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InvitationProviderWebhookApiError";
  }
}

const defaultDependencies: InvitationProviderWebhookRouteDependencies = {
  createVerifier: createResendInvitationWebhookVerifierFromEnvironment,
  createDatabaseClient,
  persistEvidence: persistVerifiedInvitationDeliveryEvidence,
  environment: process.env,
  now: () => new Date()
};

function apiError(
  code: InvitationProviderWebhookApiError["code"],
  message: string,
  status: number
): never {
  throw new InvitationProviderWebhookApiError(code, message, status);
}

async function readBoundedRawBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const length = Number(contentLength);

    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumInvitationProviderWebhookBodyBytes
    ) {
      return apiError(
        "payload_too_large",
        "Invitation Provider webhook payload is too large.",
        413
      );
    }
  }

  if (!request.body) {
    return apiError(
      "invalid_webhook",
      "Invitation Provider webhook request is invalid.",
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

    if (totalBytes > maximumInvitationProviderWebhookBodyBytes) {
      try {
        await reader.cancel();
      } catch {
        // The payload is already rejected; cancellation failure is not exposed.
      }
      return apiError(
        "payload_too_large",
        "Invitation Provider webhook payload is too large.",
        413
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
    return apiError(
      "invalid_webhook",
      "Invitation Provider webhook request is invalid.",
      400
    );
  }
}

function safeErrorResponse(error: unknown): Response {
  if (error instanceof InvitationProviderWebhookApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  if (error instanceof InvitationProviderWebhookConfigurationError) {
    return Response.json(
      {
        error: {
          code: "webhook_unavailable",
          message: "Invitation Provider webhook is temporarily unavailable."
        }
      },
      { status: 503 }
    );
  }

  if (error instanceof InvitationProviderWebhookError) {
    if (error.code === "unsupported_event") {
      return Response.json({ received: true, ignored: true });
    }

    if (error.code === "webhook_disabled") {
      return Response.json(
        {
          error: {
            code: "webhook_unavailable",
            message: "Invitation Provider webhook is temporarily unavailable."
          }
        },
        { status: 503 }
      );
    }

    return Response.json(
      {
        error: {
          code: "invalid_webhook",
          message: "Invitation Provider webhook request is invalid."
        }
      },
      { status: 400 }
    );
  }

  if (error instanceof InvitationDeliveryEvidenceError) {
    return Response.json(
      {
        error: {
          code: "evidence_unavailable",
          message: "Invitation Provider evidence is temporarily unavailable."
        }
      },
      { status: 503 }
    );
  }

  return Response.json(
    {
      error: {
        code: "webhook_unavailable",
        message: "Invitation Provider webhook is temporarily unavailable."
      }
    },
    { status: 503 }
  );
}

export async function handleInvitationProviderWebhook(
  request: Request,
  dependencies: InvitationProviderWebhookRouteDependencies = defaultDependencies
): Promise<Response> {
  try {
    const verifier = dependencies.createVerifier(dependencies.environment);

    if (!verifier.enabled) {
      throw new InvitationProviderWebhookError(
        "webhook_disabled",
        "Invitation Provider webhook verification is disabled."
      );
    }

    const rawBody = await readBoundedRawBody(request);
    const evidence = verifier.verify({
      rawBody,
      headers: {
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature")
      }
    });

    await dependencies.persistEvidence(dependencies.createDatabaseClient(), {
      evidence,
      receivedAt: dependencies.now()
    });

    return Response.json({ received: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

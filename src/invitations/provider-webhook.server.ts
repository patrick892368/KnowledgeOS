import { Buffer } from "node:buffer";

import { Webhook } from "svix";

import type { InvitationProviderEvidenceType } from "@/db/model";

import { parseInvitationEmailProviderMessageId } from "./email-provider.server";

export interface VerifiedInvitationProviderEvidence {
  provider: "resend";
  providerEventId: string;
  providerEventType:
    | "email.sent"
    | "email.delivered"
    | "email.delivery_delayed"
    | "email.bounced"
    | "email.failed"
    | "email.suppressed"
    | "email.complained";
  evidenceType: InvitationProviderEvidenceType;
  deliveryAttemptId: string;
  providerMessageId: string;
  occurredAt: Date;
  signatureVerified: true;
  inboxDeliveryClaim: "not_claimed";
  tokenExposure: "not_exposed";
}

export interface InvitationProviderWebhookHeaders {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
}

export interface InvitationProviderWebhookVerifier {
  provider: "resend";
  enabled: boolean;
  verify(input: {
    rawBody: string;
    headers: InvitationProviderWebhookHeaders;
  }): VerifiedInvitationProviderEvidence;
}

export interface ResendInvitationWebhookEnvironment {
  [key: string]: string | undefined;
  KNOWLEDGEOS_RESEND_WEBHOOK_ENABLED?: string;
  RESEND_WEBHOOK_SECRET?: string;
}

export type InvitationProviderWebhookErrorCode =
  | "webhook_disabled"
  | "invalid_request"
  | "verification_failed"
  | "replay_rejected"
  | "unsupported_event"
  | "invalid_event";

export class InvitationProviderWebhookError extends Error {
  constructor(
    public readonly code: InvitationProviderWebhookErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvitationProviderWebhookError";
  }
}

export class InvitationProviderWebhookConfigurationError extends Error {
  constructor(message = "Invitation Provider webhook configuration is invalid.") {
    super(message);
    this.name = "InvitationProviderWebhookConfigurationError";
  }
}

export interface ResendInvitationWebhookDependencies {
  createWebhook?: (signingSecret: string) => Pick<Webhook, "verify">;
}

const attemptTagName = "knowledgeos_attempt_id";
const maximumRawBodyBytes = 65_536;
const maximumClockSkewSeconds = 300;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const timestampPattern = /^[0-9]{10,12}$/;
const eventEvidence = {
  "email.sent": "sent_by_provider",
  "email.delivered": "delivered_to_recipient_server",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.failed": "delivery_failed",
  "email.suppressed": "suppressed",
  "email.complained": "complained"
} as const satisfies Record<string, InvitationProviderEvidenceType>;

type SupportedProviderEventType = keyof typeof eventEvidence;

function configurationError(): never {
  throw new InvitationProviderWebhookConfigurationError();
}

function webhookError(
  code: InvitationProviderWebhookErrorCode,
  message: string
): never {
  throw new InvitationProviderWebhookError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedString(
  value: unknown,
  options: { maximumLength: number; pattern?: RegExp },
  errorCode: InvitationProviderWebhookErrorCode = "invalid_event"
): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  const containsControlCharacter = Array.from(candidate).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !candidate ||
    candidate.length > options.maximumLength ||
    containsControlCharacter ||
    (options.pattern && !options.pattern.test(candidate))
  ) {
    return webhookError(
      errorCode,
      errorCode === "invalid_request"
        ? "Invitation Provider webhook request is invalid."
        : "Invitation Provider webhook event is invalid."
    );
  }

  return candidate;
}

function parseEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "false") {
    return false;
  }

  return normalized === "true" ? true : configurationError();
}

function parseSigningSecret(value: string | undefined): string {
  const signingSecret = value?.trim() ?? "";

  if (
    !signingSecret.startsWith("whsec_") ||
    signingSecret.length < 16 ||
    signingSecret.length > 256 ||
    /\s/.test(signingSecret)
  ) {
    return configurationError();
  }

  return signingSecret;
}

function parseHeaders(
  headers: InvitationProviderWebhookHeaders,
  now: Date
): {
  eventId: string;
  timestamp: string;
  signature: string;
} {
  if (!Number.isFinite(now.getTime())) {
    return webhookError(
      "invalid_request",
      "Invitation Provider webhook request is invalid."
    );
  }

  const eventId = readBoundedString(
    headers.id,
    { maximumLength: 128, pattern: eventIdPattern },
    "invalid_request"
  );
  const timestamp = readBoundedString(
    headers.timestamp,
    { maximumLength: 12, pattern: timestampPattern },
    "invalid_request"
  );
  const signature = readBoundedString(
    headers.signature,
    { maximumLength: 1_024 },
    "invalid_request"
  );
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(now.getTime() / 1_000);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > maximumClockSkewSeconds
  ) {
    return webhookError(
      "replay_rejected",
      "Invitation Provider webhook timestamp is outside the accepted window."
    );
  }

  return { eventId, timestamp, signature };
}

function parseRawBody(rawBody: string): string {
  if (
    typeof rawBody !== "string" ||
    !rawBody.trim() ||
    Buffer.byteLength(rawBody, "utf8") > maximumRawBodyBytes
  ) {
    return webhookError(
      "invalid_request",
      "Invitation Provider webhook request is invalid."
    );
  }

  return rawBody;
}

function readSupportedEventType(value: unknown): SupportedProviderEventType {
  const eventType = readBoundedString(value, { maximumLength: 64 });

  if (!Object.hasOwn(eventEvidence, eventType)) {
    return webhookError(
      "unsupported_event",
      "Invitation Provider webhook event is not supported."
    );
  }

  return eventType as SupportedProviderEventType;
}

function parseOccurredAt(value: unknown): Date {
  const rawDate = readBoundedString(value, { maximumLength: 64 });
  const occurredAt = new Date(rawDate);

  if (!Number.isFinite(occurredAt.getTime())) {
    return webhookError(
      "invalid_event",
      "Invitation Provider webhook event is invalid."
    );
  }

  return occurredAt;
}

function normalizeEvidence(
  verifiedPayload: unknown,
  eventId: string
): VerifiedInvitationProviderEvidence {
  if (!isRecord(verifiedPayload) || !isRecord(verifiedPayload.data)) {
    return webhookError(
      "invalid_event",
      "Invitation Provider webhook event is invalid."
    );
  }

  const providerEventType = readSupportedEventType(verifiedPayload.type);
  const data = verifiedPayload.data;
  const tags = isRecord(data.tags)
    ? data.tags
    : webhookError(
        "invalid_event",
        "Invitation Provider webhook event is invalid."
      );
  const deliveryAttemptId = readBoundedString(tags[attemptTagName], {
    maximumLength: 36,
    pattern: uuidPattern
  });
  let providerMessageId: string;

  try {
    providerMessageId = parseInvitationEmailProviderMessageId(data.email_id);
  } catch {
    return webhookError(
      "invalid_event",
      "Invitation Provider webhook event is invalid."
    );
  }

  return Object.freeze({
    provider: "resend",
    providerEventId: eventId,
    providerEventType,
    evidenceType: eventEvidence[providerEventType],
    deliveryAttemptId,
    providerMessageId,
    occurredAt: parseOccurredAt(verifiedPayload.created_at),
    signatureVerified: true,
    inboxDeliveryClaim: "not_claimed",
    tokenExposure: "not_exposed"
  });
}

export function createResendInvitationWebhookVerifier(
  config:
    | { enabled: false }
    | { enabled: true; signingSecret: string },
  dependencies: ResendInvitationWebhookDependencies = {}
): InvitationProviderWebhookVerifier {
  if (!config.enabled) {
    return Object.freeze({
      provider: "resend" as const,
      enabled: false,
      verify(): never {
        return webhookError(
          "webhook_disabled",
          "Invitation Provider webhook verification is disabled."
        );
      }
    });
  }

  const signingSecret = parseSigningSecret(config.signingSecret);
  let webhook: Pick<Webhook, "verify">;

  try {
    webhook = (dependencies.createWebhook ?? ((secret) => new Webhook(secret)))(
      signingSecret
    );
  } catch {
    return configurationError();
  }

  return Object.freeze({
    provider: "resend" as const,
    enabled: true,
    verify(input: {
      rawBody: string;
      headers: InvitationProviderWebhookHeaders;
    }): VerifiedInvitationProviderEvidence {
      const rawBody = parseRawBody(input.rawBody);
      const headers = parseHeaders(input.headers, new Date());
      let verifiedPayload: unknown;

      try {
        verifiedPayload = webhook.verify(rawBody, {
          "svix-id": headers.eventId,
          "svix-timestamp": headers.timestamp,
          "svix-signature": headers.signature
        });
      } catch {
        return webhookError(
          "verification_failed",
          "Invitation Provider webhook verification failed."
        );
      }

      return normalizeEvidence(verifiedPayload, headers.eventId);
    }
  });
}

export function createResendInvitationWebhookVerifierFromEnvironment(
  environment: ResendInvitationWebhookEnvironment = process.env,
  dependencies: ResendInvitationWebhookDependencies = {}
): InvitationProviderWebhookVerifier {
  const enabled = parseEnabled(
    environment.KNOWLEDGEOS_RESEND_WEBHOOK_ENABLED
  );

  return createResendInvitationWebhookVerifier(
    enabled
      ? {
          enabled,
          signingSecret: parseSigningSecret(environment.RESEND_WEBHOOK_SECRET)
        }
      : { enabled },
    dependencies
  );
}

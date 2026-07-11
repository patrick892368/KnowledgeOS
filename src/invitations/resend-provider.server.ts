import { isValidInvitationEmail } from "./lifecycle";
import {
  InvitationEmailDeliveryError,
  parseInvitationEmailProviderMessageId,
  type InvitationEmailProvider,
  type InvitationEmailProviderPayload
} from "./email-provider.server";

export interface ResendInvitationEmailEnvironment {
  [key: string]: string | undefined;
  KNOWLEDGEOS_RESEND_ENABLED?: string;
  RESEND_API_KEY?: string;
  KNOWLEDGEOS_INVITATION_FROM_EMAIL?: string;
  KNOWLEDGEOS_RESEND_TIMEOUT_MS?: string;
}

export interface ResendInvitationEmailProviderConfig {
  enabled: boolean;
  apiKey?: string;
  from?: string;
  timeoutMs?: number;
}

export interface ResendInvitationEmailProviderDependencies {
  fetch?: typeof fetch;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const resendEmailEndpoint = "https://api.resend.com/emails";
const defaultTimeoutMs = 10_000;
const minimumTimeoutMs = 1_000;
const maximumTimeoutMs = 30_000;
const maxApiKeyLength = 512;
const maxSenderLength = 512;
const maxResponseLength = 4_096;
const maxTokenLength = 512;
const maxAcceptanceUrlLength = 2_048;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configurationError(): never {
  throw new InvitationEmailDeliveryError(
    "provider_disabled",
    "Resend invitation email provider configuration is invalid.",
    true
  );
}

function providerFailure(): never {
  throw new InvitationEmailDeliveryError(
    "provider_failed",
    "Resend rejected the invitation email request.",
    true
  );
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function parseApiKey(value: string | undefined): string {
  const apiKey = value?.trim() ?? "";

  if (
    !apiKey ||
    apiKey.length > maxApiKeyLength ||
    containsControlCharacter(apiKey) ||
    /\s/.test(apiKey)
  ) {
    return configurationError();
  }

  return apiKey;
}

function senderAddress(value: string): string {
  const friendlyAddressMatch = value.match(/^[^<>]+<([^<>]+)>$/);
  return (friendlyAddressMatch?.[1] ?? value).trim();
}

function parseSender(value: string | undefined): string {
  const from = value?.trim() ?? "";

  if (
    !from ||
    from.length > maxSenderLength ||
    containsControlCharacter(from) ||
    !isValidInvitationEmail(senderAddress(from))
  ) {
    return configurationError();
  }

  return from;
}

function parseTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? defaultTimeoutMs;

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < minimumTimeoutMs ||
    timeoutMs > maximumTimeoutMs
  ) {
    return configurationError();
  }

  return timeoutMs;
}

function parseEnabled(value: string | undefined): boolean {
  const enabled = value?.trim().toLowerCase();

  if (!enabled || enabled === "false") {
    return false;
  }

  if (enabled === "true") {
    return true;
  }

  return configurationError();
}

function parseEnvironmentTimeout(value: string | undefined): number | undefined {
  const timeout = value?.trim();

  if (!timeout) {
    return undefined;
  }

  const timeoutMs = Number(timeout);
  return Number.isInteger(timeoutMs) ? timeoutMs : configurationError();
}

function isSafeAcceptanceContextUrl(value: string): boolean {
  if (!value || value.length > maxAcceptanceUrlLength) {
    return false;
  }

  try {
    const url = new URL(value);
    const isLoopbackHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1");
    const hasSecretQuery = Array.from(url.searchParams.keys()).some((key) =>
      /token|secret|password|authorization/i.test(key)
    );

    return (
      (url.protocol === "https:" || isLoopbackHttp) &&
      !url.username &&
      !url.password &&
      !hasSecretQuery
    );
  } catch {
    return false;
  }
}

function validateProviderPayload(
  payload: Readonly<InvitationEmailProviderPayload>
): void {
  if (
    payload.template !== "invitation_acceptance" ||
    payload.tokenHandling !== "separate_one_time_value" ||
    payload.subject !== "KnowledgeOS invitation" ||
    !uuidPattern.test(payload.deliveryAttemptId) ||
    !isValidInvitationEmail(payload.recipient) ||
    !isSafeAcceptanceContextUrl(payload.acceptanceContextUrl) ||
    !payload.oneTimeToken ||
    payload.oneTimeToken.length > maxTokenLength ||
    containsControlCharacter(payload.oneTimeToken)
  ) {
    providerFailure();
  }
}

function createEmailText(
  payload: Readonly<InvitationEmailProviderPayload>
): string {
  return [
    "You have been invited to join a KnowledgeOS organization.",
    "",
    "Open the invitation page:",
    payload.acceptanceContextUrl,
    "",
    "Enter this one-time token:",
    payload.oneTimeToken,
    "",
    `The delivery token expires at ${payload.deliveryExpiresAt}.`,
    "If you did not expect this invitation, you can ignore this email."
  ].join("\n");
}

async function parseProviderResponse(response: Response): Promise<string> {
  if (!response.ok) {
    return providerFailure();
  }

  let responseText: string;

  try {
    responseText = await response.text();
  } catch {
    return providerFailure();
  }

  if (!responseText || responseText.length > maxResponseLength) {
    return providerFailure();
  }

  let responseBody: unknown;

  try {
    responseBody = JSON.parse(responseText);
  } catch {
    return providerFailure();
  }

  if (
    typeof responseBody !== "object" ||
    responseBody === null ||
    Array.isArray(responseBody)
  ) {
    return providerFailure();
  }

  try {
    return parseInvitationEmailProviderMessageId(
      (responseBody as { id?: unknown }).id
    );
  } catch {
    return providerFailure();
  }
}

export function createResendInvitationEmailProvider(
  config: ResendInvitationEmailProviderConfig,
  dependencies: ResendInvitationEmailProviderDependencies = {}
): InvitationEmailProvider {
  if (!config.enabled) {
    return Object.freeze({
      name: "resend",
      enabled: false,
      async sendInvitation() {
        throw new InvitationEmailDeliveryError(
          "provider_disabled",
          "Resend invitation email provider is disabled.",
          true
        );
      }
    });
  }

  const apiKey = parseApiKey(config.apiKey);
  const from = parseSender(config.from);
  const timeoutMs = parseTimeoutMs(config.timeoutMs);
  const fetchRequest = dependencies.fetch ?? globalThis.fetch;
  const setTimer =
    dependencies.setTimeout ??
    ((callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs));
  const clearTimer =
    dependencies.clearTimeout ??
    ((handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  return Object.freeze({
    name: "resend",
    enabled: true,
    async sendInvitation(
      payload: Readonly<InvitationEmailProviderPayload>
    ) {
      validateProviderPayload(payload);

      const controller = new AbortController();
      const timeoutHandle = setTimer(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchRequest(resendEmailEndpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": payload.deliveryAttemptId,
            "User-Agent": "KnowledgeOS/0.0.0"
          },
          body: JSON.stringify({
            from,
            to: [payload.recipient],
            subject: payload.subject,
            text: createEmailText(payload),
            tags: [
              {
                name: "knowledgeos_attempt_id",
                value: payload.deliveryAttemptId
              }
            ]
          }),
          signal: controller.signal
        });

        return {
          messageId: await parseProviderResponse(response)
        };
      } catch {
        return providerFailure();
      } finally {
        clearTimer(timeoutHandle);
      }
    }
  });
}

export function createResendInvitationEmailProviderFromEnvironment(
  environment: ResendInvitationEmailEnvironment = process.env,
  dependencies: ResendInvitationEmailProviderDependencies = {}
): InvitationEmailProvider {
  const enabled = parseEnabled(environment.KNOWLEDGEOS_RESEND_ENABLED);

  return createResendInvitationEmailProvider(
    enabled
      ? {
          enabled,
          apiKey: environment.RESEND_API_KEY,
          from: environment.KNOWLEDGEOS_INVITATION_FROM_EMAIL,
          timeoutMs: parseEnvironmentTimeout(
            environment.KNOWLEDGEOS_RESEND_TIMEOUT_MS
          )
        }
      : { enabled },
    dependencies
  );
}

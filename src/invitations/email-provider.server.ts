import {
  createInvitationAcceptancePayloadFromDeliveryPlan,
  type InvitationDeliveryPlan
} from "./delivery";
import { isValidInvitationEmail } from "./lifecycle";
import { hashInvitationToken } from "./tokens";

export type InvitationEmailDeliveryErrorCode =
  | "provider_unconfigured"
  | "provider_disabled"
  | "invalid_delivery_payload"
  | "provider_failed";

export class InvitationEmailDeliveryError extends Error {
  constructor(
    public readonly code: InvitationEmailDeliveryErrorCode,
    message: string,
    public readonly recoverable: boolean
  ) {
    super(message);
    this.name = "InvitationEmailDeliveryError";
  }
}

export interface InvitationEmailProviderPayload {
  template: "invitation_acceptance";
  deliveryAttemptId: string;
  recipient: string;
  subject: "KnowledgeOS invitation";
  invitationId: string;
  organizationId: string;
  acceptanceContextUrl: string;
  oneTimeToken: string;
  deliveryExpiresAt: string;
  invitationExpiresAt: string;
  tokenHandling: "separate_one_time_value";
}

export interface InvitationEmailProviderAcceptance {
  messageId: string;
}

export interface InvitationEmailProvider {
  name: string;
  enabled: boolean;
  sendInvitation(
    payload: Readonly<InvitationEmailProviderPayload>
  ): Promise<InvitationEmailProviderAcceptance>;
}

export interface PublicInvitationEmailReceipt {
  deliveryAttemptId: string;
  invitationId: string;
  recipient: string;
  provider: string;
  providerMessageId: string;
  status: "accepted_by_provider";
  acceptedAt: Date;
  tokenExposure: "not_exposed";
}

const maxAcceptanceUrlLength = 2048;
const maxContextValueLength = 320;
const maxOneTimeTokenLength = 512;
const maxProviderNameLength = 64;
const maxProviderMessageIdLength = 256;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidPayload(message: string): never {
  throw new InvitationEmailDeliveryError(
    "invalid_delivery_payload",
    message,
    false
  );
}

function isDevelopmentHttpUrl(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1")
  );
}

function createAcceptanceContextUrl(input: {
  acceptanceBaseUrl: string;
  invitationId: string;
  email: string;
  organizationId: string;
}): string {
  let url: URL;

  try {
    url = new URL(input.acceptanceBaseUrl);
  } catch {
    return invalidPayload("Acceptance base URL must be an absolute URL.");
  }

  if (
    (url.protocol !== "https:" && !isDevelopmentHttpUrl(url)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return invalidPayload(
      "Acceptance base URL must use HTTPS without credentials, query, or fragment values."
    );
  }

  url.search = "";
  url.hash = "invitation-acceptance";
  url.searchParams.set("invitationId", input.invitationId);
  url.searchParams.set("email", input.email);
  url.searchParams.set("organizationId", input.organizationId);

  const value = url.toString();

  if (value.length > maxAcceptanceUrlLength) {
    return invalidPayload("Acceptance context URL exceeds supported limits.");
  }

  return value;
}

function validateDeliveryPlan(plan: InvitationDeliveryPlan, now: Date): void {
  const deliveryExpiresAt = plan.publicPlan.deliveryExpiresAt.getTime();
  const invitationExpiresAt = plan.publicPlan.invitationExpiresAt.getTime();

  if (
    !plan.publicPlan.invitationId ||
    plan.publicPlan.invitationId.length > maxContextValueLength ||
    !plan.publicPlan.organizationId ||
    plan.publicPlan.organizationId.length > maxContextValueLength ||
    !plan.publicPlan.email ||
    !isValidInvitationEmail(plan.publicPlan.email) ||
    !plan.secret.rawToken ||
    plan.secret.rawToken.length > maxOneTimeTokenLength ||
    !plan.secret.tokenHash
  ) {
    invalidPayload("Invitation delivery plan is incomplete.");
  }

  if (
    plan.publicPlan.status !== "pending" ||
    plan.publicPlan.acceptanceRoute !== "/api/invitations/accept" ||
    plan.publicPlan.tokenExposure !== "not_exposed"
  ) {
    invalidPayload("Invitation delivery plan has an unsafe public contract.");
  }

  if (hashInvitationToken(plan.secret.rawToken) !== plan.secret.tokenHash) {
    invalidPayload("Invitation delivery token does not match its token hash.");
  }

  if (
    !Number.isFinite(deliveryExpiresAt) ||
    !Number.isFinite(invitationExpiresAt) ||
    deliveryExpiresAt <= now.getTime() ||
    invitationExpiresAt <= now.getTime() ||
    deliveryExpiresAt > invitationExpiresAt
  ) {
    invalidPayload("Invitation delivery plan has expired or invalid timing.");
  }
}

export function parseInvitationEmailProviderName(value: string): string {
  const name = value.trim();

  if (
    !name ||
    name.length > maxProviderNameLength ||
    !/^[a-z0-9][a-z0-9_-]*$/i.test(name)
  ) {
    throw new InvitationEmailDeliveryError(
      "provider_disabled",
      "Invitation email provider configuration is invalid.",
      true
    );
  }

  return name;
}

export function parseInvitationEmailProviderMessageId(value: unknown): string {
  const messageId = typeof value === "string" ? value.trim() : "";
  const containsControlCharacter = Array.from(messageId).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  if (
    !messageId ||
    messageId.length > maxProviderMessageIdLength ||
    containsControlCharacter
  ) {
    throw new InvitationEmailDeliveryError(
      "provider_failed",
      "Invitation email provider returned an invalid acceptance response.",
      true
    );
  }

  return messageId;
}

function validateMessageId(
  value: unknown,
  secret: InvitationDeliveryPlan["secret"]
): string {
  const messageId = parseInvitationEmailProviderMessageId(value);

  if (
    messageId.includes(secret.rawToken) ||
    messageId.includes(secret.tokenHash)
  ) {
    throw new InvitationEmailDeliveryError(
      "provider_failed",
      "Invitation email provider returned an invalid acceptance response.",
      true
    );
  }

  return messageId;
}

export function createInvitationEmailProviderPayload(input: {
  plan: InvitationDeliveryPlan;
  deliveryAttemptId: string;
  acceptanceBaseUrl: string;
  now?: Date;
}): Readonly<InvitationEmailProviderPayload> {
  const now = input.now ?? new Date();
  validateDeliveryPlan(input.plan, now);

  if (!uuidPattern.test(input.deliveryAttemptId)) {
    invalidPayload("Invitation delivery attempt ID must be a UUID.");
  }

  const acceptance =
    createInvitationAcceptancePayloadFromDeliveryPlan(input.plan);

  return Object.freeze({
    template: "invitation_acceptance",
    deliveryAttemptId: input.deliveryAttemptId,
    recipient: acceptance.email,
    subject: "KnowledgeOS invitation",
    invitationId: acceptance.invitationId,
    organizationId: acceptance.organizationId,
    acceptanceContextUrl: createAcceptanceContextUrl({
      acceptanceBaseUrl: input.acceptanceBaseUrl,
      invitationId: acceptance.invitationId,
      email: acceptance.email,
      organizationId: acceptance.organizationId
    }),
    oneTimeToken: acceptance.token,
    deliveryExpiresAt: input.plan.publicPlan.deliveryExpiresAt.toISOString(),
    invitationExpiresAt:
      input.plan.publicPlan.invitationExpiresAt.toISOString(),
    tokenHandling: "separate_one_time_value"
  });
}

export async function deliverInvitationEmail(input: {
  plan: InvitationDeliveryPlan;
  deliveryAttemptId: string;
  acceptanceBaseUrl: string;
  provider?: InvitationEmailProvider;
  now?: Date;
}): Promise<PublicInvitationEmailReceipt> {
  if (!input.provider) {
    throw new InvitationEmailDeliveryError(
      "provider_unconfigured",
      "Invitation email provider is not configured.",
      true
    );
  }

  if (!input.provider.enabled) {
    throw new InvitationEmailDeliveryError(
      "provider_disabled",
      "Invitation email provider is disabled.",
      true
    );
  }

  const providerName = parseInvitationEmailProviderName(input.provider.name);
  const acceptedAt = input.now ?? new Date();
  const payload = createInvitationEmailProviderPayload({
    plan: input.plan,
    deliveryAttemptId: input.deliveryAttemptId,
    acceptanceBaseUrl: input.acceptanceBaseUrl,
    now: acceptedAt
  });
  let acceptance: InvitationEmailProviderAcceptance;

  try {
    acceptance = await input.provider.sendInvitation(payload);
  } catch {
    throw new InvitationEmailDeliveryError(
      "provider_failed",
      "Invitation email provider rejected the delivery request.",
      true
    );
  }

  return {
    deliveryAttemptId: input.deliveryAttemptId,
    invitationId: input.plan.publicPlan.invitationId,
    recipient: input.plan.publicPlan.email,
    provider: providerName,
    providerMessageId: validateMessageId(
      acceptance?.messageId,
      input.plan.secret
    ),
    status: "accepted_by_provider",
    acceptedAt,
    tokenExposure: "not_exposed"
  };
}

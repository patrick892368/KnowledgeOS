import type { AuthSession } from "@/auth/session";
import type { Database } from "@/db/client";
import {
  readInvitationDispatchPolicyHistory,
  type InvitationDispatchPolicyHistory
} from "@/db/invitation-dispatch-policy-repository";

export interface InvitationDispatchPolicyEnvironment {
  [key: string]: string | undefined;
  KNOWLEDGEOS_INVITATION_DISPATCH_COOLDOWN_SECONDS?: string;
  KNOWLEDGEOS_INVITATION_DISPATCH_RATE_WINDOW_SECONDS?: string;
  KNOWLEDGEOS_INVITATION_DISPATCH_RATE_MAX?: string;
}

export interface InvitationDispatchPolicyConfig {
  cooldownSeconds: number;
  rateLimitWindowSeconds: number;
  maxAttemptsPerWindow: number;
}

export type InvitationDispatchPolicyFailureCode =
  | "dispatch_cooldown_active"
  | "dispatch_rate_limited";

export type InvitationDispatchPolicyDecision =
  | { status: "allowed" }
  | {
      status: "denied";
      failureCode: InvitationDispatchPolicyFailureCode;
    };

export interface InvitationDispatchPolicyDependencies {
  readHistory: typeof readInvitationDispatchPolicyHistory;
}

export class InvitationDispatchPolicyConfigurationError extends Error {
  constructor(message = "Invitation dispatch policy configuration is invalid.") {
    super(message);
    this.name = "InvitationDispatchPolicyConfigurationError";
  }
}

const defaultPolicy: InvitationDispatchPolicyConfig = {
  cooldownSeconds: 60,
  rateLimitWindowSeconds: 3_600,
  maxAttemptsPerWindow: 100
};
const defaultDependencies: InvitationDispatchPolicyDependencies = {
  readHistory: readInvitationDispatchPolicyHistory
};

function configurationError(): never {
  throw new InvitationDispatchPolicyConfigurationError();
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : configurationError();
}

function environmentInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const candidate = value?.trim();

  if (!candidate) {
    return fallback;
  }

  return boundedInteger(Number(candidate), minimum, maximum);
}

export function createInvitationDispatchPolicyConfig(
  input: InvitationDispatchPolicyConfig = defaultPolicy
): InvitationDispatchPolicyConfig {
  return Object.freeze({
    cooldownSeconds: boundedInteger(input.cooldownSeconds, 10, 86_400),
    rateLimitWindowSeconds: boundedInteger(
      input.rateLimitWindowSeconds,
      60,
      604_800
    ),
    maxAttemptsPerWindow: boundedInteger(input.maxAttemptsPerWindow, 1, 1_000)
  });
}

export function createInvitationDispatchPolicyConfigFromEnvironment(
  environment: InvitationDispatchPolicyEnvironment = process.env
): InvitationDispatchPolicyConfig {
  return createInvitationDispatchPolicyConfig({
    cooldownSeconds: environmentInteger(
      environment.KNOWLEDGEOS_INVITATION_DISPATCH_COOLDOWN_SECONDS,
      defaultPolicy.cooldownSeconds,
      10,
      86_400
    ),
    rateLimitWindowSeconds: environmentInteger(
      environment.KNOWLEDGEOS_INVITATION_DISPATCH_RATE_WINDOW_SECONDS,
      defaultPolicy.rateLimitWindowSeconds,
      60,
      604_800
    ),
    maxAttemptsPerWindow: environmentInteger(
      environment.KNOWLEDGEOS_INVITATION_DISPATCH_RATE_MAX,
      defaultPolicy.maxAttemptsPerWindow,
      1,
      1_000
    )
  });
}

function validateHistory(
  history: InvitationDispatchPolicyHistory
): InvitationDispatchPolicyHistory {
  if (
    !Number.isSafeInteger(history.organizationAttemptCount) ||
    history.organizationAttemptCount < 0 ||
    (history.latestInvitationAttemptPreparedAt !== null &&
      !Number.isFinite(history.latestInvitationAttemptPreparedAt.getTime()))
  ) {
    throw new Error("Invitation dispatch policy history is invalid.");
  }

  return history;
}

export async function reviewInvitationDispatchPolicy(
  db: Database,
  input: {
    session: AuthSession;
    invitationId: string;
    currentAttemptId: string;
    policy?: InvitationDispatchPolicyConfig;
    now?: Date;
  },
  dependencies: InvitationDispatchPolicyDependencies = defaultDependencies
): Promise<InvitationDispatchPolicyDecision> {
  const now = input.now ?? new Date();

  if (!Number.isFinite(now.getTime())) {
    throw new Error("Invitation dispatch policy review time is invalid.");
  }

  const policy = createInvitationDispatchPolicyConfig(input.policy);
  const cooldownSince = new Date(
    now.getTime() - policy.cooldownSeconds * 1_000
  );
  const rateLimitSince = new Date(
    now.getTime() - policy.rateLimitWindowSeconds * 1_000
  );
  const history = validateHistory(
    await dependencies.readHistory(db, {
      session: input.session,
      invitationId: input.invitationId,
      currentAttemptId: input.currentAttemptId,
      cooldownSince,
      rateLimitSince
    })
  );

  if (
    history.latestInvitationAttemptPreparedAt &&
    history.latestInvitationAttemptPreparedAt.getTime() >
      cooldownSince.getTime()
  ) {
    return {
      status: "denied",
      failureCode: "dispatch_cooldown_active"
    };
  }

  if (history.organizationAttemptCount >= policy.maxAttemptsPerWindow) {
    return {
      status: "denied",
      failureCode: "dispatch_rate_limited"
    };
  }

  return { status: "allowed" };
}

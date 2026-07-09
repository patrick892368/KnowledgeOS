import { createHash, timingSafeEqual } from "node:crypto";

import {
  createBootstrapMembershipId,
  type IdentityBootstrapInput,
  type IdentityBootstrapResult
} from "@/db/identity-bootstrap-repository";
import { isMembershipRole } from "@/db/model";

import {
  AuthError,
  createSignedSessionToken,
  defaultSessionTtlSeconds,
  type AuthEnvironment,
  type AuthSession
} from "./session";

export type BootstrapLoginErrorCode =
  | "invalid_payload"
  | "invalid_credentials"
  | "identity_bootstrap_unavailable"
  | "auth_misconfigured";

export class BootstrapLoginError extends Error {
  constructor(
    public readonly code: BootstrapLoginErrorCode,
    message: string,
    public readonly status =
      code === "invalid_credentials"
        ? 401
        : code === "identity_bootstrap_unavailable"
          ? 503
        : code === "auth_misconfigured"
          ? 500
          : 400
  ) {
    super(message);
    this.name = "BootstrapLoginError";
  }
}

export interface BootstrapLoginEnvironment extends AuthEnvironment {
  KNOWLEDGEOS_BOOTSTRAP_EMAIL?: string;
  KNOWLEDGEOS_BOOTSTRAP_PASSWORD?: string;
  KNOWLEDGEOS_BOOTSTRAP_USER_ID?: string;
  KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_ID?: string;
  KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_NAME?: string;
  KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_SLUG?: string;
  KNOWLEDGEOS_BOOTSTRAP_MEMBERSHIP_ID?: string;
  KNOWLEDGEOS_BOOTSTRAP_ROLE?: string;
  KNOWLEDGEOS_BOOTSTRAP_NAME?: string;
  KNOWLEDGEOS_BOOTSTRAP_SESSION_TTL_SECONDS?: string;
}

export interface BootstrapLoginResult {
  session: Omit<AuthSession, "source"> & {
    membershipId: string;
  };
  token: string;
  maxAgeSeconds: number;
  expiresAt: Date;
  identity: {
    mode: "database" | "environment";
    organizationId: string;
    userId: string;
    membershipId: string;
  };
}

type ResolvedBootstrapIdentityInput = IdentityBootstrapInput & {
  membershipId: string;
};

interface BootstrapLoginPayload {
  email: string;
  password: string;
}

function readRequiredConfig(
  env: BootstrapLoginEnvironment,
  key: keyof BootstrapLoginEnvironment
): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new BootstrapLoginError(
      "auth_misconfigured",
      `${key} is required for bootstrap login.`
    );
  }

  return value;
}

function readSessionTtlSeconds(env: BootstrapLoginEnvironment): number {
  const value = env.KNOWLEDGEOS_BOOTSTRAP_SESSION_TTL_SECONDS?.trim();

  if (!value) {
    return defaultSessionTtlSeconds;
  }

  const ttlSeconds = Number(value);

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new BootstrapLoginError(
      "auth_misconfigured",
      "KNOWLEDGEOS_BOOTSTRAP_SESSION_TTL_SECONDS must be a positive integer."
    );
  }

  return ttlSeconds;
}

function safeEqualText(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(actualHash, expectedHash);
}

function slugifyOrganizationName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug.length > 0 ? slug : "knowledgeos";
}

function readBootstrapIdentityInput(
  env: BootstrapLoginEnvironment
): ResolvedBootstrapIdentityInput {
  const organizationId = readRequiredConfig(
    env,
    "KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_ID"
  );
  const userId = readRequiredConfig(env, "KNOWLEDGEOS_BOOTSTRAP_USER_ID");
  const organizationName =
    env.KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_NAME?.trim() || "KnowledgeOS";
  const role = env.KNOWLEDGEOS_BOOTSTRAP_ROLE?.trim() || "owner";

  if (!isMembershipRole(role)) {
    throw new BootstrapLoginError(
      "auth_misconfigured",
      "KNOWLEDGEOS_BOOTSTRAP_ROLE must be a valid membership role."
    );
  }

  return {
    organizationId,
    organizationName,
    organizationSlug:
      env.KNOWLEDGEOS_BOOTSTRAP_ORGANIZATION_SLUG?.trim() ||
      slugifyOrganizationName(organizationName),
    userId,
    membershipId:
      env.KNOWLEDGEOS_BOOTSTRAP_MEMBERSHIP_ID?.trim() ||
      createBootstrapMembershipId(organizationId, userId),
    role,
    email: readRequiredConfig(env, "KNOWLEDGEOS_BOOTSTRAP_EMAIL"),
    name:
      env.KNOWLEDGEOS_BOOTSTRAP_NAME?.trim() ||
      readRequiredConfig(env, "KNOWLEDGEOS_BOOTSTRAP_EMAIL")
  };
}

export function parseBootstrapLoginPayload(
  payload: unknown
): BootstrapLoginPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new BootstrapLoginError("invalid_payload", "Login payload is invalid.");
  }

  const candidate = payload as Partial<BootstrapLoginPayload>;

  if (
    typeof candidate.email !== "string" ||
    typeof candidate.password !== "string" ||
    candidate.email.trim().length === 0 ||
    candidate.password.length === 0
  ) {
    throw new BootstrapLoginError(
      "invalid_payload",
      "Email and password are required."
    );
  }

  return {
    email: candidate.email.trim(),
    password: candidate.password
  };
}

export function authenticateBootstrapLogin(
  payload: unknown,
  env: BootstrapLoginEnvironment = process.env,
  now = new Date()
): BootstrapLoginResult {
  const credentials = parseBootstrapLoginPayload(payload);
  const identityInput = readBootstrapIdentityInput(env);
  const expectedEmail = identityInput.email;
  const expectedPassword = readRequiredConfig(
    env,
    "KNOWLEDGEOS_BOOTSTRAP_PASSWORD"
  );

  if (
    !safeEqualText(credentials.email.toLowerCase(), expectedEmail.toLowerCase()) ||
    !safeEqualText(credentials.password, expectedPassword)
  ) {
    throw new BootstrapLoginError(
      "invalid_credentials",
      "Invalid email or password."
    );
  }

  const maxAgeSeconds = readSessionTtlSeconds(env);
  const session = {
    userId: identityInput.userId,
    organizationId: identityInput.organizationId,
    membershipId: identityInput.membershipId,
    role: identityInput.role,
    email: identityInput.email,
    name: identityInput.name
  };
  const secret = readRequiredConfig(env, "KNOWLEDGEOS_SESSION_SECRET");

  try {
    const token = createSignedSessionToken(session, secret, {
      now,
      ttlSeconds: maxAgeSeconds
    });

    return {
      session,
      token,
      maxAgeSeconds,
      expiresAt: new Date(now.getTime() + maxAgeSeconds * 1000),
      identity: {
        mode: "environment",
        organizationId: session.organizationId,
        userId: session.userId,
        membershipId: session.membershipId
      }
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw new BootstrapLoginError(
        "auth_misconfigured",
        error.message,
        error.status
      );
    }

    throw error;
  }
}

export async function authenticateBootstrapLoginWithIdentityBootstrap(
  payload: unknown,
  options: {
    env?: BootstrapLoginEnvironment;
    now?: Date;
    bootstrapIdentity?: (
      input: IdentityBootstrapInput
    ) => Promise<IdentityBootstrapResult | null>;
  } = {}
): Promise<BootstrapLoginResult> {
  const env = options.env ?? process.env;
  const credentials = parseBootstrapLoginPayload(payload);
  const identityInput = readBootstrapIdentityInput(env);
  const expectedPassword = readRequiredConfig(
    env,
    "KNOWLEDGEOS_BOOTSTRAP_PASSWORD"
  );

  if (
    !safeEqualText(credentials.email.toLowerCase(), identityInput.email.toLowerCase()) ||
    !safeEqualText(credentials.password, expectedPassword)
  ) {
    throw new BootstrapLoginError(
      "invalid_credentials",
      "Invalid email or password."
    );
  }

  const identityResult = options.bootstrapIdentity
    ? await options.bootstrapIdentity(identityInput)
    : null;
  const session = identityResult?.session ?? {
    userId: identityInput.userId,
    organizationId: identityInput.organizationId,
    membershipId: identityInput.membershipId,
    role: identityInput.role,
    email: identityInput.email,
    name: identityInput.name
  };
  const maxAgeSeconds = readSessionTtlSeconds(env);
  const now = options.now ?? new Date();
  const secret = readRequiredConfig(env, "KNOWLEDGEOS_SESSION_SECRET");

  try {
    const token = createSignedSessionToken(session, secret, {
      now,
      ttlSeconds: maxAgeSeconds
    });

    return {
      session,
      token,
      maxAgeSeconds,
      expiresAt: new Date(now.getTime() + maxAgeSeconds * 1000),
      identity: {
        mode: identityResult?.mode ?? "environment",
        organizationId: session.organizationId,
        userId: session.userId,
        membershipId: session.membershipId
      }
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw new BootstrapLoginError(
        "auth_misconfigured",
        error.message,
        error.status
      );
    }

    throw error;
  }
}

export function bootstrapLoginErrorResponse(error: unknown): Response {
  if (error instanceof BootstrapLoginError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected login failure."
      }
    },
    { status: 500 }
  );
}

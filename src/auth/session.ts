import { createHmac, timingSafeEqual } from "node:crypto";

import { headers } from "next/headers";

import {
  isMembershipRole,
  type MembershipRole
} from "@/db/model";

export const sessionHeaderNames = {
  userId: "x-knowledgeos-user-id",
  organizationId: "x-knowledgeos-organization-id",
  membershipId: "x-knowledgeos-membership-id",
  role: "x-knowledgeos-role",
  email: "x-knowledgeos-user-email",
  name: "x-knowledgeos-user-name"
} as const;

export const authCookieName = "knowledgeos_session";
export const defaultSessionTtlSeconds = 60 * 60 * 8;

const signedSessionVersion = "v1";

export type AuthErrorCode =
  | "unauthenticated"
  | "invalid_session"
  | "auth_misconfigured";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly status =
      code === "unauthenticated"
        ? 401
        : code === "auth_misconfigured"
          ? 500
          : 400
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthSession {
  userId: string;
  organizationId: string;
  membershipId?: string;
  role: MembershipRole;
  email?: string;
  name?: string;
  source: "development-headers" | "signed-cookie";
}

export interface AuthEnvironment {
  NODE_ENV?: string;
  KNOWLEDGEOS_ENABLE_DEVELOPMENT_HEADERS?: string;
  KNOWLEDGEOS_SESSION_SECRET?: string;
}

interface SignedSessionPayload {
  userId: string;
  organizationId: string;
  membershipId?: string;
  role: MembershipRole;
  email?: string;
  name?: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SignedSessionOptions {
  now?: Date;
  ttlSeconds?: number;
}

export interface SessionCookieOptions {
  maxAgeSeconds?: number;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
}

function readHeader(headerList: Headers, name: string): string | undefined {
  const value = headerList.get(name)?.trim();
  return value && value.length > 0 ? value : undefined;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqualText(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function nowSeconds(now = new Date()): number {
  return Math.floor(now.getTime() / 1000);
}

function readCookie(headerList: Headers, name: string): string | undefined {
  const cookieHeader = headerList.get("cookie");

  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.split("=");

    if (rawName?.trim() === name) {
      const value = rawValueParts.join("=").trim();
      return value.length > 0 ? value : undefined;
    }
  }

  return undefined;
}

function readSessionSecret(env: AuthEnvironment): string {
  const secret = env.KNOWLEDGEOS_SESSION_SECRET?.trim();

  if (!secret) {
    throw new AuthError(
      "auth_misconfigured",
      "KNOWLEDGEOS_SESSION_SECRET is required to validate signed sessions."
    );
  }

  if (secret.length < 32) {
    throw new AuthError(
      "auth_misconfigured",
      "KNOWLEDGEOS_SESSION_SECRET must be at least 32 characters."
    );
  }

  return secret;
}

function validateSessionFields(session: Omit<AuthSession, "source">): void {
  if (!session.userId.trim() || !session.organizationId.trim()) {
    throw new AuthError(
      "invalid_session",
      "Session must include user and organization identifiers."
    );
  }

  if (!isMembershipRole(session.role)) {
    throw new AuthError("invalid_session", `Invalid session role: ${session.role}.`);
  }
}

function parseSignedPayload(payload: unknown): SignedSessionPayload {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new AuthError("invalid_session", "Signed session payload is invalid.");
  }

  const candidate = payload as Partial<SignedSessionPayload>;

  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.organizationId !== "string" ||
    typeof candidate.role !== "string" ||
    typeof candidate.issuedAt !== "number" ||
    typeof candidate.expiresAt !== "number" ||
    !isMembershipRole(candidate.role)
  ) {
    throw new AuthError("invalid_session", "Signed session payload is invalid.");
  }

  return {
    userId: candidate.userId,
    organizationId: candidate.organizationId,
    membershipId:
      typeof candidate.membershipId === "string"
        ? candidate.membershipId
        : undefined,
    role: candidate.role,
    email: typeof candidate.email === "string" ? candidate.email : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt
  };
}

export function developmentHeadersEnabled(env: AuthEnvironment = process.env) {
  return (
    env.NODE_ENV !== "production" &&
    env.KNOWLEDGEOS_ENABLE_DEVELOPMENT_HEADERS !== "false"
  );
}

export function parseDevelopmentSession(
  headerList: Headers
): AuthSession | null {
  const userId = readHeader(headerList, sessionHeaderNames.userId);
  const organizationId = readHeader(
    headerList,
    sessionHeaderNames.organizationId
  );
  const role = readHeader(headerList, sessionHeaderNames.role);

  if (!userId && !organizationId && !role) {
    return null;
  }

  if (!userId || !organizationId || !role) {
    throw new AuthError(
      "invalid_session",
      "Development session headers must include user, organization, and role."
    );
  }

  if (!isMembershipRole(role)) {
    throw new AuthError(
      "invalid_session",
      `Invalid development session role: ${role}.`
    );
  }

  return {
    userId,
    organizationId,
    membershipId: readHeader(headerList, sessionHeaderNames.membershipId),
    role,
    email: readHeader(headerList, sessionHeaderNames.email),
    name: readHeader(headerList, sessionHeaderNames.name),
    source: "development-headers"
  };
}

export function createSignedSessionToken(
  session: Omit<AuthSession, "source">,
  secret: string,
  options: SignedSessionOptions = {}
): string {
  validateSessionFields(session);

  const ttlSeconds = options.ttlSeconds ?? defaultSessionTtlSeconds;

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new AuthError("invalid_session", "Session TTL must be positive.");
  }

  readSessionSecret({ KNOWLEDGEOS_SESSION_SECRET: secret });

  const issuedAt = nowSeconds(options.now);
  const payload: SignedSessionPayload = {
    userId: session.userId,
    organizationId: session.organizationId,
    membershipId: session.membershipId,
    role: session.role,
    email: session.email,
    name: session.name,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${signedSessionVersion}.${encodedPayload}`;

  return `${signingInput}.${sign(signingInput, secret)}`;
}

export function parseSignedSessionToken(
  token: string,
  secret: string,
  now = new Date()
): AuthSession {
  readSessionSecret({ KNOWLEDGEOS_SESSION_SECRET: secret });

  const [version, encodedPayload, signature, ...extraParts] = token.split(".");

  if (
    version !== signedSessionVersion ||
    !encodedPayload ||
    !signature ||
    extraParts.length > 0
  ) {
    throw new AuthError("invalid_session", "Signed session token is invalid.");
  }

  const signingInput = `${version}.${encodedPayload}`;
  const expectedSignature = sign(signingInput, secret);

  if (!timingSafeEqualText(signature, expectedSignature)) {
    throw new AuthError("invalid_session", "Signed session token is invalid.");
  }

  let payload: SignedSessionPayload;

  try {
    payload = parseSignedPayload(JSON.parse(decodeBase64Url(encodedPayload)));
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("invalid_session", "Signed session payload is invalid.");
  }

  if (payload.expiresAt <= nowSeconds(now)) {
    throw new AuthError("invalid_session", "Signed session token has expired.");
  }

  const session = {
    userId: payload.userId,
    organizationId: payload.organizationId,
    membershipId: payload.membershipId,
    role: payload.role,
    email: payload.email,
    name: payload.name,
    source: "signed-cookie" as const
  };

  validateSessionFields(session);

  return session;
}

export function parseSignedCookieSession(
  headerList: Headers,
  env: AuthEnvironment = process.env,
  now = new Date()
): AuthSession | null {
  const token = readCookie(headerList, authCookieName);

  if (!token) {
    return null;
  }

  return parseSignedSessionToken(token, readSessionSecret(env), now);
}

export function createSessionCookieHeader(
  token: string,
  options: SessionCookieOptions = {}
): string {
  const maxAgeSeconds = options.maxAgeSeconds ?? defaultSessionTtlSeconds;
  const path = options.path ?? "/";
  const sameSite = options.sameSite ?? "Lax";
  const parts = [
    `${authCookieName}=${token}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`
  ];

  if (options.secure ?? process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function expireSessionCookieHeader(
  options: Pick<SessionCookieOptions, "path" | "secure" | "sameSite"> = {}
): string {
  return [
    `${authCookieName}=`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    `SameSite=${options.sameSite ?? "Lax"}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    options.secure ?? process.env.NODE_ENV === "production" ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

export function parseCurrentSession(
  headerList: Headers,
  env: AuthEnvironment = process.env,
  now = new Date()
): AuthSession | null {
  const signedCookieSession = parseSignedCookieSession(headerList, env, now);

  if (signedCookieSession) {
    return signedCookieSession;
  }

  if (developmentHeadersEnabled(env)) {
    return parseDevelopmentSession(headerList);
  }

  return null;
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  return parseCurrentSession(await headers());
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getCurrentSession();

  if (!session) {
    throw new AuthError(
      "unauthenticated",
      "Authentication is required for this resource."
    );
  }

  return session;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
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
        message: "Unexpected authentication failure."
      }
    },
    { status: 500 }
  );
}

export type InvitationDeepLinkIssueCode =
  | "incomplete_link"
  | "ambiguous_link"
  | "invalid_link";

export interface InvitationDeepLinkContext {
  invitationId: string;
  email: string;
  organizationId?: string;
}

export interface InvitationDeepLinkIssue {
  code: InvitationDeepLinkIssueCode;
  message: string;
}

export interface InvitationDeepLinkParseResult {
  context: InvitationDeepLinkContext | null;
  issue: InvitationDeepLinkIssue | null;
  consumedContextParameters: boolean;
  sensitiveParametersRemoved: boolean;
  sanitizedSearch: string;
}

const contextParameterKeys = [
  "invitationId",
  "email",
  "organizationId"
] as const;
const sensitiveParameterKeys = new Set([
  "accesstoken",
  "apikey",
  "credential",
  "invitationtoken",
  "invitetoken",
  "password",
  "rawtoken",
  "secret",
  "token",
  "tokenhash"
]);

function normalizeParameterKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveParameterKey(value: string): boolean {
  return sensitiveParameterKeys.has(normalizeParameterKey(value));
}

function createSanitizedSearch(parameters: URLSearchParams): {
  sensitiveParametersRemoved: boolean;
  sanitizedSearch: string;
} {
  const sanitized = new URLSearchParams(parameters);
  let sensitiveParametersRemoved = false;

  for (const key of Array.from(sanitized.keys())) {
    if (
      contextParameterKeys.includes(
        key as (typeof contextParameterKeys)[number]
      ) ||
      isSensitiveParameterKey(key)
    ) {
      sensitiveParametersRemoved ||= isSensitiveParameterKey(key);
      sanitized.delete(key);
    }
  }

  const value = sanitized.toString();

  return {
    sensitiveParametersRemoved,
    sanitizedSearch: value ? `?${value}` : ""
  };
}

export function parseInvitationAcceptanceDeepLink(
  search: string
): InvitationDeepLinkParseResult {
  const parameters = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  const consumedContextParameters = contextParameterKeys.some((key) =>
    parameters.has(key)
  );
  const sanitized = createSanitizedSearch(parameters);

  if (!consumedContextParameters) {
    return {
      context: null,
      issue: null,
      consumedContextParameters,
      ...sanitized
    };
  }

  if (contextParameterKeys.some((key) => parameters.getAll(key).length > 1)) {
    return {
      context: null,
      issue: {
        code: "ambiguous_link",
        message: "Invitation link contains duplicate context parameters."
      },
      consumedContextParameters,
      ...sanitized
    };
  }

  const invitationId = parameters.get("invitationId")?.trim() ?? "";
  const email = parameters.get("email")?.trim() ?? "";
  const organizationId = parameters.get("organizationId")?.trim() ?? "";

  if (!invitationId || !email) {
    return {
      context: null,
      issue: {
        code: "incomplete_link",
        message: "Invitation link must include invitationId and email."
      },
      consumedContextParameters,
      ...sanitized
    };
  }

  if (
    invitationId.length > 200 ||
    email.length > 320 ||
    organizationId.length > 200
  ) {
    return {
      context: null,
      issue: {
        code: "invalid_link",
        message: "Invitation link context exceeds supported limits."
      },
      consumedContextParameters,
      ...sanitized
    };
  }

  return {
    context: {
      invitationId,
      email,
      organizationId: organizationId || undefined
    },
    issue: null,
    consumedContextParameters,
    ...sanitized
  };
}

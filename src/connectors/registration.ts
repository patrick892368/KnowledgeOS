import { randomUUID } from "node:crypto";

import type { AuthSession } from "@/auth/session";
import {
  externalConnectorCapabilities,
  externalConnectorScopeKinds,
  externalConnectorSyncStrategies,
  externalConnectorTypes,
  type ExternalConnectorCapability,
  type ExternalConnectorScopeKind,
  type ExternalConnectorSyncStrategy,
  type ExternalConnectorType
} from "@/db/model";
import type { auditEvents } from "@/db/schema";

export {
  externalConnectorCapabilities,
  externalConnectorScopeKinds,
  externalConnectorSyncStrategies,
  externalConnectorTypes
};
export type {
  ExternalConnectorCapability,
  ExternalConnectorScopeKind,
  ExternalConnectorSyncStrategy,
  ExternalConnectorType
};

export interface ExternalConnectorRegistrationPayload {
  organizationId?: string;
  connectorType: ExternalConnectorType;
  accountReference: string;
  credentialReference: string;
  sourceScope: {
    kind: ExternalConnectorScopeKind;
    externalId: string;
  };
  capabilities: ExternalConnectorCapability[];
  permissionMode: "source_acl";
  citationRequired: true;
  configuration: {
    displayName: string;
    syncStrategy: ExternalConnectorSyncStrategy;
    cursorReference?: string;
  };
}

export interface ExternalConnectorRegistrationPlan {
  id: string;
  organizationId: string;
  connectorType: ExternalConnectorType;
  accountReference: string;
  credentialReference: string;
  sourceScope: {
    kind: ExternalConnectorScopeKind;
    externalId: string;
  };
  capabilities: ExternalConnectorCapability[];
  permissionMode: "source_acl";
  citationRequired: true;
  configuration: {
    displayName: string;
    syncStrategy: ExternalConnectorSyncStrategy;
    cursorReference?: string;
  };
  status: "planned";
  executionMode: "plan_only";
  persistence: "not_performed";
  oauth: "not_performed";
  networkAccess: "not_performed";
  ingestion: "not_performed";
  syncExecution: "not_performed";
  credentialExposure: "reference_only";
  sourceContentExposure: "not_exposed";
  createdAt: Date;
  auditIntent: typeof auditEvents.$inferInsert;
}

export type ExternalConnectorRegistrationErrorCode =
  | "invalid_payload"
  | "unsupported_connector"
  | "invalid_scope"
  | "invalid_capability"
  | "unsafe_configuration"
  | "forbidden"
  | "not_found";

export class ExternalConnectorRegistrationError extends Error {
  constructor(
    public readonly code: ExternalConnectorRegistrationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ExternalConnectorRegistrationError";
  }
}

const uuidBody =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuidPattern = new RegExp(`^${uuidBody}$`, "i");
const credentialReferencePattern = new RegExp(`^cred_${uuidBody}$`, "i");
const cursorReferencePattern = new RegExp(`^cursor_${uuidBody}$`, "i");
const safeAccountPattern = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const githubPartPattern = /^[a-z0-9](?:[a-z0-9_.-]{0,98}[a-z0-9])?$/i;
const slackChannelPattern = /^[CG][A-Z0-9]{8,20}$/;
const driveFolderPattern = /^[a-z0-9_-]{10,128}$/i;
const notionPagePattern = /^[0-9a-f]{32}$/i;
const notionPageInputPattern =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const allowedRootKeys = new Set([
  "organizationId",
  "connectorType",
  "accountReference",
  "credentialReference",
  "sourceScope",
  "capabilities",
  "permissionMode",
  "citationRequired",
  "configuration"
]);
const allowedScopeKeys = new Set(["kind", "externalId"]);
const allowedConfigurationKeys = new Set([
  "displayName",
  "syncStrategy",
  "cursorReference"
]);
const unsafeKeyFragments = [
  "token",
  "secret",
  "password",
  "apikey",
  "authorization",
  "cookie",
  "privatekey",
  "oauthcode",
  "accesskey",
  "credential"
];
const secretValuePatterns = [
  /\bBearer\s+\S{8,}/i,
  /\bgh[pousr]_[a-z0-9_]{20,}/i,
  /\bxox[baprs]-[a-z0-9-]{10,}/i,
  /\bya29\.[a-z0-9_-]{10,}/i,
  /\bsecret_[a-z0-9]{10,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/
];
const expectedScopeKind: Record<
  ExternalConnectorType,
  ExternalConnectorScopeKind
> = {
  github: "repository",
  slack: "channel",
  google_drive: "folder",
  notion: "page"
};
const supportedCapabilities: Record<
  ExternalConnectorType,
  readonly ExternalConnectorCapability[]
> = {
  github: externalConnectorCapabilities,
  slack: externalConnectorCapabilities,
  google_drive: externalConnectorCapabilities,
  notion: externalConnectorCapabilities
};

function registrationError(
  code: ExternalConnectorRegistrationErrorCode,
  message: string
): never {
  throw new ExternalConnectorRegistrationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    registrationError("invalid_payload", `${label} contains unknown fields.`);
  }
}

function normalizedKey(value: string): string {
  return value.replace(/[-_\s]/g, "").toLowerCase();
}

function assertNoSecretBearingFields(
  value: unknown,
  path = "payload",
  depth = 0,
  state: { nodes: number } = { nodes: 0 }
): void {
  state.nodes += 1;

  if (depth > 8 || state.nodes > 128) {
    registrationError(
      "invalid_payload",
      "External connector registration is too complex."
    );
  }

  if (Array.isArray(value)) {
    if (value.length > 32) {
      registrationError(
        "invalid_payload",
        "External connector registration contains too many values."
      );
    }

    value.forEach((item, index) =>
      assertNoSecretBearingFields(item, `${path}[${index}]`, depth + 1, state)
    );
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const entries = Object.entries(value);

  if (entries.length > 32) {
    registrationError(
      "invalid_payload",
      "External connector registration contains too many fields."
    );
  }

  for (const [key, nested] of entries) {
    const normalized = normalizedKey(key);
    const isReference =
      normalized === "credentialreference" ||
      normalized === "cursorreference";

    if (
      !isReference &&
      unsafeKeyFragments.some((fragment) => normalized.includes(fragment))
    ) {
      registrationError(
        "unsafe_configuration",
        `${path}.${key} cannot contain credential material.`
      );
    }

    assertNoSecretBearingFields(nested, `${path}.${key}`, depth + 1, state);
  }
}

function parseString(
  value: unknown,
  options: {
    label: string;
    maximumLength: number;
    pattern?: RegExp;
    rejectSecretValue?: boolean;
  }
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
    return registrationError(
      "invalid_payload",
      `${options.label} is invalid.`
    );
  }

  if (
    options.rejectSecretValue !== false &&
    secretValuePatterns.some((pattern) => pattern.test(candidate))
  ) {
    return registrationError(
      "unsafe_configuration",
      `${options.label} cannot contain credential material.`
    );
  }

  return candidate;
}

function parseConnectorType(value: unknown): ExternalConnectorType {
  const candidate = typeof value === "string" ? value.trim() : "";

  if (!externalConnectorTypes.includes(candidate as ExternalConnectorType)) {
    return registrationError(
      "unsupported_connector",
      "External connector type is not supported."
    );
  }

  return candidate as ExternalConnectorType;
}

function parseScope(
  value: unknown,
  connectorType: ExternalConnectorType
): ExternalConnectorRegistrationPayload["sourceScope"] {
  if (!isRecord(value)) {
    return registrationError("invalid_scope", "Connector source scope is invalid.");
  }

  assertAllowedKeys(value, allowedScopeKeys, "Connector source scope");
  const kind =
    typeof value.kind === "string" ? value.kind.trim() : "";

  if (kind !== expectedScopeKind[connectorType]) {
    return registrationError(
      "invalid_scope",
      "Connector source scope is not supported for this connector."
    );
  }

  const rawExternalId = parseString(value.externalId, {
    label: "Connector source external ID",
    maximumLength: 201
  });
  let externalId: string;

  if (connectorType === "github") {
    const parts = rawExternalId.split("/");

    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !githubPartPattern.test(parts[0]) ||
      !githubPartPattern.test(parts[1])
    ) {
      return registrationError(
        "invalid_scope",
        "GitHub source scope must be owner/repository."
      );
    }

    externalId = `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
  } else if (connectorType === "slack") {
    externalId = rawExternalId.toUpperCase();

    if (!slackChannelPattern.test(externalId)) {
      return registrationError(
        "invalid_scope",
        "Slack source scope must be a channel ID."
      );
    }
  } else if (connectorType === "google_drive") {
    externalId = rawExternalId;

    if (!driveFolderPattern.test(externalId)) {
      return registrationError(
        "invalid_scope",
        "Google Drive source scope must be a folder ID."
      );
    }
  } else {
    if (!notionPageInputPattern.test(rawExternalId)) {
      return registrationError(
        "invalid_scope",
        "Notion source scope must be a page ID."
      );
    }

    externalId = rawExternalId.replace(/-/g, "").toLowerCase();

    if (!notionPagePattern.test(externalId)) {
      return registrationError(
        "invalid_scope",
        "Notion source scope must be a page ID."
      );
    }
  }

  return Object.freeze({
    kind: kind as ExternalConnectorScopeKind,
    externalId
  });
}

function parseCapabilities(
  value: unknown,
  connectorType: ExternalConnectorType
): ExternalConnectorCapability[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    return registrationError(
      "invalid_capability",
      "Connector capabilities must include two to four values."
    );
  }

  const parsed = value.map((capability) => {
    const candidate =
      typeof capability === "string" ? capability.trim() : "";

    if (
      !externalConnectorCapabilities.includes(
        candidate as ExternalConnectorCapability
      ) ||
      !supportedCapabilities[connectorType].includes(
        candidate as ExternalConnectorCapability
      )
    ) {
      return registrationError(
        "invalid_capability",
        "Connector capability is not supported."
      );
    }

    return candidate as ExternalConnectorCapability;
  });

  if (
    new Set(parsed).size !== parsed.length ||
    !parsed.includes("content_read") ||
    !parsed.includes("permission_sync")
  ) {
    return registrationError(
      "invalid_capability",
      "Connector capabilities must be unique and include content_read and permission_sync."
    );
  }

  return Object.freeze(
    externalConnectorCapabilities.filter((capability) =>
      parsed.includes(capability)
    )
  ) as ExternalConnectorCapability[];
}

function parseConfiguration(
  value: unknown,
  capabilities: readonly ExternalConnectorCapability[]
): ExternalConnectorRegistrationPayload["configuration"] {
  if (!isRecord(value)) {
    return registrationError(
      "invalid_payload",
      "Connector configuration is invalid."
    );
  }

  assertAllowedKeys(value, allowedConfigurationKeys, "Connector configuration");
  const displayName = parseString(value.displayName, {
    label: "Connector display name",
    maximumLength: 80
  });
  const syncStrategy =
    value.syncStrategy === "full" || value.syncStrategy === "incremental"
      ? value.syncStrategy
      : registrationError(
          "invalid_payload",
          "Connector sync strategy is invalid."
        );
  const cursorReference =
    value.cursorReference === undefined
      ? undefined
      : parseString(value.cursorReference, {
          label: "Connector cursor reference",
          maximumLength: 43,
          pattern: cursorReferencePattern,
          rejectSecretValue: false
        });

  if (
    (syncStrategy === "incremental" &&
      !capabilities.includes("incremental_sync")) ||
    (cursorReference && syncStrategy !== "incremental")
  ) {
    return registrationError(
      "invalid_capability",
      "Incremental connector configuration requires incremental_sync capability."
    );
  }

  return Object.freeze({
    displayName,
    syncStrategy,
    ...(cursorReference ? { cursorReference } : {})
  });
}

export function parseExternalConnectorRegistrationPayload(
  payload: unknown
): ExternalConnectorRegistrationPayload {
  assertNoSecretBearingFields(payload);

  if (!isRecord(payload)) {
    return registrationError(
      "invalid_payload",
      "External connector registration must be an object."
    );
  }

  assertAllowedKeys(payload, allowedRootKeys, "External connector registration");
  const connectorType = parseConnectorType(payload.connectorType);
  const capabilities = parseCapabilities(payload.capabilities, connectorType);
  const organizationId =
    payload.organizationId === undefined
      ? undefined
      : parseString(payload.organizationId, {
          label: "Organization ID",
          maximumLength: 128
        });
  const accountReference = parseString(payload.accountReference, {
    label: "Connector account reference",
    maximumLength: 128,
    pattern: safeAccountPattern
  });
  const credentialReference = parseString(payload.credentialReference, {
    label: "Connector credential reference",
    maximumLength: 41,
    pattern: credentialReferencePattern,
    rejectSecretValue: false
  }).toLowerCase();

  if (payload.permissionMode !== "source_acl") {
    return registrationError(
      "unsafe_configuration",
      "External connectors must preserve source ACLs."
    );
  }

  if (payload.citationRequired !== true) {
    return registrationError(
      "unsafe_configuration",
      "External connector content must require citations."
    );
  }

  return Object.freeze({
    ...(organizationId ? { organizationId } : {}),
    connectorType,
    accountReference,
    credentialReference,
    sourceScope: parseScope(payload.sourceScope, connectorType),
    capabilities,
    permissionMode: "source_acl",
    citationRequired: true,
    configuration: parseConfiguration(payload.configuration, capabilities)
  });
}

function parseDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return registrationError(
      "invalid_payload",
      "Connector registration time is invalid."
    );
  }

  return new Date(value.getTime());
}

function parseRegistrationId(value: string): string {
  const id = value.trim();

  if (!uuidPattern.test(id)) {
    return registrationError(
      "invalid_payload",
      "Connector registration ID must be a UUID."
    );
  }

  return id.toLowerCase();
}

export function createExternalConnectorRegistrationPlan(input: {
  session: AuthSession;
  payload: ExternalConnectorRegistrationPayload;
  registrationId?: string;
  now?: Date;
}): ExternalConnectorRegistrationPlan {
  if (input.session.role !== "owner" && input.session.role !== "admin") {
    return registrationError(
      "forbidden",
      "Only owner or admin members can plan external connectors."
    );
  }

  if (
    input.payload.organizationId &&
    input.payload.organizationId !== input.session.organizationId
  ) {
    return registrationError(
      "not_found",
      "External connector organization was not found."
    );
  }

  const id = parseRegistrationId(input.registrationId ?? randomUUID());
  const createdAt = parseDate(input.now ?? new Date());
  const auditIntent: typeof auditEvents.$inferInsert = Object.freeze({
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action: "connector.registration_planned",
    resourceType: "organization",
    resourceId: input.session.organizationId,
    metadata: Object.freeze({
      connectorRegistrationId: id,
      connectorType: input.payload.connectorType,
      scopeKind: input.payload.sourceScope.kind,
      capabilities: Object.freeze([...input.payload.capabilities]),
      permissionMode: "source_acl",
      citationRequired: true,
      executionMode: "plan_only",
      credentialExposure: "reference_only",
      sourceContentExposure: "not_exposed"
    })
  });

  return Object.freeze({
    id,
    organizationId: input.session.organizationId,
    connectorType: input.payload.connectorType,
    accountReference: input.payload.accountReference,
    credentialReference: input.payload.credentialReference,
    sourceScope: input.payload.sourceScope,
    capabilities: input.payload.capabilities,
    permissionMode: "source_acl",
    citationRequired: true,
    configuration: input.payload.configuration,
    status: "planned",
    executionMode: "plan_only",
    persistence: "not_performed",
    oauth: "not_performed",
    networkAccess: "not_performed",
    ingestion: "not_performed",
    syncExecution: "not_performed",
    credentialExposure: "reference_only",
    sourceContentExposure: "not_exposed",
    createdAt,
    auditIntent
  });
}

export function planExternalConnectorRegistration(input: {
  session: AuthSession;
  payload: unknown;
  registrationId?: string;
  now?: Date;
}): ExternalConnectorRegistrationPlan {
  return createExternalConnectorRegistrationPlan({
    session: input.session,
    payload: parseExternalConnectorRegistrationPayload(input.payload),
    registrationId: input.registrationId,
    now: input.now
  });
}

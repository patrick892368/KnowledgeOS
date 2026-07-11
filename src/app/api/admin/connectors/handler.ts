import {
  authErrorResponse,
  requireSession,
  type AuthSession
} from "@/auth/session";
import {
  ExternalConnectorRegistrationError,
  planExternalConnectorRegistration,
  type ExternalConnectorRegistrationPlan
} from "@/connectors/registration";
import { createDatabaseClient, type Database } from "@/db/client";
import {
  ExternalConnectorRepositoryError,
  listOrganizationExternalConnectors,
  persistExternalConnector,
  type PersistedExternalConnector
} from "@/db/external-connector-repository";

export interface ExternalConnectorRouteDependencies {
  requireSession: () => Promise<AuthSession>;
  createDatabaseClient: () => Database;
  planRegistration: typeof planExternalConnectorRegistration;
  persistConnector: typeof persistExternalConnector;
  listConnectors: typeof listOrganizationExternalConnectors;
  now: () => Date;
}

class ExternalConnectorApiError extends Error {
  constructor(
    public readonly code:
      | "invalid_payload"
      | "payload_too_large"
      | "forbidden",
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ExternalConnectorApiError";
  }
}

const maximumBodyBytes = 16_384;
const allowedQueryKeys = new Set(["limit"]);
const defaultDependencies: ExternalConnectorRouteDependencies = {
  requireSession,
  createDatabaseClient,
  planRegistration: planExternalConnectorRegistration,
  persistConnector: persistExternalConnector,
  listConnectors: listOrganizationExternalConnectors,
  now: () => new Date()
};

function assertManager(session: AuthSession): void {
  if (session.role !== "owner" && session.role !== "admin") {
    throw new ExternalConnectorApiError(
      "forbidden",
      "Only owner or admin members can manage external connectors.",
      403
    );
  }
}

function apiError(
  code: ExternalConnectorApiError["code"],
  message: string,
  status: number
): never {
  throw new ExternalConnectorApiError(code, message, status);
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const length = Number(contentLength);

    if (!Number.isSafeInteger(length) || length < 0) {
      return apiError(
        "invalid_payload",
        "External connector request is invalid.",
        400
      );
    }

    if (length > maximumBodyBytes) {
      return apiError(
        "payload_too_large",
        "External connector request is too large.",
        413
      );
    }
  }

  if (!request.body) {
    return apiError(
      "invalid_payload",
      "External connector request is invalid.",
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

    if (totalBytes > maximumBodyBytes) {
      try {
        await reader.cancel();
      } catch {
        // The rejected request remains hidden if stream cancellation fails.
      }
      return apiError(
        "payload_too_large",
        "External connector request is too large.",
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

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return apiError(
      "invalid_payload",
      "External connector request is invalid.",
      400
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return apiError(
      "invalid_payload",
      "External connector request must be valid JSON.",
      400
    );
  }
}

function parseListQuery(request: Request): number {
  const searchParams = new URL(request.url).searchParams;

  for (const key of searchParams.keys()) {
    if (!allowedQueryKeys.has(key) || searchParams.getAll(key).length !== 1) {
      return apiError(
        "invalid_payload",
        "External connector list query is invalid.",
        400
      );
    }
  }

  const limitValue = searchParams.get("limit");
  const limit = limitValue === null ? 50 : Number(limitValue.trim());

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return apiError(
      "invalid_payload",
      "External connector list limit must be an integer between 1 and 100.",
      400
    );
  }

  return limit;
}

function serializeConnector(connector: PersistedExternalConnector) {
  return {
    id: connector.id,
    connectorType: connector.connectorType,
    accountReference: connector.accountReference,
    sourceScope: {
      kind: connector.scopeKind,
      externalId: connector.scopeExternalId
    },
    capabilities: connector.capabilities,
    permissionMode: "source_acl",
    citationRequired: true,
    configuration: {
      displayName: connector.displayName,
      syncStrategy: connector.syncStrategy,
      credentialReferenceStatus: "configured",
      cursorReferenceStatus: connector.cursorReference
        ? "configured"
        : "not_configured"
    },
    status: connector.status,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
    executionMode: "configuration_only",
    oauth: "not_performed",
    networkAccess: "not_performed",
    ingestion: "not_performed",
    syncExecution: "not_performed",
    credentialExposure: "reference_only",
    sourceContentExposure: "not_exposed"
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof ExternalConnectorApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  if (error instanceof ExternalConnectorRegistrationError) {
    const status =
      error.code === "forbidden"
        ? 403
        : error.code === "not_found"
          ? 404
          : 400;

    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status }
    );
  }

  if (error instanceof ExternalConnectorRepositoryError) {
    const status =
      error.code === "forbidden"
        ? 403
        : error.code === "cross_scope"
          ? 404
          : error.code === "invalid_state"
            ? 409
            : 400;

    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status }
    );
  }

  return Response.json(
    {
      error: {
        code: "database_unavailable",
        message: "External connector configuration is temporarily unavailable."
      }
    },
    { status: 503 }
  );
}

async function authenticate(
  dependencies: ExternalConnectorRouteDependencies
): Promise<AuthSession | Response> {
  try {
    return await dependencies.requireSession();
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function handleExternalConnectorList(
  request: Request,
  dependencies: ExternalConnectorRouteDependencies = defaultDependencies
): Promise<Response> {
  const authentication = await authenticate(dependencies);

  if (authentication instanceof Response) {
    return authentication;
  }

  try {
    assertManager(authentication);
    const limit = parseListQuery(request);
    const connectors = await dependencies.listConnectors(
      dependencies.createDatabaseClient(),
      { session: authentication, limit }
    );

    return Response.json({
      count: connectors.length,
      connectors: connectors.map(serializeConnector),
      executionMode: "configuration_only",
      oauth: "not_performed",
      networkAccess: "not_performed",
      ingestion: "not_performed",
      syncExecution: "not_performed",
      credentialExposure: "reference_only",
      sourceContentExposure: "not_exposed"
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleExternalConnectorPersistence(
  request: Request,
  dependencies: ExternalConnectorRouteDependencies = defaultDependencies
): Promise<Response> {
  const authentication = await authenticate(dependencies);

  if (authentication instanceof Response) {
    return authentication;
  }

  try {
    assertManager(authentication);
    const payload = await readBoundedJsonBody(request);
    const plan: ExternalConnectorRegistrationPlan =
      dependencies.planRegistration({
        session: authentication,
        payload,
        now: dependencies.now()
      });
    const result = await dependencies.persistConnector(
      dependencies.createDatabaseClient(),
      { session: authentication, plan }
    );

    return Response.json(
      {
        mode: result.mode,
        connector: serializeConnector(result.connector),
        executionMode: "configuration_only",
        oauth: "not_performed",
        networkAccess: "not_performed",
        ingestion: "not_performed",
        syncExecution: "not_performed",
        credentialExposure: "reference_only",
        sourceContentExposure: "not_exposed"
      },
      { status: result.mode === "created" ? 201 : 200 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

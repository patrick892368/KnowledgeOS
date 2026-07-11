import { describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import {
  ExternalConnectorRegistrationError,
  planExternalConnectorRegistration
} from "@/connectors/registration";
import type { Database } from "@/db/client";
import {
  ExternalConnectorRepositoryError,
  type PersistedExternalConnector
} from "@/db/external-connector-repository";

import {
  handleExternalConnectorList,
  handleExternalConnectorPersistence,
  type ExternalConnectorRouteDependencies
} from "./handler";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const connectorId = "77777777-7777-4777-8777-777777777777";
const now = new Date("2026-07-11T03:00:00.000Z");
const connectorRequest = {
  connectorType: "github",
  accountReference: "installation:123456",
  credentialReference: "cred_88888888-8888-4888-8888-888888888888",
  sourceScope: {
    kind: "repository",
    externalId: "patrick892368/knowledgeos"
  },
  capabilities: [
    "metadata_read",
    "content_read",
    "incremental_sync",
    "permission_sync"
  ],
  permissionMode: "source_acl",
  citationRequired: true,
  configuration: {
    displayName: "KnowledgeOS GitHub",
    syncStrategy: "incremental",
    cursorReference: "cursor_99999999-9999-4999-8999-999999999999"
  }
};
const plan = planExternalConnectorRegistration({
  session,
  payload: connectorRequest,
  registrationId: connectorId,
  now
});
const connector: PersistedExternalConnector = {
  id: connectorId,
  organizationId: session.organizationId,
  connectorType: "github",
  accountReference: "installation:123456",
  credentialReference: connectorRequest.credentialReference,
  scopeKind: "repository",
  scopeExternalId: "patrick892368/knowledgeos",
  capabilities: [
    "metadata_read",
    "content_read",
    "incremental_sync",
    "permission_sync"
  ],
  permissionMode: "source_acl",
  citationRequired: true,
  displayName: "KnowledgeOS GitHub",
  syncStrategy: "incremental",
  cursorReference: connectorRequest.configuration.cursorReference,
  status: "configured",
  createdBy: session.userId,
  createdAt: now,
  updatedAt: now
};
const auditEvent = {
  organizationId: session.organizationId,
  actorUserId: session.userId,
  action: "connector.configuration_created",
  resourceType: "organization" as const,
  resourceId: session.organizationId,
  metadata: { connectorId, credentialExposure: "reference_only" }
};

function postRequest(body: unknown, raw = false): Request {
  return new Request("http://knowledgeos.local/api/admin/connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body)
  });
}

function getRequest(query = ""): Request {
  return new Request(`http://knowledgeos.local/api/admin/connectors${query}`);
}

function createDependencies(input: {
  session?: AuthSession;
  authError?: unknown;
  databaseError?: unknown;
  planError?: unknown;
  persistError?: unknown;
  listError?: unknown;
  mode?: "created" | "existing";
  connectors?: PersistedExternalConnector[];
} = {}) {
  const db = { name: "external-connector-test-db" } as unknown as Database;
  const requireSession = vi.fn(async () => {
    if (input.authError) {
      throw input.authError;
    }
    return input.session ?? session;
  });
  const createDatabaseClient = vi.fn(() => {
    if (input.databaseError) {
      throw input.databaseError;
    }
    return db;
  });
  const planRegistration = vi.fn(() => {
    if (input.planError) {
      throw input.planError;
    }
    return plan;
  });
  const persistConnector = vi.fn(async () => {
    if (input.persistError) {
      throw input.persistError;
    }
    const mode = input.mode ?? "created";
    return {
      mode,
      connector,
      auditEvent: {
        ...auditEvent,
        action:
          mode === "created"
            ? "connector.configuration_created"
            : "connector.configuration_existing"
      }
    };
  });
  const listConnectors = vi.fn(async () => {
    if (input.listError) {
      throw input.listError;
    }
    return input.connectors ?? [connector];
  });
  const dependencies: ExternalConnectorRouteDependencies = {
    requireSession,
    createDatabaseClient,
    planRegistration:
      planRegistration as unknown as ExternalConnectorRouteDependencies["planRegistration"],
    persistConnector:
      persistConnector as unknown as ExternalConnectorRouteDependencies["persistConnector"],
    listConnectors:
      listConnectors as unknown as ExternalConnectorRouteDependencies["listConnectors"],
    now: vi.fn(() => now)
  };

  return {
    createDatabaseClient,
    db,
    dependencies,
    listConnectors,
    persistConnector,
    planRegistration,
    requireSession
  };
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested)
  ]);
}

function expectSafePublicPayload(payload: unknown): void {
  const keys = collectKeys(payload).map((key) => key.toLowerCase());

  for (const forbiddenKey of [
    "organizationid",
    "actoruserid",
    "createdby",
    "credentialreference",
    "cursorreference",
    "credential",
    "accesstoken",
    "refreshtoken",
    "apikey",
    "secret",
    "providerpayload",
    "sourcecontent",
    "auditevent"
  ]) {
    expect(keys).not.toContain(forbiddenKey);
  }
  expect(JSON.stringify(payload)).not.toMatch(
    /cred_[0-9a-f-]{36}|cursor_[0-9a-f-]{36}|ghp_|xoxb-|ya29\.|secret_/i
  );
}

describe("POST /api/admin/connectors", () => {
  it("persists after manager auth and contract validation with safe output", async () => {
    const {
      createDatabaseClient,
      db,
      dependencies,
      persistConnector,
      planRegistration,
      requireSession
    } = createDependencies();
    const response = await handleExternalConnectorPersistence(
      postRequest(connectorRequest),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      mode: "created",
      connector: {
        id: connectorId,
        connectorType: "github",
        accountReference: "installation:123456",
        sourceScope: {
          kind: "repository",
          externalId: "patrick892368/knowledgeos"
        },
        capabilities: connector.capabilities,
        permissionMode: "source_acl",
        citationRequired: true,
        configuration: {
          displayName: "KnowledgeOS GitHub",
          syncStrategy: "incremental",
          credentialReferenceStatus: "configured",
          cursorReferenceStatus: "configured"
        },
        status: "configured",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        executionMode: "configuration_only",
        oauth: "not_performed",
        networkAccess: "not_performed",
        ingestion: "not_performed",
        syncExecution: "not_performed",
        credentialExposure: "reference_only",
        sourceContentExposure: "not_exposed"
      },
      executionMode: "configuration_only",
      oauth: "not_performed",
      networkAccess: "not_performed",
      ingestion: "not_performed",
      syncExecution: "not_performed",
      credentialExposure: "reference_only",
      sourceContentExposure: "not_exposed"
    });
    expect(planRegistration).toHaveBeenCalledWith({
      session,
      payload: connectorRequest,
      now
    });
    expect(persistConnector).toHaveBeenCalledWith(db, { session, plan });
    expect(requireSession.mock.invocationCallOrder[0]).toBeLessThan(
      planRegistration.mock.invocationCallOrder[0]
    );
    expect(planRegistration.mock.invocationCallOrder[0]).toBeLessThan(
      createDatabaseClient.mock.invocationCallOrder[0]
    );
    expectSafePublicPayload(payload);
  });

  it("returns existing configuration idempotently", async () => {
    const { dependencies } = createDependencies({ mode: "existing" });
    const response = await handleExternalConnectorPersistence(
      postRequest(connectorRequest),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "existing",
      connector: { id: connectorId, status: "configured" }
    });
  });

  it("stops unauthenticated requests before body and dependencies", async () => {
    const { dependencies } = createDependencies({
      authError: new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    });
    const request = postRequest("{", true);
    const response = await handleExternalConnectorPersistence(
      request,
      dependencies
    );

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(dependencies.planRegistration).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("keeps unexpected authentication failure separate and sanitized", async () => {
    const { dependencies } = createDependencies({
      authError: new Error("private session backend detail")
    });
    const response = await handleExternalConnectorPersistence(
      postRequest(connectorRequest),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: {
        code: "internal_error",
        message: "Unexpected authentication failure."
      }
    });
    expect(JSON.stringify(payload)).not.toContain("private session");
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("stops non-manager sessions before body and dependencies", async () => {
    const { dependencies } = createDependencies({
      session: { ...session, role: "viewer" }
    });
    const request = postRequest("{", true);
    const response = await handleExternalConnectorPersistence(
      request,
      dependencies
    );

    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(dependencies.planRegistration).not.toHaveBeenCalled();
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("rejects malformed, oversized, and invalid content length before planning", async () => {
    const cases = [
      { request: postRequest("{", true), status: 400 },
      {
        request: postRequest({ padding: "x".repeat(16_384) }),
        status: 413
      },
      {
        request: new Request("http://knowledgeos.local/api/admin/connectors", {
          method: "POST",
          headers: { "content-length": "not-a-number" },
          body: "{}"
        }),
        status: 400
      }
    ];

    for (const testCase of cases) {
      const { dependencies } = createDependencies();
      const response = await handleExternalConnectorPersistence(
        testCase.request,
        dependencies
      );

      expect(response.status).toBe(testCase.status);
      expect(dependencies.planRegistration).not.toHaveBeenCalled();
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    }
  });

  it("uses the real registration contract to reject secrets before database work", async () => {
    const { dependencies } = createDependencies();
    dependencies.planRegistration = planExternalConnectorRegistration;
    const response = await handleExternalConnectorPersistence(
      postRequest({
        ...connectorRequest,
        apiKey: "ghp_abcdefghijklmnopqrstuvwxyz"
      }),
      dependencies
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "unsafe_configuration" }
    });
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
    expect(dependencies.persistConnector).not.toHaveBeenCalled();
  });

  it("maps safe contract and repository errors without database leakage", async () => {
    const cases = [
      {
        input: {
          planError: new ExternalConnectorRegistrationError(
            "invalid_scope",
            "Connector source scope is invalid."
          )
        },
        status: 400,
        code: "invalid_scope"
      },
      {
        input: {
          planError: new ExternalConnectorRegistrationError(
            "not_found",
            "External connector organization was not found."
          )
        },
        status: 404,
        code: "not_found"
      },
      {
        input: {
          persistError: new ExternalConnectorRepositoryError(
            "invalid_state",
            "External connector scope already has different configuration."
          )
        },
        status: 409,
        code: "invalid_state"
      }
    ];

    for (const testCase of cases) {
      const { dependencies } = createDependencies(testCase.input);
      const response = await handleExternalConnectorPersistence(
        postRequest(connectorRequest),
        dependencies
      );

      expect(response.status).toBe(testCase.status);
      expect(await response.json()).toMatchObject({
        error: { code: testCase.code }
      });
    }
  });

  it("sanitizes database and unexpected persistence failures", async () => {
    for (const input of [
      { databaseError: new Error("postgres://user:secret@private-host/db") },
      { persistError: new Error("raw credential provider payload") }
    ]) {
      const { dependencies } = createDependencies(input);
      const response = await handleExternalConnectorPersistence(
        postRequest(connectorRequest),
        dependencies
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload).toEqual({
        error: {
          code: "database_unavailable",
          message:
            "External connector configuration is temporarily unavailable."
        }
      });
      expect(JSON.stringify(payload)).not.toMatch(
        /postgres|secret@private-host|raw credential|provider payload/
      );
    }
  });
});

describe("GET /api/admin/connectors", () => {
  it("lists bounded current-organization configurations safely", async () => {
    const { db, dependencies, listConnectors } = createDependencies();
    const response = await handleExternalConnectorList(
      getRequest("?limit=25"),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      count: 1,
      connectors: [
        {
          id: connectorId,
          connectorType: "github",
          configuration: {
            credentialReferenceStatus: "configured",
            cursorReferenceStatus: "configured"
          },
          executionMode: "configuration_only",
          syncExecution: "not_performed"
        }
      ],
      credentialExposure: "reference_only",
      sourceContentExposure: "not_exposed"
    });
    expect(listConnectors).toHaveBeenCalledWith(db, {
      session,
      limit: 25
    });
    expectSafePublicPayload(payload);
  });

  it("uses default limit and returns safe empty state", async () => {
    const { dependencies, listConnectors } = createDependencies({
      connectors: []
    });
    const response = await handleExternalConnectorList(
      getRequest(),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 0, connectors: [] });
    expect(listConnectors).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 50 })
    );
  });

  it("rejects non-manager and invalid queries before database work", async () => {
    const cases = [
      { input: { session: { ...session, role: "viewer" as const } }, query: "" },
      { input: {}, query: "?limit=0" },
      { input: {}, query: "?limit=101" },
      { input: {}, query: "?limit=1.5" },
      { input: {}, query: "?limit=10&limit=20" },
      { input: {}, query: `?organizationId=${session.organizationId}` }
    ];

    for (const testCase of cases) {
      const { dependencies } = createDependencies(testCase.input);
      const response = await handleExternalConnectorList(
        getRequest(testCase.query),
        dependencies
      );

      expect([400, 403]).toContain(response.status);
      expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
      expect(dependencies.listConnectors).not.toHaveBeenCalled();
    }
  });

  it("stops unauthenticated list requests before database work", async () => {
    const { dependencies } = createDependencies({
      authError: new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    });
    const response = await handleExternalConnectorList(
      getRequest(),
      dependencies
    );

    expect(response.status).toBe(401);
    expect(dependencies.createDatabaseClient).not.toHaveBeenCalled();
  });

  it("sanitizes list database failures", async () => {
    const { dependencies } = createDependencies({
      listError: new Error("private connector row and credential")
    });
    const response = await handleExternalConnectorList(
      getRequest(),
      dependencies
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "database_unavailable",
        message: "External connector configuration is temporarily unavailable."
      }
    });
    expect(JSON.stringify(payload)).not.toMatch(/private connector|credential/);
  });
});

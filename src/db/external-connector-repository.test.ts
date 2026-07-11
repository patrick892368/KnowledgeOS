import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/auth/session";
import { planExternalConnectorRegistration } from "@/connectors/registration";

import type { Database } from "./client";
import {
  ExternalConnectorRepositoryError,
  listOrganizationExternalConnectors,
  persistExternalConnector,
  type PersistedExternalConnector
} from "./external-connector-repository";
import { auditEvents, externalConnectors } from "./schema";

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
const createdAt = new Date("2026-07-11T03:00:00.000Z");
const payload = {
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
  payload,
  registrationId: connectorId,
  now: createdAt
});
const persistedConnector: PersistedExternalConnector = {
  id: connectorId,
  organizationId: session.organizationId,
  connectorType: "github",
  accountReference: "installation:123456",
  credentialReference: payload.credentialReference,
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
  cursorReference: payload.configuration.cursorReference,
  status: "configured",
  createdBy: session.userId,
  createdAt,
  updatedAt: createdAt
};

function createPersistenceDatabaseDouble(input: {
  insertedRows?: PersistedExternalConnector[];
  existingRows?: PersistedExternalConnector[];
}) {
  const returning = vi.fn(async () => input.insertedRows ?? []);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const connectorValues = vi.fn(() => ({ onConflictDoNothing }));
  const auditValues = vi.fn(async () => undefined);
  const insert = vi.fn((table: unknown) => {
    if (table === externalConnectors) {
      return { values: connectorValues };
    }

    if (table === auditEvents) {
      return { values: auditValues };
    }

    throw new Error("Unexpected insert table.");
  });
  const limit = vi.fn(async () => input.existingRows ?? []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const tx = { insert, select };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => unknown) => callback(tx)
  );

  return {
    auditValues,
    connectorValues,
    db: { transaction } as unknown as Database,
    insert,
    limit,
    onConflictDoNothing,
    transaction
  };
}

function createListDatabaseDouble(rows: PersistedExternalConnector[] = []) {
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { db: { select } as unknown as Database, limit, orderBy, select, where };
}

describe("persistExternalConnector", () => {
  it("persists a reference-only connector and safe created audit", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: [persistedConnector]
    });
    const result = await persistExternalConnector(db.db, { session, plan });

    expect(result).toMatchObject({
      mode: "created",
      connector: { id: connectorId, status: "configured" },
      auditEvent: {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "connector.configuration_created",
        metadata: {
          connectorId,
          connectorType: "github",
          scopeKind: "repository",
          persistenceMode: "created",
          credentialExposure: "reference_only",
          sourceContentExposure: "not_exposed",
          oauth: "not_performed",
          networkAccess: "not_performed",
          ingestion: "not_performed",
          syncExecution: "not_performed"
        }
      }
    });
    expect(db.connectorValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: connectorId,
        organizationId: session.organizationId,
        connectorType: "github",
        accountReference: "installation:123456",
        credentialReference: payload.credentialReference,
        scopeKind: "repository",
        scopeExternalId: "patrick892368/knowledgeos",
        permissionMode: "source_acl",
        citationRequired: true,
        status: "configured"
      })
    );
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.auditValues).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.auditValues.mock.calls[0])).not.toMatch(
      /credentialReference|cursorReference|accountReference|scopeExternalId|ghp_|xoxb-|sourceContent":/i
    );
  });

  it("returns identical natural-key configuration idempotently with audit", async () => {
    const db = createPersistenceDatabaseDouble({
      insertedRows: [],
      existingRows: [persistedConnector]
    });

    await expect(
      persistExternalConnector(db.db, { session, plan })
    ).resolves.toMatchObject({
      mode: "existing",
      connector: { id: connectorId },
      auditEvent: {
        action: "connector.configuration_existing",
        metadata: { persistenceMode: "existing" }
      }
    });
    expect(db.auditValues).toHaveBeenCalledTimes(1);
  });

  it("rejects conflicting natural-key configuration without audit", async () => {
    const db = createPersistenceDatabaseDouble({
      existingRows: [
        { ...persistedConnector, credentialReference: "cred_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
      ]
    });

    await expect(
      persistExternalConnector(db.db, { session, plan })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(db.auditValues).not.toHaveBeenCalled();
  });

  it("fails safely when a conflict winner cannot be resolved", async () => {
    const db = createPersistenceDatabaseDouble({ existingRows: [] });

    await expect(
      persistExternalConnector(db.db, { session, plan })
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(db.auditValues).not.toHaveBeenCalled();
  });

  it("rejects non-manager, cross-scope, and unsafe plan markers before transaction", async () => {
    const invalidInputs = [
      { session: { ...session, role: "viewer" as const }, plan },
      {
        session,
        plan: {
          ...plan,
          organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        }
      },
      { session, plan: { ...plan, networkAccess: "performed" as never } },
      { session, plan: { ...plan, credentialExposure: "raw" as never } }
    ];

    for (const input of invalidInputs) {
      const db = createPersistenceDatabaseDouble({});

      await expect(
        persistExternalConnector(db.db, input)
      ).rejects.toBeInstanceOf(ExternalConnectorRepositoryError);
      expect(db.transaction).not.toHaveBeenCalled();
    }
  });
});

describe("listOrganizationExternalConnectors", () => {
  it("lists bounded current-organization connectors newest first", async () => {
    const db = createListDatabaseDouble([persistedConnector]);

    await expect(
      listOrganizationExternalConnectors(db.db, {
        session,
        limit: 25
      })
    ).resolves.toEqual([persistedConnector]);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(db.orderBy).toHaveBeenCalledTimes(1);
    expect(db.limit).toHaveBeenCalledWith(25);
  });

  it("uses the bounded default and preserves empty state", async () => {
    const db = createListDatabaseDouble();

    await expect(
      listOrganizationExternalConnectors(db.db, { session })
    ).resolves.toEqual([]);
    expect(db.limit).toHaveBeenCalledWith(50);
  });

  it("rejects non-manager and invalid limits before database work", async () => {
    for (const input of [
      { session: { ...session, role: "viewer" as const }, limit: 50 },
      { session, limit: 0 },
      { session, limit: 101 },
      { session, limit: 1.5 }
    ]) {
      const db = createListDatabaseDouble();

      await expect(
        listOrganizationExternalConnectors(db.db, input)
      ).rejects.toBeInstanceOf(ExternalConnectorRepositoryError);
      expect(db.select).not.toHaveBeenCalled();
    }
  });
});

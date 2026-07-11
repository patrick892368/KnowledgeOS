import { and, desc, eq } from "drizzle-orm";

import type { AuthSession } from "@/auth/session";
import {
  createExternalConnectorRegistrationPlan,
  ExternalConnectorRegistrationError,
  parseExternalConnectorRegistrationPayload,
  type ExternalConnectorRegistrationPlan
} from "@/connectors/registration";
import type {
  ExternalConnectorCapability,
  ExternalConnectorScopeKind,
  ExternalConnectorStatus,
  ExternalConnectorSyncStrategy,
  ExternalConnectorType
} from "@/db/model";

import type { Database } from "./client";
import { auditEvents, externalConnectors } from "./schema";

export type ExternalConnectorPersistenceMode = "created" | "existing";
export type ExternalConnectorRepositoryErrorCode =
  | "forbidden"
  | "cross_scope"
  | "invalid_payload"
  | "invalid_state";

export class ExternalConnectorRepositoryError extends Error {
  constructor(
    public readonly code: ExternalConnectorRepositoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ExternalConnectorRepositoryError";
  }
}

export interface PersistedExternalConnector {
  id: string;
  organizationId: string;
  connectorType: ExternalConnectorType;
  accountReference: string;
  credentialReference: string;
  scopeKind: ExternalConnectorScopeKind;
  scopeExternalId: string;
  capabilities: ExternalConnectorCapability[];
  permissionMode: string;
  citationRequired: boolean;
  displayName: string;
  syncStrategy: ExternalConnectorSyncStrategy;
  cursorReference: string | null;
  status: ExternalConnectorStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalConnectorPersistenceResult {
  mode: ExternalConnectorPersistenceMode;
  connector: PersistedExternalConnector;
  auditEvent: typeof auditEvents.$inferInsert;
}

const connectorSelection = {
  id: externalConnectors.id,
  organizationId: externalConnectors.organizationId,
  connectorType: externalConnectors.connectorType,
  accountReference: externalConnectors.accountReference,
  credentialReference: externalConnectors.credentialReference,
  scopeKind: externalConnectors.scopeKind,
  scopeExternalId: externalConnectors.scopeExternalId,
  capabilities: externalConnectors.capabilities,
  permissionMode: externalConnectors.permissionMode,
  citationRequired: externalConnectors.citationRequired,
  displayName: externalConnectors.displayName,
  syncStrategy: externalConnectors.syncStrategy,
  cursorReference: externalConnectors.cursorReference,
  status: externalConnectors.status,
  createdBy: externalConnectors.createdBy,
  createdAt: externalConnectors.createdAt,
  updatedAt: externalConnectors.updatedAt
};

function repositoryError(
  code: ExternalConnectorRepositoryErrorCode,
  message: string
): never {
  throw new ExternalConnectorRepositoryError(code, message);
}

function normalizePlan(
  session: AuthSession,
  plan: ExternalConnectorRegistrationPlan
): ExternalConnectorRegistrationPlan {
  if (
    plan.status !== "planned" ||
    plan.executionMode !== "plan_only" ||
    plan.persistence !== "not_performed" ||
    plan.oauth !== "not_performed" ||
    plan.networkAccess !== "not_performed" ||
    plan.ingestion !== "not_performed" ||
    plan.syncExecution !== "not_performed" ||
    plan.credentialExposure !== "reference_only" ||
    plan.sourceContentExposure !== "not_exposed"
  ) {
    return repositoryError(
      "invalid_payload",
      "External connector registration plan is unsafe."
    );
  }

  try {
    const payload = parseExternalConnectorRegistrationPayload({
      organizationId: plan.organizationId,
      connectorType: plan.connectorType,
      accountReference: plan.accountReference,
      credentialReference: plan.credentialReference,
      sourceScope: plan.sourceScope,
      capabilities: plan.capabilities,
      permissionMode: plan.permissionMode,
      citationRequired: plan.citationRequired,
      configuration: plan.configuration
    });

    return createExternalConnectorRegistrationPlan({
      session,
      payload,
      registrationId: plan.id,
      now: plan.createdAt
    });
  } catch (error) {
    if (error instanceof ExternalConnectorRegistrationError) {
      const code =
        error.code === "forbidden"
          ? "forbidden"
          : error.code === "not_found"
            ? "cross_scope"
            : "invalid_payload";
      return repositoryError(code, error.message);
    }

    throw error;
  }
}

function connectorValues(
  plan: ExternalConnectorRegistrationPlan
): typeof externalConnectors.$inferInsert {
  return {
    id: plan.id,
    organizationId: plan.organizationId,
    connectorType: plan.connectorType,
    accountReference: plan.accountReference,
    credentialReference: plan.credentialReference,
    scopeKind: plan.sourceScope.kind,
    scopeExternalId: plan.sourceScope.externalId,
    capabilities: [...plan.capabilities],
    permissionMode: plan.permissionMode,
    citationRequired: plan.citationRequired,
    displayName: plan.configuration.displayName,
    syncStrategy: plan.configuration.syncStrategy,
    cursorReference: plan.configuration.cursorReference ?? null,
    status: "configured",
    createdBy: plan.auditIntent.actorUserId,
    createdAt: plan.createdAt,
    updatedAt: plan.createdAt
  };
}

function sameConfiguration(
  connector: PersistedExternalConnector,
  plan: ExternalConnectorRegistrationPlan
): boolean {
  return (
    connector.organizationId === plan.organizationId &&
    connector.connectorType === plan.connectorType &&
    connector.accountReference === plan.accountReference &&
    connector.credentialReference === plan.credentialReference &&
    connector.scopeKind === plan.sourceScope.kind &&
    connector.scopeExternalId === plan.sourceScope.externalId &&
    connector.capabilities.length === plan.capabilities.length &&
    connector.capabilities.every(
      (capability, index) => capability === plan.capabilities[index]
    ) &&
    connector.permissionMode === "source_acl" &&
    connector.citationRequired === true &&
    connector.displayName === plan.configuration.displayName &&
    connector.syncStrategy === plan.configuration.syncStrategy &&
    connector.cursorReference ===
      (plan.configuration.cursorReference ?? null) &&
    connector.status === "configured"
  );
}

function createPersistenceAuditEvent(input: {
  session: AuthSession;
  connector: PersistedExternalConnector;
  mode: ExternalConnectorPersistenceMode;
}): typeof auditEvents.$inferInsert {
  return {
    organizationId: input.session.organizationId,
    actorUserId: input.session.userId,
    action:
      input.mode === "created"
        ? "connector.configuration_created"
        : "connector.configuration_existing",
    resourceType: "organization",
    resourceId: input.session.organizationId,
    metadata: {
      connectorId: input.connector.id,
      connectorType: input.connector.connectorType,
      scopeKind: input.connector.scopeKind,
      capabilities: input.connector.capabilities,
      permissionMode: "source_acl",
      citationRequired: true,
      status: input.connector.status,
      persistenceMode: input.mode,
      credentialExposure: "reference_only",
      sourceContentExposure: "not_exposed",
      oauth: "not_performed",
      networkAccess: "not_performed",
      ingestion: "not_performed",
      syncExecution: "not_performed"
    }
  };
}

function parseLimit(value: number | undefined): number {
  const limit = value ?? 50;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return repositoryError(
      "invalid_payload",
      "External connector list limit must be between 1 and 100."
    );
  }

  return limit;
}

export async function persistExternalConnector(
  db: Database,
  input: {
    session: AuthSession;
    plan: ExternalConnectorRegistrationPlan;
  }
): Promise<ExternalConnectorPersistenceResult> {
  const plan = normalizePlan(input.session, input.plan);

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(externalConnectors)
      .values(connectorValues(plan))
      .onConflictDoNothing({
        target: [
          externalConnectors.organizationId,
          externalConnectors.connectorType,
          externalConnectors.accountReference,
          externalConnectors.scopeKind,
          externalConnectors.scopeExternalId
        ]
      })
      .returning(connectorSelection);
    const mode: ExternalConnectorPersistenceMode = inserted
      ? "created"
      : "existing";
    const connector =
      inserted ??
      (
        await tx
          .select(connectorSelection)
          .from(externalConnectors)
          .where(
            and(
              eq(externalConnectors.organizationId, plan.organizationId),
              eq(externalConnectors.connectorType, plan.connectorType),
              eq(externalConnectors.accountReference, plan.accountReference),
              eq(externalConnectors.scopeKind, plan.sourceScope.kind),
              eq(externalConnectors.scopeExternalId, plan.sourceScope.externalId)
            )
          )
          .limit(1)
      )[0];

    if (!connector) {
      return repositoryError(
        "invalid_state",
        "External connector persistence state could not be resolved."
      );
    }

    if (!sameConfiguration(connector, plan)) {
      return repositoryError(
        "invalid_state",
        "External connector scope already has different configuration."
      );
    }

    const auditEvent = createPersistenceAuditEvent({
      session: input.session,
      connector,
      mode
    });
    await tx.insert(auditEvents).values(auditEvent);

    return { mode, connector, auditEvent };
  });
}

export async function listOrganizationExternalConnectors(
  db: Database,
  input: {
    session: AuthSession;
    limit?: number;
  }
): Promise<PersistedExternalConnector[]> {
  if (input.session.role !== "owner" && input.session.role !== "admin") {
    return repositoryError(
      "forbidden",
      "Only owner or admin members can list external connectors."
    );
  }

  const limit = parseLimit(input.limit);

  return db
    .select(connectorSelection)
    .from(externalConnectors)
    .where(eq(externalConnectors.organizationId, input.session.organizationId))
    .orderBy(desc(externalConnectors.createdAt), desc(externalConnectors.id))
    .limit(limit);
}

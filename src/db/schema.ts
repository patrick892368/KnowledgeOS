import { relations, sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  varchar
} from "drizzle-orm/pg-core";

import {
  databaseTableNames,
  documentStatuses,
  embeddingDimensions,
  invitationDeliveryAttemptStatuses,
  invitationStatuses,
  kpiTelemetryCategories,
  kpiTelemetrySources,
  kpiTelemetryUnits,
  membershipRoles,
  permissionActions,
  permissionResourceTypes,
  permissionSubjectTypes,
  sourceStatuses,
  sourceTypes,
  workflowRunStatuses,
  workflowStatuses
} from "./model";

type JsonObject = Record<string, unknown>;

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
};

const knowledgeos = pgSchema("knowledgeos");

export const membershipRoleEnum = knowledgeos.enum(
  "membership_role",
  membershipRoles
);
export const invitationStatusEnum = knowledgeos.enum(
  "invitation_status",
  invitationStatuses
);
export const invitationDeliveryAttemptStatusEnum = knowledgeos.enum(
  "invitation_delivery_attempt_status",
  invitationDeliveryAttemptStatuses
);
export const sourceTypeEnum = knowledgeos.enum("source_type", sourceTypes);
export const sourceStatusEnum = knowledgeos.enum(
  "source_status",
  sourceStatuses
);
export const documentStatusEnum = knowledgeos.enum(
  "document_status",
  documentStatuses
);
export const permissionSubjectTypeEnum = knowledgeos.enum(
  "permission_subject_type",
  permissionSubjectTypes
);
export const permissionResourceTypeEnum = knowledgeos.enum(
  "permission_resource_type",
  permissionResourceTypes
);
export const permissionActionEnum = knowledgeos.enum(
  "permission_action",
  permissionActions
);
export const workflowStatusEnum = knowledgeos.enum(
  "workflow_status",
  workflowStatuses
);
export const workflowRunStatusEnum = knowledgeos.enum(
  "workflow_run_status",
  workflowRunStatuses
);
export const kpiTelemetryCategoryEnum = knowledgeos.enum(
  "kpi_telemetry_category",
  kpiTelemetryCategories
);
export const kpiTelemetryUnitEnum = knowledgeos.enum(
  "kpi_telemetry_unit",
  kpiTelemetryUnits
);
export const kpiTelemetrySourceEnum = knowledgeos.enum(
  "kpi_telemetry_source",
  kpiTelemetrySources
);

export const organizations = knowledgeos.table("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
  ...timestamps
});

export const users = knowledgeos.table("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
  ...timestamps
});

export const memberships = knowledgeos.table(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("memberships_org_user_uidx").on(
      table.organizationId,
      table.userId
    ),
    index("memberships_user_idx").on(table.userId)
  ]
);

export const invitations = knowledgeos.table(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: membershipRoleEnum("role").notNull(),
    status: invitationStatusEnum("status").default("pending").notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null"
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("invitations_org_email_pending_uidx")
      .on(
        table.organizationId,
        table.email
      )
      .where(sql`${table.status} = 'pending'`),
    index("invitations_org_status_idx").on(table.organizationId, table.status),
    check("invitations_email_not_empty", sql`${table.email} <> ''`),
    check("invitations_token_hash_not_empty", sql`${table.tokenHash} <> ''`)
  ]
);

export const invitationDeliveryAttempts = knowledgeos.table(
  "invitation_delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 64 }).notNull(),
    status: invitationDeliveryAttemptStatusEnum("status")
      .default("prepared")
      .notNull(),
    providerMessageId: varchar("provider_message_id", { length: 256 }),
    failureCode: varchar("failure_code", { length: 80 }),
    deliveryExpiresAt: timestamp("delivery_expires_at", {
      withTimezone: true
    }).notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    providerAcceptedAt: timestamp("provider_accepted_at", {
      withTimezone: true
    }),
    providerFailedAt: timestamp("provider_failed_at", {
      withTimezone: true
    }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null"
    }),
    ...timestamps
  },
  (table) => [
    index("invitation_delivery_attempts_org_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt
    ),
    index("invitation_delivery_attempts_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("invitation_delivery_attempts_invitation_created_idx").on(
      table.invitationId,
      table.createdAt
    ),
    uniqueIndex("invitation_delivery_attempts_provider_message_uidx")
      .on(table.provider, table.providerMessageId)
      .where(sql`${table.providerMessageId} is not null`),
    check(
      "invitation_delivery_attempts_provider_not_empty",
      sql`${table.provider} <> ''`
    ),
    check(
      "invitation_delivery_attempts_message_not_empty",
      sql`${table.providerMessageId} is null or ${table.providerMessageId} <> ''`
    ),
    check(
      "invitation_delivery_attempts_failure_not_empty",
      sql`${table.failureCode} is null or ${table.failureCode} <> ''`
    ),
    check(
      "invitation_delivery_attempts_expiry_after_prepared",
      sql`${table.deliveryExpiresAt} > ${table.preparedAt}`
    ),
    check(
      "invitation_delivery_attempts_state_fields",
      sql`(
        (${table.status} = 'prepared' and ${table.providerMessageId} is null and ${table.failureCode} is null and ${table.providerAcceptedAt} is null and ${table.providerFailedAt} is null)
        or
        (${table.status} = 'accepted_by_provider' and ${table.providerMessageId} is not null and ${table.failureCode} is null and ${table.providerAcceptedAt} is not null and ${table.providerFailedAt} is null)
        or
        (${table.status} = 'provider_failed' and ${table.providerMessageId} is null and ${table.failureCode} is not null and ${table.providerAcceptedAt} is null and ${table.providerFailedAt} is not null)
      )`
    )
  ]
);

export const sources = knowledgeos.table(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: sourceTypeEnum("type").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    status: sourceStatusEnum("status").default("pending").notNull(),
    uri: text("uri"),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null"
    }),
    ...timestamps
  },
  (table) => [
    index("sources_org_status_idx").on(table.organizationId, table.status),
    index("sources_created_by_idx").on(table.createdBy)
  ]
);

export const documents = knowledgeos.table(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 320 }).notNull(),
    uri: text("uri"),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    status: documentStatusEnum("status").default("pending").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex("documents_source_hash_uidx").on(
      table.sourceId,
      table.contentHash
    ),
    index("documents_org_status_idx").on(table.organizationId, table.status)
  ]
);

export const chunks = knowledgeos.table(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    uniqueIndex("chunks_document_index_uidx").on(
      table.documentId,
      table.chunkIndex
    ),
    index("chunks_org_document_idx").on(table.organizationId, table.documentId),
    check("chunks_chunk_index_nonnegative", sql`${table.chunkIndex} >= 0`),
    check("chunks_token_count_positive", sql`${table.tokenCount} > 0`)
  ]
);

export const embeddings = knowledgeos.table(
  "embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    model: varchar("model", { length: 160 }).notNull(),
    dimensions: integer("dimensions").default(embeddingDimensions).notNull(),
    embedding: vector("embedding", { dimensions: embeddingDimensions }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    uniqueIndex("embeddings_chunk_model_uidx").on(table.chunkId, table.model),
    index("embeddings_org_idx").on(table.organizationId),
    index("embeddings_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    check(
      "embeddings_dimensions_match",
      sql`${table.dimensions} = ${sql.raw(String(embeddingDimensions))}`
    )
  ]
);

export const permissionGrants = knowledgeos.table(
  "permission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectType: permissionSubjectTypeEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    resourceType: permissionResourceTypeEnum("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: permissionActionEnum("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    uniqueIndex("permission_grants_subject_resource_action_uidx").on(
      table.organizationId,
      table.subjectType,
      table.subjectId,
      table.resourceType,
      table.resourceId,
      table.action
    ),
    index("permission_grants_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId
    ),
    check("permission_grants_subject_id_not_empty", sql`${table.subjectId} <> ''`),
    check("permission_grants_resource_id_not_empty", sql`${table.resourceId} <> ''`)
  ]
);

export const citations = knowledgeos.table(
  "citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").references(() => chunks.id, {
      onDelete: "set null"
    }),
    label: varchar("label", { length: 120 }).notNull(),
    uri: text("uri"),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("citations_org_document_idx").on(
      table.organizationId,
      table.documentId
    ),
    index("citations_chunk_idx").on(table.chunkId)
  ]
);

export const workflows = knowledgeos.table(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    status: workflowStatusEnum("status").default("draft").notNull(),
    definition: jsonb("definition").$type<JsonObject>().default({}).notNull(),
    ...timestamps
  },
  (table) => [
    index("workflows_org_status_idx").on(table.organizationId, table.status)
  ]
);

export const workflowRuns = knowledgeos.table(
  "workflow_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: workflowRunStatusEnum("status").default("queued").notNull(),
    input: jsonb("input").$type<JsonObject>().default({}).notNull(),
    output: jsonb("output").$type<JsonObject>(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null"
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("workflow_runs_org_status_idx").on(
      table.organizationId,
      table.status
    ),
    index("workflow_runs_workflow_idx").on(table.workflowId),
    index("workflow_runs_created_by_idx").on(table.createdBy)
  ]
);

export const auditEvents = knowledgeos.table(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    action: varchar("action", { length: 160 }).notNull(),
    resourceType: permissionResourceTypeEnum("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("audit_events_org_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("audit_events_actor_idx").on(table.actorUserId),
    check("audit_events_resource_id_not_empty", sql`${table.resourceId} <> ''`)
  ]
);

export const kpiTelemetryEvents = knowledgeos.table(
  "kpi_telemetry_events",
  {
    id: varchar("id", { length: 160 }).primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    metricName: varchar("metric_name", { length: 120 }).notNull(),
    category: kpiTelemetryCategoryEnum("category").notNull(),
    value: doublePrecision("value").notNull(),
    unit: kpiTelemetryUnitEnum("unit").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    source: kpiTelemetrySourceEnum("source").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("kpi_telemetry_events_org_captured_idx").on(
      table.organizationId,
      table.capturedAt
    ),
    index("kpi_telemetry_events_org_category_idx").on(
      table.organizationId,
      table.category
    ),
    check("kpi_telemetry_metric_name_not_empty", sql`${table.metricName} <> ''`),
    check("kpi_telemetry_id_not_empty", sql`${table.id} <> ''`)
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
  invitationDeliveryAttempts: many(invitationDeliveryAttempts),
  sources: many(sources),
  documents: many(documents),
  workflows: many(workflows),
  workflowRuns: many(workflowRuns),
  auditEvents: many(auditEvents),
  kpiTelemetryEvents: many(kpiTelemetryEvents)
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
  invitationDeliveryAttempts: many(invitationDeliveryAttempts),
  createdSources: many(sources),
  workflowRuns: many(workflowRuns),
  auditEvents: many(auditEvents)
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id]
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id]
  })
}));

export const invitationsRelations = relations(invitations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id]
  }),
  inviter: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id]
  }),
  deliveryAttempts: many(invitationDeliveryAttempts)
}));

export const invitationDeliveryAttemptsRelations = relations(
  invitationDeliveryAttempts,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [invitationDeliveryAttempts.organizationId],
      references: [organizations.id]
    }),
    invitation: one(invitations, {
      fields: [invitationDeliveryAttempts.invitationId],
      references: [invitations.id]
    }),
    creator: one(users, {
      fields: [invitationDeliveryAttempts.createdBy],
      references: [users.id]
    })
  })
);

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sources.organizationId],
    references: [organizations.id]
  }),
  creator: one(users, {
    fields: [sources.createdBy],
    references: [users.id]
  }),
  documents: many(documents)
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id]
  }),
  source: one(sources, {
    fields: [documents.sourceId],
    references: [sources.id]
  }),
  chunks: many(chunks),
  citations: many(citations)
}));

export const chunksRelations = relations(chunks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [chunks.organizationId],
    references: [organizations.id]
  }),
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id]
  }),
  embeddings: many(embeddings),
  citations: many(citations)
}));

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  organization: one(organizations, {
    fields: [embeddings.organizationId],
    references: [organizations.id]
  }),
  chunk: one(chunks, {
    fields: [embeddings.chunkId],
    references: [chunks.id]
  })
}));

export const citationsRelations = relations(citations, ({ one }) => ({
  organization: one(organizations, {
    fields: [citations.organizationId],
    references: [organizations.id]
  }),
  document: one(documents, {
    fields: [citations.documentId],
    references: [documents.id]
  }),
  chunk: one(chunks, {
    fields: [citations.chunkId],
    references: [chunks.id]
  })
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflows.organizationId],
    references: [organizations.id]
  }),
  runs: many(workflowRuns)
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowRuns.organizationId],
    references: [organizations.id]
  }),
  workflow: one(workflows, {
    fields: [workflowRuns.workflowId],
    references: [workflows.id]
  }),
  creator: one(users, {
    fields: [workflowRuns.createdBy],
    references: [users.id]
  })
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditEvents.organizationId],
    references: [organizations.id]
  }),
  actor: one(users, {
    fields: [auditEvents.actorUserId],
    references: [users.id]
  })
}));

export const kpiTelemetryEventsRelations = relations(
  kpiTelemetryEvents,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [kpiTelemetryEvents.organizationId],
      references: [organizations.id]
    })
  })
);

export const schemaTables = {
  organizations,
  users,
  memberships,
  invitations,
  invitation_delivery_attempts: invitationDeliveryAttempts,
  sources,
  documents,
  chunks,
  embeddings,
  permission_grants: permissionGrants,
  citations,
  workflows,
  workflow_runs: workflowRuns,
  audit_events: auditEvents,
  kpi_telemetry_events: kpiTelemetryEvents
} satisfies Record<(typeof databaseTableNames)[number], unknown>;

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type InvitationDeliveryAttempt =
  typeof invitationDeliveryAttempts.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Embedding = typeof embeddings.$inferSelect;
export type PermissionGrant = typeof permissionGrants.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type KpiTelemetryEventRow = typeof kpiTelemetryEvents.$inferSelect;

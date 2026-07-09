CREATE SCHEMA IF NOT EXISTS "knowledgeos";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE TYPE "knowledgeos"."document_status" AS ENUM('pending', 'indexed', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "knowledgeos"."membership_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "knowledgeos"."permission_action" AS ENUM('read', 'write', 'admin');--> statement-breakpoint
CREATE TYPE "knowledgeos"."permission_resource_type" AS ENUM('organization', 'source', 'document', 'workflow');--> statement-breakpoint
CREATE TYPE "knowledgeos"."permission_subject_type" AS ENUM('user', 'membership', 'role');--> statement-breakpoint
CREATE TYPE "knowledgeos"."source_status" AS ENUM('pending', 'indexing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "knowledgeos"."source_type" AS ENUM('document', 'url', 'repository', 'note', 'integration');--> statement-breakpoint
CREATE TYPE "knowledgeos"."workflow_run_status" AS ENUM('queued', 'running', 'needs_review', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "knowledgeos"."workflow_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "knowledgeos"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(160) NOT NULL,
	"resource_type" "knowledgeos"."permission_resource_type" NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_resource_id_not_empty" CHECK ("knowledgeos"."audit_events"."resource_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_chunk_index_nonnegative" CHECK ("knowledgeos"."chunks"."chunk_index" >= 0),
	CONSTRAINT "chunks_token_count_positive" CHECK ("knowledgeos"."chunks"."token_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid,
	"label" varchar(120) NOT NULL,
	"uri" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"title" varchar(320) NOT NULL,
	"uri" text,
	"content_hash" varchar(128) NOT NULL,
	"status" "knowledgeos"."document_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"model" varchar(160) NOT NULL,
	"dimensions" integer DEFAULT 1536 NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_dimensions_match" CHECK ("knowledgeos"."embeddings"."dimensions" = 1536)
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "knowledgeos"."membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" "knowledgeos"."permission_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"resource_type" "knowledgeos"."permission_resource_type" NOT NULL,
	"resource_id" text NOT NULL,
	"action" "knowledgeos"."permission_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_grants_subject_id_not_empty" CHECK ("knowledgeos"."permission_grants"."subject_id" <> ''),
	CONSTRAINT "permission_grants_resource_id_not_empty" CHECK ("knowledgeos"."permission_grants"."resource_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "knowledgeos"."source_type" NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" "knowledgeos"."source_status" DEFAULT 'pending' NOT NULL,
	"uri" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(160) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" "knowledgeos"."workflow_run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledgeos"."workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" "knowledgeos"."workflow_status" DEFAULT 'draft' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledgeos"."audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "knowledgeos"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."chunks" ADD CONSTRAINT "chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "knowledgeos"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."citations" ADD CONSTRAINT "citations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."citations" ADD CONSTRAINT "citations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "knowledgeos"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."citations" ADD CONSTRAINT "citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "knowledgeos"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."documents" ADD CONSTRAINT "documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "knowledgeos"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."embeddings" ADD CONSTRAINT "embeddings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."embeddings" ADD CONSTRAINT "embeddings_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "knowledgeos"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "knowledgeos"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."permission_grants" ADD CONSTRAINT "permission_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."sources" ADD CONSTRAINT "sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."sources" ADD CONSTRAINT "sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "knowledgeos"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "knowledgeos"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "knowledgeos"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "knowledgeos"."audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "knowledgeos"."audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_document_index_uidx" ON "knowledgeos"."chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "chunks_org_document_idx" ON "knowledgeos"."chunks" USING btree ("organization_id","document_id");--> statement-breakpoint
CREATE INDEX "citations_org_document_idx" ON "knowledgeos"."citations" USING btree ("organization_id","document_id");--> statement-breakpoint
CREATE INDEX "citations_chunk_idx" ON "knowledgeos"."citations" USING btree ("chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_source_hash_uidx" ON "knowledgeos"."documents" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "documents_org_status_idx" ON "knowledgeos"."documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_chunk_model_uidx" ON "knowledgeos"."embeddings" USING btree ("chunk_id","model");--> statement-breakpoint
CREATE INDEX "embeddings_org_idx" ON "knowledgeos"."embeddings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "embeddings_embedding_hnsw_idx" ON "knowledgeos"."embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uidx" ON "knowledgeos"."memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "knowledgeos"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grants_subject_resource_action_uidx" ON "knowledgeos"."permission_grants" USING btree ("organization_id","subject_type","subject_id","resource_type","resource_id","action");--> statement-breakpoint
CREATE INDEX "permission_grants_resource_idx" ON "knowledgeos"."permission_grants" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "sources_org_status_idx" ON "knowledgeos"."sources" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sources_created_by_idx" ON "knowledgeos"."sources" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "workflow_runs_org_status_idx" ON "knowledgeos"."workflow_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "knowledgeos"."workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_created_by_idx" ON "knowledgeos"."workflow_runs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "workflows_org_status_idx" ON "knowledgeos"."workflows" USING btree ("organization_id","status");

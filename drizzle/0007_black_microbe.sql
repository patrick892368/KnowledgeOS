CREATE TYPE "knowledgeos"."external_connector_scope_kind" AS ENUM('repository', 'channel', 'folder', 'page');--> statement-breakpoint
CREATE TYPE "knowledgeos"."external_connector_status" AS ENUM('configured', 'disabled');--> statement-breakpoint
CREATE TYPE "knowledgeos"."external_connector_sync_strategy" AS ENUM('full', 'incremental');--> statement-breakpoint
CREATE TYPE "knowledgeos"."external_connector_type" AS ENUM('github', 'slack', 'google_drive', 'notion');--> statement-breakpoint
CREATE TABLE "knowledgeos"."external_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_type" "knowledgeos"."external_connector_type" NOT NULL,
	"account_reference" varchar(128) NOT NULL,
	"credential_reference" varchar(41) NOT NULL,
	"scope_kind" "knowledgeos"."external_connector_scope_kind" NOT NULL,
	"scope_external_id" varchar(201) NOT NULL,
	"capabilities" jsonb NOT NULL,
	"permission_mode" varchar(32) DEFAULT 'source_acl' NOT NULL,
	"citation_required" boolean DEFAULT true NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"sync_strategy" "knowledgeos"."external_connector_sync_strategy" NOT NULL,
	"cursor_reference" varchar(43),
	"status" "knowledgeos"."external_connector_status" DEFAULT 'configured' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_connectors_references_not_empty" CHECK ("knowledgeos"."external_connectors"."account_reference" <> '' and "knowledgeos"."external_connectors"."scope_external_id" <> '' and "knowledgeos"."external_connectors"."display_name" <> ''),
	CONSTRAINT "external_connectors_credential_reference_format" CHECK ("knowledgeos"."external_connectors"."credential_reference" ~* '^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "external_connectors_cursor_reference_format" CHECK ("knowledgeos"."external_connectors"."cursor_reference" is null or "knowledgeos"."external_connectors"."cursor_reference" ~* '^cursor_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "external_connectors_scope_matches_type" CHECK ((
        ("knowledgeos"."external_connectors"."connector_type" = 'github' and "knowledgeos"."external_connectors"."scope_kind" = 'repository')
        or ("knowledgeos"."external_connectors"."connector_type" = 'slack' and "knowledgeos"."external_connectors"."scope_kind" = 'channel')
        or ("knowledgeos"."external_connectors"."connector_type" = 'google_drive' and "knowledgeos"."external_connectors"."scope_kind" = 'folder')
        or ("knowledgeos"."external_connectors"."connector_type" = 'notion' and "knowledgeos"."external_connectors"."scope_kind" = 'page')
      )),
	CONSTRAINT "external_connectors_required_capabilities" CHECK (jsonb_typeof("knowledgeos"."external_connectors"."capabilities") = 'array' and "knowledgeos"."external_connectors"."capabilities" @> '["content_read","permission_sync"]'::jsonb),
	CONSTRAINT "external_connectors_permission_and_citation" CHECK ("knowledgeos"."external_connectors"."permission_mode" = 'source_acl' and "knowledgeos"."external_connectors"."citation_required" = true),
	CONSTRAINT "external_connectors_cursor_requires_incremental" CHECK ("knowledgeos"."external_connectors"."cursor_reference" is null or "knowledgeos"."external_connectors"."sync_strategy" = 'incremental')
);
--> statement-breakpoint
ALTER TABLE "knowledgeos"."external_connectors" ADD CONSTRAINT "external_connectors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."external_connectors" ADD CONSTRAINT "external_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "knowledgeos"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_connectors_scope_uidx" ON "knowledgeos"."external_connectors" USING btree ("organization_id","connector_type","account_reference","scope_kind","scope_external_id");--> statement-breakpoint
CREATE INDEX "external_connectors_org_status_created_idx" ON "knowledgeos"."external_connectors" USING btree ("organization_id","status","created_at");
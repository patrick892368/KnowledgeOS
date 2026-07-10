CREATE TYPE "knowledgeos"."kpi_telemetry_category" AS ENUM('business', 'product', 'ai', 'governance', 'workflow', 'reliability');--> statement-breakpoint
CREATE TYPE "knowledgeos"."kpi_telemetry_source" AS ENUM('local_summary', 'quality_summary', 'governance_summary', 'workflow_plan', 'manual_review');--> statement-breakpoint
CREATE TYPE "knowledgeos"."kpi_telemetry_unit" AS ENUM('count', 'percent', 'ratio', 'milliseconds', 'seconds', 'minutes', 'score');--> statement-breakpoint
CREATE TABLE "knowledgeos"."kpi_telemetry_events" (
	"id" varchar(160) PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"metric_name" varchar(120) NOT NULL,
	"category" "knowledgeos"."kpi_telemetry_category" NOT NULL,
	"value" double precision NOT NULL,
	"unit" "knowledgeos"."kpi_telemetry_unit" NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"source" "knowledgeos"."kpi_telemetry_source" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_telemetry_metric_name_not_empty" CHECK ("knowledgeos"."kpi_telemetry_events"."metric_name" <> ''),
	CONSTRAINT "kpi_telemetry_id_not_empty" CHECK ("knowledgeos"."kpi_telemetry_events"."id" <> '')
);
--> statement-breakpoint
ALTER TABLE "knowledgeos"."kpi_telemetry_events" ADD CONSTRAINT "kpi_telemetry_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_telemetry_events_org_captured_idx" ON "knowledgeos"."kpi_telemetry_events" USING btree ("organization_id","captured_at");--> statement-breakpoint
CREATE INDEX "kpi_telemetry_events_org_category_idx" ON "knowledgeos"."kpi_telemetry_events" USING btree ("organization_id","category");
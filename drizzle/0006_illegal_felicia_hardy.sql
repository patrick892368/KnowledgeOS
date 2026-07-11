CREATE TYPE "knowledgeos"."invitation_provider_evidence_type" AS ENUM('sent_by_provider', 'delivered_to_recipient_server', 'delivery_delayed', 'bounced', 'delivery_failed', 'suppressed', 'complained');--> statement-breakpoint
CREATE TABLE "knowledgeos"."invitation_delivery_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"delivery_attempt_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"provider_event_type" varchar(64) NOT NULL,
	"evidence_type" "knowledgeos"."invitation_provider_evidence_type" NOT NULL,
	"provider_message_id" varchar(256) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_delivery_evidence_provider_not_empty" CHECK ("knowledgeos"."invitation_delivery_evidence"."provider" <> ''),
	CONSTRAINT "invitation_delivery_evidence_event_not_empty" CHECK ("knowledgeos"."invitation_delivery_evidence"."provider_event_id" <> '' and "knowledgeos"."invitation_delivery_evidence"."provider_event_type" <> ''),
	CONSTRAINT "invitation_delivery_evidence_message_not_empty" CHECK ("knowledgeos"."invitation_delivery_evidence"."provider_message_id" <> '')
);
--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitation_delivery_evidence" ADD CONSTRAINT "invitation_delivery_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitation_delivery_evidence" ADD CONSTRAINT "invitation_delivery_evidence_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "knowledgeos"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitation_delivery_evidence" ADD CONSTRAINT "invitation_delivery_evidence_delivery_attempt_id_invitation_delivery_attempts_id_fk" FOREIGN KEY ("delivery_attempt_id") REFERENCES "knowledgeos"."invitation_delivery_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_delivery_evidence_provider_event_uidx" ON "knowledgeos"."invitation_delivery_evidence" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "invitation_delivery_evidence_org_occurred_idx" ON "knowledgeos"."invitation_delivery_evidence" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "invitation_delivery_evidence_attempt_occurred_idx" ON "knowledgeos"."invitation_delivery_evidence" USING btree ("delivery_attempt_id","occurred_at");
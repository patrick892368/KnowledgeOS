CREATE TYPE "knowledgeos"."invitation_delivery_attempt_status" AS ENUM('prepared', 'accepted_by_provider', 'provider_failed');--> statement-breakpoint
CREATE TABLE "knowledgeos"."invitation_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"status" "knowledgeos"."invitation_delivery_attempt_status" DEFAULT 'prepared' NOT NULL,
	"provider_message_id" varchar(256),
	"failure_code" varchar(80),
	"delivery_expires_at" timestamp with time zone NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_accepted_at" timestamp with time zone,
	"provider_failed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_delivery_attempts_provider_not_empty" CHECK ("knowledgeos"."invitation_delivery_attempts"."provider" <> ''),
	CONSTRAINT "invitation_delivery_attempts_message_not_empty" CHECK ("knowledgeos"."invitation_delivery_attempts"."provider_message_id" is null or "knowledgeos"."invitation_delivery_attempts"."provider_message_id" <> ''),
	CONSTRAINT "invitation_delivery_attempts_failure_not_empty" CHECK ("knowledgeos"."invitation_delivery_attempts"."failure_code" is null or "knowledgeos"."invitation_delivery_attempts"."failure_code" <> ''),
	CONSTRAINT "invitation_delivery_attempts_expiry_after_prepared" CHECK ("knowledgeos"."invitation_delivery_attempts"."delivery_expires_at" > "knowledgeos"."invitation_delivery_attempts"."prepared_at"),
	CONSTRAINT "invitation_delivery_attempts_state_fields" CHECK ((
        ("knowledgeos"."invitation_delivery_attempts"."status" = 'prepared' and "knowledgeos"."invitation_delivery_attempts"."provider_message_id" is null and "knowledgeos"."invitation_delivery_attempts"."failure_code" is null and "knowledgeos"."invitation_delivery_attempts"."provider_accepted_at" is null and "knowledgeos"."invitation_delivery_attempts"."provider_failed_at" is null)
        or
        ("knowledgeos"."invitation_delivery_attempts"."status" = 'accepted_by_provider' and "knowledgeos"."invitation_delivery_attempts"."provider_message_id" is not null and "knowledgeos"."invitation_delivery_attempts"."failure_code" is null and "knowledgeos"."invitation_delivery_attempts"."provider_accepted_at" is not null and "knowledgeos"."invitation_delivery_attempts"."provider_failed_at" is null)
        or
        ("knowledgeos"."invitation_delivery_attempts"."status" = 'provider_failed' and "knowledgeos"."invitation_delivery_attempts"."provider_message_id" is null and "knowledgeos"."invitation_delivery_attempts"."failure_code" is not null and "knowledgeos"."invitation_delivery_attempts"."provider_accepted_at" is null and "knowledgeos"."invitation_delivery_attempts"."provider_failed_at" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitation_delivery_attempts" ADD CONSTRAINT "invitation_delivery_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitation_delivery_attempts" ADD CONSTRAINT "invitation_delivery_attempts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "knowledgeos"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitation_delivery_attempts" ADD CONSTRAINT "invitation_delivery_attempts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "knowledgeos"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_delivery_attempts_org_status_created_idx" ON "knowledgeos"."invitation_delivery_attempts" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "invitation_delivery_attempts_invitation_created_idx" ON "knowledgeos"."invitation_delivery_attempts" USING btree ("invitation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_delivery_attempts_provider_message_uidx" ON "knowledgeos"."invitation_delivery_attempts" USING btree ("provider","provider_message_id") WHERE "knowledgeos"."invitation_delivery_attempts"."provider_message_id" is not null;
CREATE TYPE "knowledgeos"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "knowledgeos"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "knowledgeos"."membership_role" NOT NULL,
	"status" "knowledgeos"."invitation_status" DEFAULT 'pending' NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_email_not_empty" CHECK ("knowledgeos"."invitations"."email" <> ''),
	CONSTRAINT "invitations_token_hash_not_empty" CHECK ("knowledgeos"."invitations"."token_hash" <> '')
);
--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "knowledgeos"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledgeos"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "knowledgeos"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_org_email_status_uidx" ON "knowledgeos"."invitations" USING btree ("organization_id","email","status");--> statement-breakpoint
CREATE INDEX "invitations_org_status_idx" ON "knowledgeos"."invitations" USING btree ("organization_id","status");
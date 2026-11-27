CREATE TABLE "instance_provider_config" (
	"provider_key" text PRIMARY KEY NOT NULL,
	"encrypted_payload" text NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'utc') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_group_role_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"group_name" text NOT NULL,
	"role" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT (now() AT TIME ZONE 'utc') NOT NULL,
	"updated_at" timestamp DEFAULT (now() AT TIME ZONE 'utc') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_provider_config" ADD CONSTRAINT "instance_provider_config_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_group_role_mapping" ADD CONSTRAINT "oidc_group_role_mapping_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_group_role_mapping_ws_group_uidx" ON "oidc_group_role_mapping" USING btree ("workspace_id","group_name");--> statement-breakpoint
CREATE INDEX "oidc_group_role_mapping_ws_idx" ON "oidc_group_role_mapping" USING btree ("workspace_id");
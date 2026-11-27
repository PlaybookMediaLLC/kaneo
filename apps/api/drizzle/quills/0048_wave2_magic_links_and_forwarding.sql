CREATE TABLE "quills"."conversation_followers" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"conversation_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"added_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_followers_workspace_id_conversation_id_principal_id_pk" PRIMARY KEY("workspace_id","conversation_id","principal_id")
);
--> statement-breakpoint
ALTER TABLE "quills"."conversation_followers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."request_access_links" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_access_links_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."request_access_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."conversations" ADD COLUMN "forward_parse_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."conversation_followers" ADD CONSTRAINT "conversation_followers_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."conversation_followers" ADD CONSTRAINT "conversation_followers_conversation_id_fkey" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "quills"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."conversation_followers" ADD CONSTRAINT "conversation_followers_principal_id_fkey" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."conversation_followers" ADD CONSTRAINT "conversation_followers_added_by_fkey" FOREIGN KEY ("workspace_id","added_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("added_by_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."request_access_links" ADD CONSTRAINT "request_access_links_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."request_access_links" ADD CONSTRAINT "request_access_links_principal_id_fkey" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_followers_conversation_id_idx" ON "quills"."conversation_followers" USING btree ("workspace_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_followers_principal_id_idx" ON "quills"."conversation_followers" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "conversation_followers_added_by_idx" ON "quills"."conversation_followers" USING btree ("workspace_id","added_by_principal_id") WHERE "quills"."conversation_followers"."added_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "request_access_links_token_hash_idx" ON "quills"."request_access_links" USING btree ("workspace_id","token_hash");--> statement-breakpoint
CREATE INDEX "request_access_links_resource_idx" ON "quills"."request_access_links" USING btree ("workspace_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "request_access_links_principal_idx" ON "quills"."request_access_links" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "request_access_links_expires_at_idx" ON "quills"."request_access_links" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."conversation_followers" AS PERMISSIVE FOR ALL TO public USING ("quills"."conversation_followers"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."conversation_followers"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."request_access_links" AS PERMISSIVE FOR ALL TO public USING ("quills"."request_access_links"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."request_access_links"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."conversation_followers" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."request_access_links" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

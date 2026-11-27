CREATE TABLE "quills"."release_notifications" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"quoted_text" text,
	"post_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_notifications_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."release_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."ticket_posts" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_posts_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."ticket_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."verified_releases" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"external_url" text,
	"commit_sha" text,
	"task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changelog_entry_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_principal_id" uuid,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verified_releases_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."verified_releases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."release_notifications" ADD CONSTRAINT "release_notifications_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."release_notifications" ADD CONSTRAINT "release_notifications_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "quills"."verified_releases"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."release_notifications" ADD CONSTRAINT "release_notifications_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."ticket_posts" ADD CONSTRAINT "ticket_posts_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."ticket_posts" ADD CONSTRAINT "ticket_posts_ticket_fk" FOREIGN KEY ("workspace_id","ticket_id") REFERENCES "quills"."tickets"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."ticket_posts" ADD CONSTRAINT "ticket_posts_post_fk" FOREIGN KEY ("workspace_id","post_id") REFERENCES "quills"."posts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."ticket_posts" ADD CONSTRAINT "ticket_posts_creator_fk" FOREIGN KEY ("workspace_id","created_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("created_by_principal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."verified_releases" ADD CONSTRAINT "verified_releases_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."verified_releases" ADD CONSTRAINT "verified_releases_changelog_fk" FOREIGN KEY ("workspace_id","changelog_entry_id") REFERENCES "quills"."changelog_entries"("workspace_id","id") ON DELETE SET NULL ("changelog_entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."verified_releases" ADD CONSTRAINT "verified_releases_approver_fk" FOREIGN KEY ("workspace_id","approved_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("approved_by_principal_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "release_notifications_ws_release_principal_idx" ON "quills"."release_notifications" USING btree ("workspace_id","release_id","principal_id");--> statement-breakpoint
CREATE INDEX "release_notifications_ws_principal_idx" ON "quills"."release_notifications" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_posts_ws_ticket_post_idx" ON "quills"."ticket_posts" USING btree ("workspace_id","ticket_id","post_id");--> statement-breakpoint
CREATE INDEX "ticket_posts_ws_post_idx" ON "quills"."ticket_posts" USING btree ("workspace_id","post_id");--> statement-breakpoint
CREATE INDEX "ticket_posts_created_by_principal_fk_idx" ON "quills"."ticket_posts" USING btree ("workspace_id","created_by_principal_id") WHERE ("created_by_principal_id" IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "verified_releases_ws_version_idx" ON "quills"."verified_releases" USING btree ("workspace_id","version");--> statement-breakpoint
CREATE INDEX "verified_releases_ws_status_idx" ON "quills"."verified_releases" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "verified_releases_changelog_fk_idx" ON "quills"."verified_releases" USING btree ("workspace_id","changelog_entry_id") WHERE ("changelog_entry_id" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "verified_releases_approved_by_principal_fk_idx" ON "quills"."verified_releases" USING btree ("workspace_id","approved_by_principal_id") WHERE ("approved_by_principal_id" IS NOT NULL);--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."release_notifications" AS PERMISSIVE FOR ALL TO public USING ("quills"."release_notifications"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."release_notifications"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."ticket_posts" AS PERMISSIVE FOR ALL TO public USING ("quills"."ticket_posts"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."ticket_posts"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."verified_releases" AS PERMISSIVE FOR ALL TO public USING ("quills"."verified_releases"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."verified_releases"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."release_notifications" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."ticket_posts" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."verified_releases" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

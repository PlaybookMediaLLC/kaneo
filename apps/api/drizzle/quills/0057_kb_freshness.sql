CREATE TABLE "quills"."kb_article_links" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_links_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."kb_article_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "review_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "stale_details" text;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "stale_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."kb_article_links" ADD CONSTRAINT "kb_article_links_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."kb_article_links" ADD CONSTRAINT "kb_article_links_article_fk" FOREIGN KEY ("workspace_id","article_id") REFERENCES "quills"."kb_articles"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_article_links_ws_article_target_uq" ON "quills"."kb_article_links" USING btree ("workspace_id","article_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "kb_article_links_ws_target_idx" ON "quills"."kb_article_links" USING btree ("workspace_id","target_kind","target_id");--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD CONSTRAINT "kb_articles_owner_id_fk" FOREIGN KEY ("workspace_id","owner_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("owner_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "kb_articles_owner_id_idx" ON "quills"."kb_articles" USING btree ("workspace_id","owner_id") WHERE "quills"."kb_articles"."owner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_articles_stale_flagged_idx" ON "quills"."kb_articles" USING btree ("workspace_id","stale_flagged_at") WHERE "quills"."kb_articles"."stale_flagged_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_articles_review_by_idx" ON "quills"."kb_articles" USING btree ("workspace_id","review_by") WHERE "quills"."kb_articles"."review_by" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."kb_article_links" AS PERMISSIVE FOR ALL TO public USING ("quills"."kb_article_links"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."kb_article_links"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."kb_article_links" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

ALTER TABLE "quills"."files" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."files" ADD COLUMN "comment_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."files" ADD CONSTRAINT "files_workspace_id_post_id_posts_workspace_id_id_fk" FOREIGN KEY ("workspace_id","post_id") REFERENCES "quills"."posts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."files" ADD CONSTRAINT "files_workspace_id_comment_id_post_comments_workspace_id_id_fk" FOREIGN KEY ("workspace_id","comment_id") REFERENCES "quills"."post_comments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_post_id_idx" ON "quills"."files" USING btree ("workspace_id","post_id");--> statement-breakpoint
CREATE INDEX "files_comment_id_idx" ON "quills"."files" USING btree ("workspace_id","comment_id");--> statement-breakpoint
ALTER TABLE "quills"."files" ADD CONSTRAINT "files_one_parent" CHECK (num_nonnulls("quills"."files"."message_id", "quills"."files"."post_id", "quills"."files"."comment_id") <= 1);
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

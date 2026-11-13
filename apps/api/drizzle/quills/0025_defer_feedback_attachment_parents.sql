ALTER TABLE quills.files ALTER CONSTRAINT files_workspace_id_post_id_posts_workspace_id_id_fk DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE quills.files ALTER CONSTRAINT files_workspace_id_comment_id_post_comments_workspace_id_id_fk DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

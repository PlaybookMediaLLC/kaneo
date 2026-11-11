-- Replaces posts_vote_count_idx with posts_workspace_vote_count_idx, which startup builds CONCURRENTLY
-- after the migrations (schema-ops.ts). No row changes. DROP INDEX holds a short ACCESS EXCLUSIVE lock on
-- quills.posts and waits at most lock_timeout (30s). Until the build ends, the votes sort reads the
-- workspace primary key and sorts. An interrupted build finishes on the next startup (completion.test.ts).
-- Rollback: restore the verified backup; the previous application rejects this migration ledger.
DROP INDEX "quills"."posts_vote_count_idx";
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

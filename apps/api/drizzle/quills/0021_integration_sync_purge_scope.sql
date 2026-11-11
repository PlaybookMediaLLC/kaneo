-- The purge triggers (integration_sync_user_delete and the others) read the comment sync operations
-- of every workspace for each deleted row: under a generic plan, the post branch's comment lookup
-- stayed in every source's statement (1.7 s with 40,000 operations). This replaces the function with
-- the same name, owner and grants (CREATE OR REPLACE keeps them; the triggers keep calling it). Each
-- source now runs only its own lookup, scoped to the row's workspace, on the existing
-- integration_sync_source_record_idx (source_type, source_record_id), which reads only that record's
-- operations. The updates set the same values as before.
-- Lock: CREATE OR REPLACE FUNCTION takes no table lock. Rollback: restore the verified backup; the
-- previous application rejects this migration ledger.
CREATE OR REPLACE FUNCTION quills.purge_integration_sync_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE should_purge boolean; targets uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN should_purge := true;
  ELSE
    should_purge := NEW.deleted_at IS NOT NULL;
    IF TG_ARGV[0] = 'post' OR TG_ARGV[0] = 'comment' THEN should_purge := should_purge OR NEW.moderation_state <> 'published'; END IF;
    IF TG_ARGV[0] = 'comment' THEN should_purge := should_purge OR NEW.is_private; END IF;
    IF TG_ARGV[0] = 'message' THEN should_purge := should_purge OR NEW.is_internal; END IF;
    IF TG_ARGV[0] = 'changelog' THEN should_purge := should_purge OR NEW.published_at IS NULL OR NEW.published_at > now(); END IF;
  END IF;
  IF NOT should_purge THEN RETURN NULL; END IF;
  targets := ARRAY(SELECT id FROM quills.integration_sync_operations
    WHERE workspace_id = OLD.workspace_id AND source_type = TG_ARGV[0] AND source_record_id = OLD.id);
  IF TG_ARGV[0] = 'post' THEN
    targets := targets || ARRAY(SELECT o.id FROM quills.post_comments c
      JOIN quills.integration_sync_operations o
        ON o.workspace_id = c.workspace_id AND o.source_type = 'comment' AND o.source_record_id = c.id
      WHERE c.workspace_id = OLD.workspace_id AND c.post_id = OLD.id);
  END IF;
  IF cardinality(targets) = 0 THEN RETURN NULL; END IF;
  UPDATE quills.integration_sync_operations SET
    payload = CASE WHEN kind = 'archive' AND TG_OP <> 'DELETE' THEN payload ELSE NULL END,
    error_code = CASE WHEN kind <> 'archive' AND NOT cancel_requested AND dispatched_at IS NULL
      AND state IN ('queued', 'running', 'retry_wait', 'failed', 'auth_required', 'conflict') THEN 'source_unavailable' ELSE error_code END,
    result = NULL, cancel_requested = CASE WHEN kind = 'archive' THEN cancel_requested ELSE true END,
    state = CASE WHEN state = 'running' OR dispatched_at IS NOT NULL THEN state
      WHEN state IN ('queued', 'retry_wait', 'failed', 'auth_required', 'conflict') AND kind <> 'archive' THEN 'cancelled' ELSE state END,
    finished_at = CASE WHEN state NOT IN ('running') AND dispatched_at IS NULL AND kind <> 'archive' THEN COALESCE(finished_at, now()) ELSE finished_at END,
    updated_at = now(), version = version + 1
  WHERE workspace_id = OLD.workspace_id AND id = ANY(targets);
  UPDATE quills.integration_sync_attempts SET result = NULL
  WHERE workspace_id = OLD.workspace_id AND operation_id = ANY(targets);
  RETURN NULL;
END $$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

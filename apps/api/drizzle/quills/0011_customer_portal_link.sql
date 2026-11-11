-- Decision D1: a portal customer signs in with an existing Kaneo account and has no workspace
-- membership. A customer profile may link to a workspace member (the 0001 rule). A new profile
-- may also link to the one Kaneo account that withQuillsAudience vouches for in this transaction;
-- an update never moves a link to a non-member. Only that trusted entry point sets
-- quills.customer_user_id, from the session, never from request input.
CREATE OR REPLACE FUNCTION quills.check_customer_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.kaneo_user_id IS NOT NULL
    AND (TG_OP <> 'INSERT' OR NEW.kaneo_user_id IS DISTINCT FROM nullif(current_setting('quills.customer_user_id', true), ''))
    AND NOT EXISTS (SELECT 1 FROM public.workspace_member WHERE workspace_id=NEW.workspace_id AND user_id=NEW.kaneo_user_id) THEN
    RAISE EXCEPTION 'Kaneo user is not a member of this workspace' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION quills.check_customer_membership() FROM PUBLIC;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

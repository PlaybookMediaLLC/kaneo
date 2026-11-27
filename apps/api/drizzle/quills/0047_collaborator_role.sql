-- quills:comment_internal (#328): internal notes & @mentions without customer reply access.
-- Stored default member and admin roles whose Quills actions still match the previous default gain
-- comment_internal automatically; viewers, customized defaults and custom roles stay unchanged.
-- Owner is a static role. New workspaces and startup backfill seed the collaborator default role.
DO $$ DECLARE r record; value jsonb; actions text[]; BEGIN
FOR r IN SELECT id,role,permission FROM public.workspace_role WHERE role IN ('member','admin') LOOP
BEGIN value := r.permission::jsonb; EXCEPTION WHEN invalid_text_representation THEN CONTINUE; END;
IF jsonb_typeof(value->'quills') IS DISTINCT FROM 'array' THEN CONTINUE; END IF;
SELECT array_agg(a ORDER BY a) INTO actions FROM jsonb_array_elements_text(value->'quills') a;
IF (r.role='member' AND actions=ARRAY['create','read','update','view_revenue'])
OR (r.role='admin' AND actions=ARRAY['create','delete','manage_settings','read','update','view_revenue']) THEN
UPDATE public.workspace_role SET permission=jsonb_set(value,'{quills}',(value->'quills') || '["comment_internal"]'::jsonb)::text,updated_at=now() WHERE id=r.id;
END IF;
END LOOP; END $$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

CREATE TABLE "quills"."portal_invites" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"email" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"invited_by_principal_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_invites_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "portal_invites_status_check" CHECK ("quills"."portal_invites"."status" IN ('pending','accepted','canceled','expired')),
	CONSTRAINT "portal_invites_token_hashes_check" CHECK (cardinality("quills"."portal_invites"."token_hashes") <= 20)
);
--> statement-breakpoint
ALTER TABLE "quills"."portal_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."settings" ADD COLUMN "widget_hero_key" text;--> statement-breakpoint
ALTER TABLE "quills"."portal_invites" ADD CONSTRAINT "portal_invites_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."portal_invites" ADD CONSTRAINT "portal_invites_workspace_id_invited_by_principal_id_principal_workspace_id_id_fk" FOREIGN KEY ("workspace_id","invited_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("invited_by_principal_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_invites_pending_email_idx" ON "quills"."portal_invites" USING btree ("workspace_id","email") WHERE "quills"."portal_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "portal_invites_email_status_idx" ON "quills"."portal_invites" USING btree ("workspace_id","email","status");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."portal_invites" AS PERMISSIVE FOR ALL TO public USING ("quills"."portal_invites"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."portal_invites"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."portal_invites" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The widget hero image key moves out of widget_config JSON into its own column. The four storage
-- functions below gain the column so the reference probe, the cleanup trigger (through
-- storage_keys), the workspace deletion listing and storage_references all see it.
-- Same signatures, owners and grants; only the settings key list changes.
CREATE OR REPLACE FUNCTION quills.storage_keys(table_name text, record jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT DISTINCT key FROM (
    SELECT record ->> field AS key FROM unnest(CASE table_name
      WHEN 'customer_identity' THEN ARRAY['image_key']
      WHEN 'settings' THEN ARRAY['logo_key','favicon_key','header_logo_key','portal_og_image_key','widget_hero_key']
      WHEN 'principal' THEN ARRAY['avatar_key']
      WHEN 'files' THEN ARRAY['storage_key']
      WHEN 'assistant_documents' THEN ARRAY['storage_key']
      WHEN 'export_runs' THEN ARRAY['s3_key'] ELSE ARRAY[]::text[] END) field
    UNION ALL SELECT record->'meta'->>field FROM unnest(ARRAY['thumbKey','renditionKey']) field WHERE table_name='files'
    UNION ALL SELECT attachment->'preview'->>field
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(record->'attachments')='array' THEN record->'attachments' ELSE '[]'::jsonb END) attachment,
      unnest(ARRAY['thumbKey','renditionKey']) field WHERE table_name='conversation_messages'
  ) keys WHERE key IS NOT NULL AND key <> '';
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.storage_references() RETURNS TABLE(workspace_id text, object_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT t.workspace_id, quills.storage_keys('customer_identity',jsonb_build_object('image_key',t.image_key)) FROM quills.customer_identity t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('settings',jsonb_build_object('logo_key',t.logo_key,'favicon_key',t.favicon_key,'header_logo_key',t.header_logo_key,'portal_og_image_key',t.portal_og_image_key,'widget_hero_key',t.widget_hero_key)) FROM quills.settings t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('principal',jsonb_build_object('avatar_key',t.avatar_key)) FROM quills.principal t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('files',jsonb_build_object('storage_key',t.storage_key,'meta',t.meta)) FROM quills.files t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('assistant_documents',jsonb_build_object('storage_key',t.storage_key)) FROM quills.assistant_documents t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('export_runs',jsonb_build_object('s3_key',t.s3_key)) FROM quills.export_runs t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('conversation_messages',jsonb_build_object('attachments',t.attachments)) FROM quills.conversation_messages t;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.storage_keys_for_workspace(ws text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT key FROM (
 SELECT quills.storage_keys('customer_identity',jsonb_build_object('image_key',image_key)) key FROM quills.customer_identity WHERE workspace_id=ws
 UNION ALL SELECT quills.storage_keys('settings',jsonb_build_object('logo_key',logo_key,'favicon_key',favicon_key,'header_logo_key',header_logo_key,'portal_og_image_key',portal_og_image_key,'widget_hero_key',widget_hero_key)) FROM quills.settings WHERE workspace_id=ws
 UNION ALL SELECT avatar_key FROM quills.principal WHERE workspace_id=ws
 UNION ALL SELECT quills.storage_keys('files',jsonb_build_object('storage_key',storage_key,'meta',meta)) FROM quills.files WHERE workspace_id=ws
 UNION ALL SELECT storage_key FROM quills.assistant_documents WHERE workspace_id=ws
 UNION ALL SELECT s3_key FROM quills.export_runs WHERE workspace_id=ws
 UNION ALL SELECT quills.storage_keys('conversation_messages',jsonb_build_object('attachments',attachments)) FROM quills.conversation_messages WHERE workspace_id=ws
 ) refs WHERE key IS NOT NULL AND key<>'';
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.storage_object_is_referenced(key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
 SELECT 1 FROM quills.customer_identity WHERE image_key=key
 UNION ALL SELECT 1 FROM quills.settings WHERE logo_key=key OR favicon_key=key OR header_logo_key=key OR portal_og_image_key=key OR widget_hero_key=key
 UNION ALL SELECT 1 FROM quills.principal WHERE avatar_key=key
 UNION ALL SELECT 1 FROM quills.files WHERE storage_key=key OR meta->>'thumbKey'=key OR meta->>'renditionKey'=key
 UNION ALL SELECT 1 FROM quills.assistant_documents WHERE storage_key=key
 UNION ALL SELECT 1 FROM quills.export_runs WHERE s3_key=key
 UNION ALL SELECT 1 FROM quills.conversation_messages WHERE attachments @> jsonb_build_array(jsonb_build_object('preview',jsonb_build_object('thumbKey',key))) OR attachments @> jsonb_build_array(jsonb_build_object('preview',jsonb_build_object('renditionKey',key)))
 );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION quills.storage_keys(text,jsonb),quills.storage_references(),quills.storage_keys_for_workspace(text),quills.storage_object_is_referenced(text) FROM PUBLIC;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

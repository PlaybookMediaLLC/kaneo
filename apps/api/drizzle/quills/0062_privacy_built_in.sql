CREATE TABLE "quills"."privacy_requests" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"type" text NOT NULL,
	"mode" text,
	"subject_principal_id" uuid,
	"subject_email_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_principal_id" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"export_s3_key" text,
	"export_file_name" text,
	"export_expires_at" timestamp with time zone,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "privacy_requests_type_check" CHECK ("quills"."privacy_requests"."type" IN ('erasure','access')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("quills"."privacy_requests"."status" IN ('pending','running','completed','failed')),
	CONSTRAINT "privacy_requests_mode_check" CHECK ("quills"."privacy_requests"."mode" IS NULL OR "quills"."privacy_requests"."mode" IN ('delete','anonymize'))
);
--> statement-breakpoint
ALTER TABLE "quills"."privacy_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."retention_policies" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"channel" text NOT NULL,
	"action" text DEFAULT 'delete' NOT NULL,
	"closed_after_days" integer,
	"spam_after_days" integer,
	"soft_deleted_after_days" integer,
	"ai_logs_after_days" integer,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "retention_policies_workspace_channel_unique" UNIQUE("workspace_id","channel"),
	CONSTRAINT "retention_policies_channel_check" CHECK ("quills"."retention_policies"."channel" IN ('all','messenger','email','widget','ticket')),
	CONSTRAINT "retention_policies_action_check" CHECK ("quills"."retention_policies"."action" IN ('delete','anonymize')),
	CONSTRAINT "retention_policies_days_check" CHECK (("quills"."retention_policies"."closed_after_days" IS NULL OR ("quills"."retention_policies"."closed_after_days" >= 1 AND "quills"."retention_policies"."closed_after_days" <= 3650))
          AND ("quills"."retention_policies"."spam_after_days" IS NULL OR ("quills"."retention_policies"."spam_after_days" >= 1 AND "quills"."retention_policies"."spam_after_days" <= 3650))
          AND ("quills"."retention_policies"."soft_deleted_after_days" IS NULL OR ("quills"."retention_policies"."soft_deleted_after_days" >= 1 AND "quills"."retention_policies"."soft_deleted_after_days" <= 3650))
          AND ("quills"."retention_policies"."ai_logs_after_days" IS NULL OR ("quills"."retention_policies"."ai_logs_after_days" >= 1 AND "quills"."retention_policies"."ai_logs_after_days" <= 3650)))
);
--> statement-breakpoint
ALTER TABLE "quills"."retention_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."support_daily_stats" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"day" text NOT NULL,
	"channel" text NOT NULL,
	"conversations_created" integer DEFAULT 0 NOT NULL,
	"conversations_resolved" integer DEFAULT 0 NOT NULL,
	"messages_count" integer DEFAULT 0 NOT NULL,
	"sla_first_response_met" integer DEFAULT 0 NOT NULL,
	"sla_first_response_breached" integer DEFAULT 0 NOT NULL,
	"sla_next_response_met" integer DEFAULT 0 NOT NULL,
	"sla_next_response_breached" integer DEFAULT 0 NOT NULL,
	"sla_resolution_met" integer DEFAULT 0 NOT NULL,
	"sla_resolution_breached" integer DEFAULT 0 NOT NULL,
	"sla_time_to_resolve_met" integer DEFAULT 0 NOT NULL,
	"sla_time_to_resolve_breached" integer DEFAULT 0 NOT NULL,
	"csat_sum" integer DEFAULT 0 NOT NULL,
	"csat_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_daily_stats_workspace_id_day_channel_pk" PRIMARY KEY("workspace_id","day","channel")
);
--> statement-breakpoint
ALTER TABLE "quills"."support_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD COLUMN "redacted_by_principal_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD COLUMN "redaction_reason" text;--> statement-breakpoint
ALTER TABLE "quills"."privacy_requests" ADD CONSTRAINT "privacy_requests_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."privacy_requests" ADD CONSTRAINT "privacy_requests_subject_principal_id_fkey" FOREIGN KEY ("workspace_id","subject_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("subject_principal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."privacy_requests" ADD CONSTRAINT "privacy_requests_requested_by_principal_id_fkey" FOREIGN KEY ("workspace_id","requested_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("requested_by_principal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."retention_policies" ADD CONSTRAINT "retention_policies_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."retention_policies" ADD CONSTRAINT "retention_policies_updated_by_principal_id_fkey" FOREIGN KEY ("workspace_id","updated_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("updated_by_principal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."support_daily_stats" ADD CONSTRAINT "support_daily_stats_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_workspace_created_idx" ON "quills"."privacy_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_workspace_type_status_idx" ON "quills"."privacy_requests" USING btree ("workspace_id","type","status");--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD CONSTRAINT "conversation_messages_redacted_by_principal_id_fkey" FOREIGN KEY ("workspace_id","redacted_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("redacted_by_principal_id") ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."privacy_requests" AS PERMISSIVE FOR ALL TO public USING ("quills"."privacy_requests"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."privacy_requests"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."retention_policies" AS PERMISSIVE FOR ALL TO public USING ("quills"."retention_policies"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."retention_policies"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."support_daily_stats" AS PERMISSIVE FOR ALL TO public USING ("quills"."support_daily_stats"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."support_daily_stats"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."privacy_requests" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."retention_policies" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."support_daily_stats" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- Register privacy_requests.export_s3_key in the shared storage lifecycle so expired/deleted DSAR
-- archives queue cleanup transactionally and workspace deletion includes them.
CREATE OR REPLACE FUNCTION quills.storage_keys(table_name text, record jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT DISTINCT key FROM (
    SELECT record ->> field AS key FROM unnest(CASE table_name
      WHEN 'customer_identity' THEN ARRAY['image_key']
      WHEN 'settings' THEN ARRAY['logo_key','favicon_key','header_logo_key','portal_og_image_key','widget_hero_key']
      WHEN 'principal' THEN ARRAY['avatar_key']
      WHEN 'files' THEN ARRAY['storage_key']
      WHEN 'assistant_documents' THEN ARRAY['storage_key']
      WHEN 'export_runs' THEN ARRAY['s3_key']
      WHEN 'brands' THEN ARRAY['logo_key','dark_logo_key']
      WHEN 'privacy_requests' THEN ARRAY['export_s3_key'] ELSE ARRAY[]::text[] END) field
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
  UNION ALL SELECT t.workspace_id, quills.storage_keys('brands',jsonb_build_object('logo_key',t.logo_key,'dark_logo_key',t.dark_logo_key)) FROM quills.brands t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('privacy_requests',jsonb_build_object('export_s3_key',t.export_s3_key)) FROM quills.privacy_requests t
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
 UNION ALL SELECT quills.storage_keys('brands',jsonb_build_object('logo_key',logo_key,'dark_logo_key',dark_logo_key)) FROM quills.brands WHERE workspace_id=ws
 UNION ALL SELECT export_s3_key FROM quills.privacy_requests WHERE workspace_id=ws
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
 UNION ALL SELECT 1 FROM quills.brands WHERE logo_key=key OR dark_logo_key=key
 UNION ALL SELECT 1 FROM quills.privacy_requests WHERE export_s3_key=key
 UNION ALL SELECT 1 FROM quills.conversation_messages WHERE attachments @> jsonb_build_array(jsonb_build_object('preview',jsonb_build_object('thumbKey',key))) OR attachments @> jsonb_build_array(jsonb_build_object('preview',jsonb_build_object('renditionKey',key)))
 );
$$;
--> statement-breakpoint
CREATE TRIGGER quills_storage_changes BEFORE INSERT OR UPDATE OR DELETE ON quills.privacy_requests FOR EACH ROW EXECUTE FUNCTION quills.track_storage_changes();
--> statement-breakpoint
REVOKE ALL ON FUNCTION quills.storage_keys(text,jsonb),quills.storage_references(),quills.storage_keys_for_workspace(text),quills.storage_object_is_referenced(text) FROM PUBLIC;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

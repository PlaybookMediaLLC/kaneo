CREATE TABLE "quills"."webhook_deliveries" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"response_snippet" text,
	"error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."brands" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"primary_color" text DEFAULT '#4f46e5' NOT NULL,
	"accent_color" text DEFAULT '#111827' NOT NULL,
	"logo_key" text,
	"dark_logo_key" text,
	"from_name" text,
	"from_email" text,
	"reply_to" text,
	"footer_text" text,
	"hide_powered_by" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."email_templates" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"subject" text NOT NULL,
	"mode" text DEFAULT 'blocks' NOT NULL,
	"blocks_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"html_body" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."email_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."custom_domains" DROP CONSTRAINT "custom_domains_kind_check";--> statement-breakpoint
ALTER TABLE "quills"."channel_accounts" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."notification_preferences" ADD COLUMN "digest_frequency" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."notification_preferences" ADD COLUMN "digest_last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."webhooks" ADD COLUMN "last_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."push_devices" ADD COLUMN "token_encrypted" text;--> statement-breakpoint
ALTER TABLE "quills"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_webhook_id_webhooks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","webhook_id") REFERENCES "quills"."webhooks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."brands" ADD CONSTRAINT "brands_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."email_templates" ADD CONSTRAINT "email_templates_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."email_templates" ADD CONSTRAINT "email_templates_brand_id_fkey" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "quills"."brands"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_created_idx" ON "quills"."webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_at_idx" ON "quills"."webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_workspace_slug_idx" ON "quills"."brands" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "email_templates_brand_id_idx" ON "quills"."email_templates" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_brand_key_locale_idx" ON "quills"."email_templates" USING btree ("workspace_id","brand_id","template_key","locale");--> statement-breakpoint
ALTER TABLE "quills"."channel_accounts" ADD CONSTRAINT "channel_accounts_brand_id_fkey" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "quills"."brands"("workspace_id","id") ON DELETE SET NULL ("brand_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "channel_accounts_brand_id_idx" ON "quills"."channel_accounts" USING btree ("brand_id") WHERE brand_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."custom_domains" ADD CONSTRAINT "custom_domains_kind_check" CHECK ("quills"."custom_domains"."kind" IN ('portal', 'help_center', 'widget'));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."webhook_deliveries" AS PERMISSIVE FOR ALL TO public USING ("quills"."webhook_deliveries"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."webhook_deliveries"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."brands" AS PERMISSIVE FOR ALL TO public USING ("quills"."brands"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."brands"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."email_templates" AS PERMISSIVE FOR ALL TO public USING ("quills"."email_templates"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."email_templates"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."webhook_deliveries" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."brands" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."email_templates" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.custom_domain_workspace(host_in text, kind_in text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT d.workspace_id
  FROM quills.custom_domains d
  JOIN public.workspace w ON w.id = d.workspace_id
  WHERE d.domain = lower(trim(trailing '.' from host_in))
    AND d.kind = kind_in
    AND d.verified_at IS NOT NULL
    AND w.archived_at IS NULL
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION quills.custom_domain_workspace(text, text) FROM PUBLIC;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.storage_keys(table_name text, record jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT key FROM (
    SELECT record->>field key FROM unnest(CASE table_name
      WHEN 'customer_identity' THEN ARRAY['image_key']
      WHEN 'settings' THEN ARRAY['logo_key','favicon_key','header_logo_key','portal_og_image_key','widget_hero_key']
      WHEN 'principal' THEN ARRAY['avatar_key']
      WHEN 'files' THEN ARRAY['storage_key']
      WHEN 'assistant_documents' THEN ARRAY['storage_key']
      WHEN 'export_runs' THEN ARRAY['s3_key']
      WHEN 'brands' THEN ARRAY['logo_key','dark_logo_key']
      ELSE ARRAY[]::text[] END) field
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
  UNION ALL SELECT t.workspace_id, quills.storage_keys('conversation_messages',jsonb_build_object('attachments',t.attachments)) FROM quills.conversation_messages t
  UNION ALL SELECT t.workspace_id, quills.storage_keys('brands',jsonb_build_object('logo_key',t.logo_key,'dark_logo_key',t.dark_logo_key)) FROM quills.brands t;
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
 UNION ALL SELECT quills.storage_keys('brands',jsonb_build_object('logo_key',logo_key,'dark_logo_key',dark_logo_key)) FROM quills.brands WHERE workspace_id=ws
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
 UNION ALL SELECT 1 FROM quills.brands WHERE logo_key=key OR dark_logo_key=key
 );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION quills.storage_keys(text,jsonb),quills.storage_references(),quills.storage_keys_for_workspace(text),quills.storage_object_is_referenced(text) FROM PUBLIC;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.webhook_delivery','quills.mail','quills.notification','quills.domain_check','quills.wipe','quills.transfer','quills.workflow','quills.ai') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='snoozed' AND snoozed_until IS NOT NULL AND snoozed_until<=now()
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='open' AND waiting_since IS NOT NULL AND promised_reply_at IS NOT NULL AND breach_update_sent_at IS NULL AND promised_reply_at<=now()
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='open' AND auto_close_at IS NOT NULL AND (auto_close_at<=now() OR (close_reminder_sent_at IS NULL AND auto_close_at<=now()+interval '24 hours'))
  UNION ALL SELECT workspace_id FROM quills.notification_preferences WHERE (digest_frequency='hourly' AND (digest_last_sent_at IS NULL OR digest_last_sent_at<=now()-interval '1 hour')) OR (digest_frequency='daily' AND (digest_last_sent_at IS NULL OR digest_last_sent_at<=now()-interval '24 hours'))
  UNION ALL SELECT workspace_id FROM quills.changelog_entries WHERE notified_at IS NULL AND deleted_at IS NULL AND published_at<=now() AND published_at>now()-interval '1 day'
  UNION ALL SELECT workspace_id FROM quills.status_incidents WHERE kind='maintenance' AND deleted_at IS NULL AND ((status='scheduled' AND auto_start AND scheduled_start_at<=now() AND scheduled_start_at>now()-interval '1 day') OR (status IN ('scheduled','in_progress','verifying') AND auto_complete AND scheduled_end_at<=now()))
  UNION ALL SELECT d.id FROM public.workspace d WHERE EXISTS (SELECT 1 FROM quills.audit_log a WHERE a.workspace_id=d.id AND a.event_type='post.status_changed' AND a.target_type='post' AND a.occurred_at>=(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days') AT TIME ZONE 'UTC' AND a.occurred_at<date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AND NOT EXISTS (SELECT 1 FROM quills.kv_store k WHERE k.workspace_id=d.id AND k.workspace_key='_' AND k.key='digest:'||to_char(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days', 'IYYY-"W"IW') AND k.value->>'done'='true')
  UNION ALL SELECT workspace_id FROM quills.assistant_involvements WHERE status='active' AND last_assistant_answer_at<=now()-interval '24 hours'
  UNION ALL SELECT workspace_id FROM quills.assistant_web_sources WHERE enabled AND fetched_at<=now()-interval '7 days' AND updated_at<=now()-interval '1 day'
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();

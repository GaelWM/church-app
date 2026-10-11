-- Immobilisations (spec "Compta CEPD MBUDI"): the register is rebuilt around account / sous-compte,
-- locations, suppliers and the statut / état split. The previous register only ever held test data and
-- the new NOT NULL columns have no backfill, so it is cleared first.
-- On an existing database FORCE ROW LEVEL SECURITY applies to the owner too (9999c ran before this file),
-- so this transaction is scoped to every parish before deleting; on a fresh database it is a no-op.
select set_config('app.parish_ids', coalesce((select string_agg(id::text, ',') from parishes), ''), true);--> statement-breakpoint
delete from fixed_assets;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_code_prefixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"acronym" text NOT NULL,
	"label" text NOT NULL,
	"subaccount_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acp_acronym_format" CHECK ("asset_code_prefixes"."acronym" ~ '^[A-Z]{2,4}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_condition_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"old_etat" text,
	"new_etat" text NOT NULL,
	"reason" text NOT NULL,
	"observation" text,
	"location_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid,
	"validation_status" text DEFAULT 'non_requis' NOT NULL,
	CONSTRAINT "ach_new_etat" CHECK ("asset_condition_history"."new_etat" in ('bon','mauvais','declasse','perdu')),
	CONSTRAINT "ach_reason" CHECK (length(trim("asset_condition_history"."reason")) > 0),
	CONSTRAINT "ach_observation" CHECK ("asset_condition_history"."new_etat" = 'bon' or length(trim(coalesce("asset_condition_history"."observation", ''))) > 0),
	CONSTRAINT "ach_validation" CHECK ("asset_condition_history"."validation_status" in ('non_requis','approuve'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"comment" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"proposed_changes" jsonb,
	"old_values" jsonb,
	"status" text DEFAULT 'en_attente_tresorier' NOT NULL,
	"n1_skipped" boolean DEFAULT false NOT NULL,
	"n2_skipped" boolean DEFAULT false NOT NULL,
	"requester_id" uuid NOT NULL,
	"tresorier_id" uuid,
	"tresorier_at" timestamp with time zone,
	"pasteur_id" uuid,
	"pasteur_at" timestamp with time zone,
	"rejected_reason" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_requests_reference_unique" UNIQUE("reference"),
	CONSTRAINT "ar_kind" CHECK ("asset_requests"."kind" in ('creation','modification','annulation','changement_etat'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "fa_parish_type";--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "acronym" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "account_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "subaccount_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "description" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "in_service_date" date;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "location_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "fx_rate_per_usd" text;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "fx_rate_date" date;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "pa_minor" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "faa_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "cost_minor" bigint GENERATED ALWAYS AS (pa_minor + faa_minor) STORED;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "degressive_coefficient" text;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "statut" text DEFAULT 'brouillon' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "etat" text DEFAULT 'bon' NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN "observations" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_code_prefixes" ADD CONSTRAINT "asset_code_prefixes_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_location_id_asset_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."asset_locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_condition_history" ADD CONSTRAINT "asset_condition_history_request_id_asset_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."asset_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_locations" ADD CONSTRAINT "asset_locations_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_request_events" ADD CONSTRAINT "asset_request_events_request_id_asset_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."asset_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_request_events" ADD CONSTRAINT "asset_request_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_tresorier_id_users_id_fk" FOREIGN KEY ("tresorier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_pasteur_id_users_id_fk" FOREIGN KEY ("pasteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_suppliers" ADD CONSTRAINT "asset_suppliers_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acp_parish_acronym" ON "asset_code_prefixes" USING btree ("parish_id","acronym");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ach_asset" ON "asset_condition_history" USING btree ("asset_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "al_parish_name" ON "asset_locations" USING btree ("parish_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ar_parish_status" ON "asset_requests" USING btree ("parish_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ar_asset" ON "asset_requests" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ar_one_open" ON "asset_requests" USING btree ("asset_id") WHERE "asset_requests"."status" in ('en_attente_tresorier','approuvee_n1');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asu_parish_name" ON "asset_suppliers" USING btree ("parish_id",lower("name"));--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_id_asset_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."asset_suppliers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_location_id_asset_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."asset_locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fa_parish_account" ON "fixed_assets" USING btree ("parish_id","account_code","subaccount_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fa_parish_location" ON "fixed_assets" USING btree ("parish_id","location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fa_parish_supplier" ON "fixed_assets" USING btree ("parish_id","supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fa_parish_acquisition" ON "fixed_assets" USING btree ("parish_id","acquisition_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fa_parish_statut" ON "fixed_assets" USING btree ("parish_id","statut");--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP COLUMN IF EXISTS "type";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP COLUMN IF EXISTS "name";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP COLUMN IF EXISTS "amount_minor";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP COLUMN IF EXISTS "condition";--> statement-breakpoint
ALTER TABLE "fixed_assets" DROP COLUMN IF EXISTS "location";--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_pa_positive" CHECK ("fixed_assets"."pa_minor" > 0);--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_faa_not_negative" CHECK ("fixed_assets"."faa_minor" >= 0);--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_currency" CHECK ("fixed_assets"."currency" in ('USD','CDF','EUR'));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_method" CHECK ("fixed_assets"."depreciation_method" in ('lineaire','degressif','non_amortissable'));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_method_years" CHECK (("fixed_assets"."depreciation_method" = 'non_amortissable') = ("fixed_assets"."useful_life_years" is null));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_subaccount_of_account" CHECK ("fixed_assets"."subaccount_code" like "fixed_assets"."account_code" || '.%');--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_no_fx_for_usd" CHECK ("fixed_assets"."currency" <> 'USD' or "fixed_assets"."fx_rate_per_usd" is null);--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_statut" CHECK ("fixed_assets"."statut" in ('brouillon','en_attente_validation','actif','cede','mis_au_rebut','transfere','annule'));--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fa_etat" CHECK ("fixed_assets"."etat" in ('bon','mauvais','declasse','perdu'));
CREATE TABLE IF NOT EXISTS "asset_inventories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"location_id" uuid,
	"status" text DEFAULT 'en_cours' NOT NULL,
	"started_on" date NOT NULL,
	"observations" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "ainv_status" CHECK ("asset_inventories"."status" in ('en_cours','cloture'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_inventory_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"asset_id" uuid,
	"expected_code" text,
	"expected_description" text,
	"expected_location_id" uuid,
	"expected_etat" text,
	"present" boolean,
	"found_location_id" uuid,
	"found_etat" text,
	"responsible" text,
	"observation" text,
	"extra_description" text,
	"checked_at" timestamp with time zone,
	"checked_by" uuid,
	CONSTRAINT "ainvl_found_etat" CHECK ("asset_inventory_lines"."found_etat" is null or "asset_inventory_lines"."found_etat" in ('bon','mauvais','declasse','perdu')),
	CONSTRAINT "ainvl_expected_etat" CHECK ("asset_inventory_lines"."expected_etat" is null or "asset_inventory_lines"."expected_etat" in ('bon','mauvais','declasse','perdu'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventories" ADD CONSTRAINT "asset_inventories_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventories" ADD CONSTRAINT "asset_inventories_location_id_asset_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."asset_locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventories" ADD CONSTRAINT "asset_inventories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventories" ADD CONSTRAINT "asset_inventories_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_inventory_id_asset_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."asset_inventories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_expected_location_id_asset_locations_id_fk" FOREIGN KEY ("expected_location_id") REFERENCES "public"."asset_locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_found_location_id_asset_locations_id_fk" FOREIGN KEY ("found_location_id") REFERENCES "public"."asset_locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_inventory_lines" ADD CONSTRAINT "asset_inventory_lines_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ainv_reference" ON "asset_inventories" USING btree ("reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ainv_parish" ON "asset_inventories" USING btree ("parish_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ainvl_inventory" ON "asset_inventory_lines" USING btree ("inventory_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ainvl_asset" ON "asset_inventory_lines" USING btree ("inventory_id","asset_id") WHERE "asset_inventory_lines"."asset_id" is not null;
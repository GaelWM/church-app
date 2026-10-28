ALTER TABLE "attendance_records" ADD COLUMN "validator1_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "validator1_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "validator2_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "validator2_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
-- Hand-edited: rows registered before the validation circuit are kept as validated; new rows start as drafts.
ALTER TABLE "baptisms" ADD COLUMN "status" text DEFAULT 'validee' NOT NULL;--> statement-breakpoint
ALTER TABLE "baptisms" ALTER COLUMN "status" SET DEFAULT 'brouillon';--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "n1_skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "n2_skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "validator1_id" uuid;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "validator1_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "validator2_id" uuid;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "validator2_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "baptisms" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
-- Hand-edited: rows registered before the validation circuit are kept as validated; new rows start as drafts.
ALTER TABLE "marriages" ADD COLUMN "status" text DEFAULT 'validee' NOT NULL;--> statement-breakpoint
ALTER TABLE "marriages" ALTER COLUMN "status" SET DEFAULT 'brouillon';--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "n1_skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "n2_skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "validator1_id" uuid;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "validator1_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "validator2_id" uuid;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "validator2_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_validator1_id_users_id_fk" FOREIGN KEY ("validator1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_validator2_id_users_id_fk" FOREIGN KEY ("validator2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "baptisms" ADD CONSTRAINT "baptisms_validator1_id_users_id_fk" FOREIGN KEY ("validator1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "baptisms" ADD CONSTRAINT "baptisms_validator2_id_users_id_fk" FOREIGN KEY ("validator2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "marriages" ADD CONSTRAINT "marriages_validator1_id_users_id_fk" FOREIGN KEY ("validator1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "marriages" ADD CONSTRAINT "marriages_validator2_id_users_id_fk" FOREIGN KEY ("validator2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bap_parish_status" ON "baptisms" USING btree ("parish_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mar_parish_status" ON "marriages" USING btree ("parish_id","status");--> statement-breakpoint
ALTER TABLE "baptisms" ADD CONSTRAINT "bap_status" CHECK ("baptisms"."status" in ('brouillon','soumise','validee1','validee','rejetee'));--> statement-breakpoint
ALTER TABLE "marriages" ADD CONSTRAINT "mar_status" CHECK ("marriages"."status" in ('brouillon','soumise','validee1','validee','rejetee'));
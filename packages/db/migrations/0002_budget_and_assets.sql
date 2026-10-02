CREATE TABLE IF NOT EXISTS "budget_expense_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"category_id" uuid NOT NULL,
	"period" text DEFAULT 'annuel' NOT NULL,
	"period_index" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"observation" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'autre' NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"observation" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"code" text NOT NULL,
	"registered_at" date DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"acquisition_date" date NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"invoice_number" text,
	"useful_life_years" integer,
	"depreciation_method" text DEFAULT 'lineaire' NOT NULL,
	"condition" text,
	"location" text,
	"transaction_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "newcomers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parish_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"address" text,
	"whatsapp" text,
	"email" text,
	"home_church" text,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "godfather_name" text;--> statement-breakpoint
ALTER TABLE "marriages" ADD COLUMN "godmother_name" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "member_since" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "investment_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expense_lines" ADD CONSTRAINT "budget_expense_lines_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expense_lines" ADD CONSTRAINT "budget_expense_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_expense_lines" ADD CONSTRAINT "budget_expense_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_investments" ADD CONSTRAINT "budget_investments_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_investments" ADD CONSTRAINT "budget_investments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "newcomers" ADD CONSTRAINT "newcomers_parish_id_parishes_id_fk" FOREIGN KEY ("parish_id") REFERENCES "public"."parishes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bel_unique" ON "budget_expense_lines" USING btree ("parish_id","year","category_id","currency","period","period_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bel_parish_year" ON "budget_expense_lines" USING btree ("parish_id","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "binv_parish_year" ON "budget_investments" USING btree ("parish_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fa_parish_code" ON "fixed_assets" USING btree ("parish_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fa_parish_type" ON "fixed_assets" USING btree ("parish_id","type");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investment_id_budget_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."budget_investments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_investment" ON "transactions" USING btree ("investment_id");
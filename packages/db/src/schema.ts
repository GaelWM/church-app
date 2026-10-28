import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "bigint" });

export const parishes = pgTable("parishes", {
  id: id(), name: text("name").notNull(), code: text("code").notNull().unique(),
  city: text("city"), active: boolean("active").notNull().default(true), createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(), auth0Id: text("auth0_id").notNull().unique(), email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(), active: boolean("active").notNull().default(true), createdAt: createdAt(),
});

export const userParishRoles = pgTable("user_parish_roles", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  parishId: uuid("parish_id").notNull().references(() => parishes.id),
  role: text("role").notNull(),
  consolidatedAccess: boolean("consolidated_access").notNull().default(false),
}, (t) => [uniqueIndex("upr_unique").on(t.userId, t.parishId, t.role)]);

export const funds = pgTable("funds", {
  id: id(), name: text("name").notNull().unique(), description: text("description"),
});

export const categories = pgTable("categories", {
  id: id(), kind: text("kind").notNull(), name: text("name").notNull(), group: text("group"),
  fundId: uuid("fund_id").references(() => funds.id), requiresDepartment: boolean("requires_department").notNull().default(false),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("cat_kind_name").on(t.kind, t.name)]);

export const departments = pgTable("departments", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id), name: text("name").notNull(),
});

export const accounts = pgTable("accounts", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  type: text("type").notNull(), currency: text("currency").notNull(), name: text("name").notNull(),
  bankName: text("bank_name"), number: text("number"), active: boolean("active").notNull().default(true),
});

export const exchangeRates = pgTable("exchange_rates", {
  id: id(), rateCdfPerUsd: text("rate_cdf_per_usd").notNull(), effectiveFrom: date("effective_from").notNull(),
  setBy: uuid("set_by").references(() => users.id), createdAt: createdAt(),
});

export const members = pgTable("members", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  fullName: text("full_name").notNull(), phone: text("phone"),
  address: text("address"), whatsapp: text("whatsapp"), email: text("email"),
  homeChurch: text("home_church"), invitedBy: text("invited_by"),
  memberSince: date("member_since"),
  createdAt: createdAt(),
});

// Distinct from `members`: a newcomer's log entry, before (if ever) becoming a member (§11.2 addendum).
export const newcomers = pgTable("newcomers", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  fullName: text("full_name").notNull(), phone: text("phone"),
  address: text("address"), whatsapp: text("whatsapp"), email: text("email"),
  homeChurch: text("home_church"), invitedBy: text("invited_by"),
  createdAt: createdAt(),
});

export const pledges = pgTable("pledges", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  memberId: uuid("member_id").references(() => members.id), donorName: text("donor_name"),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(), dueDate: date("due_date"),
  // Engagement type (§9): construction | partenariat | parcelle | autre
  type: text("type").notNull().default("autre"), beneficiary: text("beneficiary"),
});

export const commitments = pgTable("commitments", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  categoryId: uuid("category_id").notNull().references(() => categories.id), payee: text("payee").notNull(),
  currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(), dueDate: date("due_date"),
  status: text("status").notNull().default("open"), // open | paid | cancelled
  transactionId: uuid("transaction_id"),
  type: text("type").notNull().default("autre"),
});

export const transactions = pgTable("transactions", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  reference: text("reference").notNull().unique(),
  kind: text("kind").notNull(), direction: text("direction").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  categoryId: uuid("category_id").references(() => categories.id),
  currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(),
  rateUsed: text("rate_used").notNull(), amountUsdMinor: money("amount_usd_minor").notNull(),
  date: date("date").notNull(), status: text("status").notNull().default("brouillon"),
  description: text("description"), beneficiary: text("beneficiary"), documentNumber: text("document_number"),
  departmentId: uuid("department_id").references(() => departments.id),
  memberId: uuid("member_id").references(() => members.id),
  enteredBy: uuid("entered_by").notNull().references(() => users.id),
  transferGroupId: uuid("transfer_group_id"), reversesId: uuid("reverses_id"),
  pledgeId: uuid("pledge_id").references(() => pledges.id),
  commitmentId: uuid("commitment_id").references(() => commitments.id),
  investmentId: uuid("investment_id").references(() => budgetInvestments.id),
  subCategory: text("sub_category"),
  validator1Id: uuid("validator1_id").references(() => users.id), validator1At: timestamp("validator1_at", { withTimezone: true }),
  validator2Id: uuid("validator2_id").references(() => users.id), validator2At: timestamp("validator2_at", { withTimezone: true }),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("tx_parish_date").on(t.parishId, t.date), index("tx_account").on(t.accountId), index("tx_status").on(t.status), index("tx_investment").on(t.investmentId)]);

export const transactionEvents = pgTable("transaction_events", {
  id: id(), transactionId: uuid("transaction_id").notNull().references(() => transactions.id),
  fromStatus: text("from_status"), toStatus: text("to_status").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id), comment: text("comment"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: id(), transactionId: uuid("transaction_id").notNull().references(() => transactions.id),
  parishId: uuid("parish_id").notNull().references(() => parishes.id),
  r2Key: text("r2_key").notNull(), filename: text("filename").notNull(),
});

export const attendanceRecords = pgTable("attendance_records", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  serviceDate: date("service_date").notNull(), serviceType: text("service_type").notNull(),
  hommes: integer("hommes").notNull().default(0), femmes: integer("femmes").notNull().default(0),
  jeunes: integer("jeunes").notNull().default(0), enfants: integer("enfants").notNull().default(0),
  visiteurs: integer("visiteurs").notNull().default(0),
  // §11.1: sexe x nature (legacy columns above are kept for old rows, no longer used by the UI)
  mAdulte: integer("m_adulte").notNull().default(0), mEnfant: integer("m_enfant").notNull().default(0), mBebe: integer("m_bebe").notNull().default(0),
  fAdulte: integer("f_adulte").notNull().default(0), fEnfant: integer("f_enfant").notNull().default(0), fBebe: integer("f_bebe").notNull().default(0),
  status: text("status").notNull().default("brouillon"), enteredBy: uuid("entered_by").notNull().references(() => users.id),
  // Signatures of the Pasteur assistant (level 1) and Pasteur titulaire (level 2); the motif is shown to the author.
  validator1Id: uuid("validator1_id").references(() => users.id), validator1At: timestamp("validator1_at", { withTimezone: true }),
  validator2Id: uuid("validator2_id").references(() => users.id), validator2At: timestamp("validator2_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
});

export const periods = pgTable("periods", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  year: integer("year").notNull(), month: integer("month").notNull(),
  closedBy: uuid("closed_by").references(() => users.id), closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("period_unique").on(t.parishId, t.year, t.month)]);

export const auditLog = pgTable("audit_log", {
  id: id(), parishId: uuid("parish_id"), actorId: uuid("actor_id"), action: text("action").notNull(),
  entity: text("entity").notNull(), entityId: text("entity_id"), before: jsonb("before"), after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_entity").on(t.entity, t.entityId)]);

// Per-parish key/value configuration (default currency, piece numbering mode, alert thresholds...).
export const settings = pgTable("settings", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  key: text("key").notNull(), value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("settings_unique").on(t.parishId, t.key)]);

// §27: approval workflow for modifying / cancelling an accounting entry.
export const changeRequests = pgTable("change_requests", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  reference: text("reference").notNull().unique(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id),
  kind: text("kind").notNull(), // modification | annulation
  reason: text("reason").notNull(),
  proposedChanges: jsonb("proposed_changes"), oldValues: jsonb("old_values"),
  status: text("status").notNull().default("en_attente_tresorier"),
  // en_attente_tresorier | approuvee_n1 | approuvee_n2 | rejetee | executee
  requesterId: uuid("requester_id").notNull().references(() => users.id),
  tresorierId: uuid("tresorier_id").references(() => users.id), tresorierAt: timestamp("tresorier_at", { withTimezone: true }),
  pasteurId: uuid("pasteur_id").references(() => users.id), pasteurAt: timestamp("pasteur_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"), executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("cr_parish_status").on(t.parishId, t.status), index("cr_tx").on(t.transactionId)]);

export const changeRequestEvents = pgTable("change_request_events", {
  id: id(), requestId: uuid("request_id").notNull().references(() => changeRequests.id),
  fromStatus: text("from_status"), toStatus: text("to_status").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id), comment: text("comment"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// §9: libérations (payments made against an engagement).
export const engagementReleases = pgTable("engagement_releases", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  pledgeId: uuid("pledge_id").references(() => pledges.id), commitmentId: uuid("commitment_id").references(() => commitments.id),
  date: date("date").notNull(), currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(),
  accountId: uuid("account_id").references(() => accounts.id), transactionId: uuid("transaction_id").references(() => transactions.id),
  note: text("note"), r2Key: text("r2_key"), filename: text("filename"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
});

// §11.3
export const workers = pgTable("workers", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  category: text("category").notNull(), // pasteur | chef_departement | ouvrier
  fullName: text("full_name").notNull(), address: text("address"),
  departmentId: uuid("department_id").references(() => departments.id),
  phone: text("phone"), email: text("email"), whatsapp: text("whatsapp"),
  basicTeachingDone: boolean("basic_teaching_done").notNull().default(false),
  active: boolean("active").notNull().default(true), createdAt: createdAt(),
});

// §12-14 registers

/**
 * Pasteur assistant → Pasteur titulaire circuit of baptêmes and mariages (registryTransition in @church/shared).
 * Rows that existed before the circuit were migrated as 'validee'; 9999f freezes submitted and validated rows.
 */
const registryWorkflow = () => ({
  status: text("status").notNull().default("brouillon"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  n1Skipped: boolean("n1_skipped").notNull().default(false), n2Skipped: boolean("n2_skipped").notNull().default(false),
  validator1Id: uuid("validator1_id").references(() => users.id), validator1At: timestamp("validator1_at", { withTimezone: true }),
  validator2Id: uuid("validator2_id").references(() => users.id), validator2At: timestamp("validator2_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
});
const REGISTRY_STATUSES = sql.raw("('brouillon','soumise','validee1','validee','rejetee')");

export const childDedications = pgTable("child_dedications", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  date: date("date").notNull(), childName: text("child_name").notNull(),
  motherName: text("mother_name"), fatherName: text("father_name"), pastorName: text("pastor_name"),
  formCompleted: boolean("form_completed").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
});

export const baptisms = pgTable("baptisms", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  fullName: text("full_name").notNull(), date: date("date").notNull(), place: text("place"), address: text("address"),
  phone: text("phone"), email: text("email"), whatsapp: text("whatsapp"), pastorName: text("pastor_name"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
  ...registryWorkflow(),
}, (t) => [
  check("bap_status", sql`${t.status} in ${REGISTRY_STATUSES}`),
  index("bap_parish_status").on(t.parishId, t.status),
]);

export const marriages = pgTable("marriages", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  husbandName: text("husband_name").notNull(), wifeName: text("wife_name").notNull(),
  coupleAddress: text("couple_address"), phone: text("phone"), date: date("date").notNull(),
  pastorName: text("pastor_name"), blessingPlace: text("blessing_place"),
  godfatherName: text("godfather_name"), godmotherName: text("godmother_name"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
  ...registryWorkflow(),
}, (t) => [
  check("mar_status", sql`${t.status} in ${REGISTRY_STATUSES}`),
  index("mar_parish_status").on(t.parishId, t.status),
]);

// Uploaded photo / card / certificate attached to a register entry (stored in R2).
export const recordFiles = pgTable("record_files", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  recordType: text("record_type").notNull(), // dedication | baptism | marriage
  recordId: uuid("record_id").notNull(),
  r2Key: text("r2_key").notNull(), filename: text("filename").notNull(), contentType: text("content_type"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id), createdAt: createdAt(),
}, (t) => [index("rf_record").on(t.recordType, t.recordId)]);

// Budget des dépenses: one line per (parish, year, category, currency, period, periodIndex).
// periodIndex is 0 for "annuel" (never null, so the unique index actually prevents duplicates).
export const budgetExpenseLines = pgTable("budget_expense_lines", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  year: integer("year").notNull(), categoryId: uuid("category_id").notNull().references(() => categories.id),
  period: text("period").notNull().default("annuel"), periodIndex: integer("period_index").notNull().default(0),
  currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(),
  observation: text("observation"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("bel_unique").on(t.parishId, t.year, t.categoryId, t.currency, t.period, t.periodIndex),
  index("bel_parish_year").on(t.parishId, t.year),
]);

// Budget d'investissement: a project with a planned amount; "réalisé" is computed from linked transactions.
export const budgetInvestments = pgTable("budget_investments", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  year: integer("year").notNull(), name: text("name").notNull(),
  type: text("type").notNull().default("autre"), currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(),
  observation: text("observation"), active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("binv_parish_year").on(t.parishId, t.year)]);

// ---- Immobilisations (spec "Compta CEPD MBUDI") ---------------------------------------------------
// Accounts and sous-comptes are constants in @church/shared; acronyms, locations and suppliers are
// per-parish referentials that are deactivated, never deleted (issued codes and history refer to them).

// Acronym of the asset code ("MI" in "MI 202610 00001"). Immutable once created; deactivate only.
export const assetCodePrefixes = pgTable("asset_code_prefixes", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  acronym: text("acronym").notNull(), label: text("label").notNull(),
  // Sous-comptes this acronym is suggested for in the form (not a constraint: MB and MO are both 24.4).
  subaccountCodes: text("subaccount_codes").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true), createdAt: createdAt(),
}, (t) => [
  uniqueIndex("acp_parish_acronym").on(t.parishId, t.acronym),
  check("acp_acronym_format", sql`${t.acronym} ~ '^[A-Z]{2,4}$'`),
]);

export const assetLocations = pgTable("asset_locations", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  name: text("name").notNull(), sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true), createdAt: createdAt(),
}, (t) => [uniqueIndex("al_parish_name").on(t.parishId, sql`lower(${t.name})`)]);

export const assetSuppliers = pgTable("asset_suppliers", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  name: text("name").notNull(), phone: text("phone"), address: text("address"), note: text("note"),
  active: boolean("active").notNull().default(true), createdAt: createdAt(),
}, (t) => [uniqueIndex("asu_parish_name").on(t.parishId, sql`lower(${t.name})`)]);

// Fixed-asset register. `code` is "MI 202610 00001" (next_asset_code()). `cost_minor` = PA + FAA is computed by
// the database so it can never be typed. `statut` is administrative, `etat` the physical condition (a cache of
// the latest asset_condition_history row, written only by trigger). Validated rows are frozen by guard_fixed_assets().
export const fixedAssets = pgTable("fixed_assets", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  code: text("code").notNull(), registeredAt: date("registered_at").notNull().defaultNow(),
  acronym: text("acronym").notNull(),
  accountCode: text("account_code").notNull(), subaccountCode: text("subaccount_code").notNull(),
  description: text("description").notNull(),
  invoiceNumber: text("invoice_number"),
  supplierId: uuid("supplier_id").references(() => assetSuppliers.id),
  acquisitionDate: date("acquisition_date").notNull(), inServiceDate: date("in_service_date"),
  locationId: uuid("location_id").notNull().references(() => assetLocations.id),
  currency: text("currency").notNull(), // USD | CDF | EUR
  // Frozen "1 USD = X <currency>" when a conversion is needed (same convention as transactions.rate_used).
  fxRatePerUsd: text("fx_rate_per_usd"), fxRateDate: date("fx_rate_date"),
  paMinor: money("pa_minor").notNull(), faaMinor: money("faa_minor").notNull().default(sql`0`),
  costMinor: money("cost_minor").generatedAlwaysAs(sql`pa_minor + faa_minor`),
  depreciationMethod: text("depreciation_method").notNull().default("lineaire"), // lineaire | degressif | non_amortissable
  usefulLifeYears: integer("useful_life_years"), // null exactly when non_amortissable
  degressiveCoefficient: text("degressive_coefficient"), // copied from settings at creation
  statut: text("statut").notNull().default("brouillon"),
  etat: text("etat").notNull().default("bon"),
  observations: text("observations"),
  transactionId: uuid("transaction_id").references(() => transactions.id), // optional: the dépense that bought it
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fa_parish_code").on(t.parishId, t.code),
  index("fa_parish_account").on(t.parishId, t.accountCode, t.subaccountCode),
  index("fa_parish_location").on(t.parishId, t.locationId),
  index("fa_parish_supplier").on(t.parishId, t.supplierId),
  index("fa_parish_acquisition").on(t.parishId, t.acquisitionDate),
  index("fa_parish_statut").on(t.parishId, t.statut),
  check("fa_pa_positive", sql`${t.paMinor} > 0`),
  check("fa_faa_not_negative", sql`${t.faaMinor} >= 0`),
  check("fa_currency", sql`${t.currency} in ('USD','CDF','EUR')`),
  check("fa_method", sql`${t.depreciationMethod} in ('lineaire','degressif','non_amortissable')`),
  check("fa_method_years", sql`(${t.depreciationMethod} = 'non_amortissable') = (${t.usefulLifeYears} is null)`),
  check("fa_subaccount_of_account", sql`${t.subaccountCode} like ${t.accountCode} || '.%'`),
  check("fa_no_fx_for_usd", sql`${t.currency} <> 'USD' or ${t.fxRatePerUsd} is null`),
  check("fa_statut", sql`${t.statut} in ('brouillon','en_attente_validation','actif','cede','mis_au_rebut','transfere','annule')`),
  check("fa_etat", sql`${t.etat} in ('bon','mauvais','declasse','perdu')`),
]);

// Approval requests on an asset: creation (Brouillon → Actif), modification, annulation, sensitive état change.
// Same two-level circuit as change_requests (Trésorier then Pasteur); a requester who is themself the Trésorier or
// the Pasteur has that level skipped (n1_skipped / n2_skipped), and the skip is recorded, never silent.
export const assetRequests = pgTable("asset_requests", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  reference: text("reference").notNull().unique(), // DEM-… from next_request_reference
  assetId: uuid("asset_id").notNull().references(() => fixedAssets.id),
  kind: text("kind").notNull(), // creation | modification | annulation | changement_etat
  reason: text("reason").notNull(),
  proposedChanges: jsonb("proposed_changes"), oldValues: jsonb("old_values"),
  status: text("status").notNull().default("en_attente_tresorier"),
  // en_attente_tresorier | approuvee_n1 | approuvee_n2 | rejetee | executee
  n1Skipped: boolean("n1_skipped").notNull().default(false), n2Skipped: boolean("n2_skipped").notNull().default(false),
  requesterId: uuid("requester_id").notNull().references(() => users.id),
  tresorierId: uuid("tresorier_id").references(() => users.id), tresorierAt: timestamp("tresorier_at", { withTimezone: true }),
  pasteurId: uuid("pasteur_id").references(() => users.id), pasteurAt: timestamp("pasteur_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"), executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("ar_parish_status").on(t.parishId, t.status),
  index("ar_asset").on(t.assetId),
  // One open request per asset, enforced by the database.
  uniqueIndex("ar_one_open").on(t.assetId).where(sql`${t.status} in ('en_attente_tresorier','approuvee_n1')`),
  check("ar_kind", sql`${t.kind} in ('creation','modification','annulation','changement_etat')`),
]);

export const assetRequestEvents = pgTable("asset_request_events", {
  id: id(), requestId: uuid("request_id").notNull().references(() => assetRequests.id),
  fromStatus: text("from_status"), toStatus: text("to_status").notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id), comment: text("comment"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Permanent, append-only history of an asset's physical état since its acquisition. A row is written when a change
// takes effect (non-sensitive: immediately; Déclassé/Perdu: at the final approval). Pending and refused sensitive
// changes are read from asset_requests. An AFTER INSERT trigger keeps fixed_assets.etat equal to the latest row.
export const assetConditionHistory = pgTable("asset_condition_history", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  assetId: uuid("asset_id").notNull().references(() => fixedAssets.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  oldEtat: text("old_etat"), newEtat: text("new_etat").notNull(),
  reason: text("reason").notNull(), observation: text("observation"),
  locationId: uuid("location_id").notNull().references(() => assetLocations.id), // location at the time of the change
  actorId: uuid("actor_id").notNull().references(() => users.id),
  requestId: uuid("request_id").references(() => assetRequests.id),
  validationStatus: text("validation_status").notNull().default("non_requis"), // non_requis | approuve
}, (t) => [
  index("ach_asset").on(t.assetId, t.at),
  check("ach_new_etat", sql`${t.newEtat} in ('bon','mauvais','declasse','perdu')`),
  check("ach_reason", sql`length(trim(${t.reason})) > 0`),
  check("ach_observation", sql`${t.newEtat} = 'bon' or length(trim(coalesce(${t.observation}, ''))) > 0`),
  check("ach_validation", sql`${t.validationStatus} in ('non_requis','approuve')`),
]);

// Inventaire physique. An inventory snapshots the validated assets (the théorique) when it starts; the lines are then
// checked one by one (the physique). Once closed, nothing in it can change. It never modifies an asset: a missing
// asset is declared Perdu through the normal état flow.
export const assetInventories = pgTable("asset_inventories", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  reference: text("reference").notNull(), // INV-KIN01-2026-000001
  locationId: uuid("location_id").references(() => assetLocations.id), // null = every location
  status: text("status").notNull().default("en_cours"), // en_cours | cloture
  startedOn: date("started_on").notNull(), observations: text("observations"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
  closedBy: uuid("closed_by").references(() => users.id), closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("ainv_reference").on(t.reference),
  index("ainv_parish").on(t.parishId, t.status),
  check("ainv_status", sql`${t.status} in ('en_cours','cloture')`),
]);

export const assetInventoryLines = pgTable("asset_inventory_lines", {
  id: id(), inventoryId: uuid("inventory_id").notNull().references(() => assetInventories.id),
  assetId: uuid("asset_id").references(() => fixedAssets.id), // null = found but not in the register
  // théorique, frozen when the inventory starts
  expectedCode: text("expected_code"), expectedDescription: text("expected_description"),
  expectedLocationId: uuid("expected_location_id").references(() => assetLocations.id), expectedEtat: text("expected_etat"),
  // physique
  present: boolean("present"), // null = not checked yet
  foundLocationId: uuid("found_location_id").references(() => assetLocations.id), foundEtat: text("found_etat"),
  responsible: text("responsible"), observation: text("observation"), extraDescription: text("extra_description"),
  checkedAt: timestamp("checked_at", { withTimezone: true }), checkedBy: uuid("checked_by").references(() => users.id),
}, (t) => [
  index("ainvl_inventory").on(t.inventoryId),
  uniqueIndex("ainvl_asset").on(t.inventoryId, t.assetId).where(sql`${t.assetId} is not null`),
  check("ainvl_found_etat", sql`${t.foundEtat} is null or ${t.foundEtat} in ('bon','mauvais','declasse','perdu')`),
  check("ainvl_expected_etat", sql`${t.expectedEtat} is null or ${t.expectedEtat} in ('bon','mauvais','declasse','perdu')`),
]);

import {
  bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
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
  subCategory: text("sub_category"),
  validator1Id: uuid("validator1_id").references(() => users.id), validator1At: timestamp("validator1_at", { withTimezone: true }),
  validator2Id: uuid("validator2_id").references(() => users.id), validator2At: timestamp("validator2_at", { withTimezone: true }),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("tx_parish_date").on(t.parishId, t.date), index("tx_account").on(t.accountId), index("tx_status").on(t.status)]);

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
});

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
});

export const marriages = pgTable("marriages", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  husbandName: text("husband_name").notNull(), wifeName: text("wife_name").notNull(),
  coupleAddress: text("couple_address"), phone: text("phone"), date: date("date").notNull(),
  pastorName: text("pastor_name"), blessingPlace: text("blessing_place"),
  createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: createdAt(),
});

// Uploaded photo / card / certificate attached to a register entry (stored in R2).
export const recordFiles = pgTable("record_files", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  recordType: text("record_type").notNull(), // dedication | baptism | marriage
  recordId: uuid("record_id").notNull(),
  r2Key: text("r2_key").notNull(), filename: text("filename").notNull(), contentType: text("content_type"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id), createdAt: createdAt(),
}, (t) => [index("rf_record").on(t.recordType, t.recordId)]);

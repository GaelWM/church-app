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
});

export const pledges = pgTable("pledges", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  memberId: uuid("member_id").references(() => members.id), donorName: text("donor_name"),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(), dueDate: date("due_date"),
});

export const commitments = pgTable("commitments", {
  id: id(), parishId: uuid("parish_id").notNull().references(() => parishes.id),
  categoryId: uuid("category_id").notNull().references(() => categories.id), payee: text("payee").notNull(),
  currency: text("currency").notNull(), amountMinor: money("amount_minor").notNull(), dueDate: date("due_date"),
  status: text("status").notNull().default("open"), // open | paid | cancelled
  transactionId: uuid("transaction_id"),
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

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
  jsonb,
  smallint,
} from "drizzle-orm/pg-core";
import { schoolTypeEnum, ownershipEnum, shsCategoryEnum, productEnum } from "./_enums";

/** GES geography — global reference data (no tenant scope). */
export const regions = pgTable("ref_region", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const districts = pgTable("ref_district", {
  id: uuid("id").primaryKey().defaultRandom(),
  regionId: uuid("region_id")
    .notNull()
    .references(() => regions.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

/** A tenant. Isolation key for the whole operational DB. */
export const schools = pgTable("ref_school", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortName: text("short_name"), // SMS sign-off (e.g. ASANKSHS)
  gesCode: text("ges_code").notNull().unique(),
  csspsCode: text("cssps_code"), // CSSPS placement code (SHS/TVI) — hm.cssps.gov.gh
  schoolType: schoolTypeEnum("school_type").notNull().default("BASIC"),
  // Exact onboarding choice (BASIC/JHS/SHS/SHTS/MULTI) — finer than school_type enum.
  subtype: text("subtype"),
  shsCategory: shsCategoryEnum("shs_category"),
  ownership: ownershipEnum("ownership_type").notNull().default("PRIVATE"),
  yearFounded: text("year_founded"),
  address: text("address"), // postal + GPS Ghana Post code
  // Branding (Settings → Branding) — hosted image URLs + brand colour
  logoUrl: text("logo_url"),
  stampUrl: text("stamp_url"),
  brandColor: text("brand_color"), // hex, e.g. "#1A2B47"
  // Onboarding step 6 — billing prefs + Terms acceptance
  billingCadence: text("billing_cadence"), // "TERM" | "MONTHLY"
  paymentMethods: jsonb("payment_methods").$type<string[]>(), // e.g. ["MTN_MOMO","CASH"]
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  // Onboarding steps 7–8 (SHS only) — lightweight capture; modules built in the Senior MVP
  residencyModel: text("residency_model"), // "DAY" | "MIXED" | "BOARDING"
  houseCount: smallint("house_count"),
  visitingDay: text("visiting_day"),
  waecCentreCode: text("waec_centre_code"),
  waecOffice: text("waec_office"),
  firstWassceYear: text("first_wassce_year"),
  // Settings — retention policy + security prefs (captured; enforcement is future work)
  recordRetentionMonths: smallint("record_retention_months"), // keep records after leaving
  auditRetentionMonths: smallint("audit_retention_months"),
  require2fa: boolean("require_2fa"),
  sessionHours: smallint("session_hours"),
  districtId: uuid("district_id").references(() => districts.id),
  regionId: uuid("region_id").references(() => regions.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which products a school subscribes to (Basic / Senior / Oversight). */
export const schoolProducts = pgTable(
  "ref_school_product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    product: productEnum("product").notNull(),
    active: boolean("active").notNull().default(true),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqSchoolProduct: unique("uniq_school_product").on(t.schoolId, t.product),
  }),
);

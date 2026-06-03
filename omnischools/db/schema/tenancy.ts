import { pgTable, uuid, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
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
  schoolType: schoolTypeEnum("school_type").notNull().default("BASIC"),
  shsCategory: shsCategoryEnum("shs_category"),
  ownership: ownershipEnum("ownership_type").notNull().default("PRIVATE"),
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

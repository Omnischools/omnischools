import { z } from "zod";

// Shared onboarding constants/schema/types — importable by both the client wizard
// and the "use server" action (a "use server" module may only export async functions).

export const ONBOARD_PRODUCTS = ["BASIC", "SENIOR", "COMBINED"] as const;
export const OWNERSHIPS = ["PUBLIC", "PRIVATE", "MISSION", "INTERNATIONAL"] as const;
export const GH_REGIONS = [
  "Greater Accra",
  "Ashanti",
  "Western",
  "Western North",
  "Central",
  "Eastern",
  "Volta",
  "Oti",
  "Northern",
  "Savannah",
  "North East",
  "Upper East",
  "Upper West",
  "Bono",
  "Bono East",
  "Ahafo",
] as const;

export const PRODUCT_LABELS: Record<(typeof ONBOARD_PRODUCTS)[number], string> = {
  BASIC: "Basic — KG · Primary · JHS",
  SENIOR: "Senior — SHS / SHTS",
  COMBINED: "Combined — Basic + Senior",
};

/**
 * School-type cards shown at step 2 — the branch point. Three cards map 1:1 onto the
 * `school_type` enum: Basic (KG·Primary·JHS), Senior (SHS/SHTS), Multi-tier (Basic+Senior).
 * Basic finishes at step 6; Senior and Multi-tier reveal the two SHS-only steps (7–8).
 *
 * `subtype` records the finer choice — for Senior it captures the SHS-vs-SHTS toggle so a
 * later release can branch the Senior academic structure (SHTS ≈ TVET, different curriculum).
 */
export const SCHOOL_SUBTYPES = ["BASIC", "SHS", "SHTS", "MULTI"] as const;
export type SchoolSubtype = (typeof SCHOOL_SUBTYPES)[number];

export type CardId = "BASIC" | "SENIOR" | "MULTI";

export type SchoolTypeCard = {
  id: CardId;
  name: string;
  desc: string;
  steps: 6 | 8;
  product: (typeof ONBOARD_PRODUCTS)[number];
  schoolType: "BASIC" | "SENIOR" | "COMBINED";
  defaultSubtype: SchoolSubtype;
};

export const SCHOOL_TYPE_CARDS: SchoolTypeCard[] = [
  {
    id: "BASIC",
    name: "Basic",
    desc: "KG · Primary · JHS. Class-based academic structure with subject teachers; BECE prep in JHS 3.",
    steps: 6,
    product: "BASIC",
    schoolType: "BASIC",
    defaultSubtype: "BASIC",
  },
  {
    id: "SENIOR",
    name: "Senior",
    desc: "SHS / SHTS. Programme-based (Science / Business / GA / Home Econ), 4 cores, WASSCE-bound.",
    steps: 8,
    product: "SENIOR",
    schoolType: "SENIOR",
    defaultSubtype: "SHS",
  },
  {
    id: "MULTI",
    name: "Multi-tier",
    desc: "Basic + Senior on one campus. Both structures coexist; follows the Senior path through setup.",
    steps: 8,
    product: "COMBINED",
    schoolType: "COMBINED",
    defaultSubtype: "MULTI",
  },
];

/** The SHS-vs-SHTS toggle shown once the Senior card is chosen (recorded in `subtype`). */
export const SENIOR_TRACKS = [
  {
    key: "SHS",
    label: "SHS",
    desc: "Standard senior high — 4 WASSCE cores + electives per programme.",
  },
  {
    key: "SHTS",
    label: "SHTS / TVET",
    desc: "Technical & vocational — curriculum differs; built out in the Senior release.",
  },
] as const;

export const cardForSubtype = (s?: SchoolSubtype): SchoolTypeCard => {
  if (s === "SHS" || s === "SHTS") return SCHOOL_TYPE_CARDS[1];
  if (s === "MULTI") return SCHOOL_TYPE_CARDS[2];
  return SCHOOL_TYPE_CARDS[0];
};

export const cardById = (id: CardId): SchoolTypeCard =>
  SCHOOL_TYPE_CARDS.find((c) => c.id === id) ?? SCHOOL_TYPE_CARDS[0];

export const OnboardSchema = z.object({
  schoolName: z.string().min(2, "School name is required").max(200),
  shortName: z.string().max(60).optional().or(z.literal("")),
  gesCode: z.string().min(2, "GES code is required").max(40),
  csspsCode: z.string().max(40).optional().or(z.literal("")),
  yearFounded: z.string().max(8).optional().or(z.literal("")),
  address: z.string().max(200).optional().or(z.literal("")),
  region: z.enum(GH_REGIONS),
  district: z.string().min(2, "District is required").max(120),
  product: z.enum(ONBOARD_PRODUCTS),
  subtype: z.enum(SCHOOL_SUBTYPES).optional(),
  ownership: z.enum(OWNERSHIPS),
  headmasterName: z.string().min(2, "Headmaster name is required").max(160),
  headmasterPhone: z.string().min(7, "Headmaster phone is required").max(40),
  headmasterEmail: z.string().email().optional().or(z.literal("")),
  adminName: z.string().min(2, "Admin name is required").max(160),
  adminPhone: z.string().min(7, "Admin phone is required").max(40),
  adminEmail: z.string().email().optional().or(z.literal("")),
});

export type OnboardInput = z.infer<typeof OnboardSchema>;
export type OnboardResult =
  | { ok: true; schoolId: string; academicYear: string; periodsCreated: number }
  | { ok: false; error: string };

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
 * School-type cards shown at step 2 — the branch point. The five live options map
 * onto the coarser `school_type` enum (BASIC/SENIOR/COMBINED) + a `product`, while the
 * exact card is kept in `subtype` for downstream fidelity (e.g. SHS vs SHTS programmes).
 * Basic/JHS finish at step 6; SHS/SHTS/Multi-tier reveal the two SHS-only steps (7–8).
 */
export const SCHOOL_SUBTYPES = ["BASIC", "JHS", "SHS", "SHTS", "MULTI"] as const;
export type SchoolSubtype = (typeof SCHOOL_SUBTYPES)[number];

export type SchoolTypeCard = {
  key: SchoolSubtype;
  name: string;
  desc: string;
  steps: 6 | 8;
  product: (typeof ONBOARD_PRODUCTS)[number];
  schoolType: "BASIC" | "SENIOR" | "COMBINED";
};

export const SCHOOL_TYPE_CARDS: SchoolTypeCard[] = [
  {
    key: "BASIC",
    name: "Basic",
    desc: "KG + Primary, sometimes through P6. Class-based academic structure, subject teachers.",
    steps: 6,
    product: "BASIC",
    schoolType: "BASIC",
  },
  {
    key: "JHS",
    name: "JHS",
    desc: "Junior High School only. Class-based, BECE preparation in JHS3, standard GES syllabus.",
    steps: 6,
    product: "BASIC",
    schoolType: "BASIC",
  },
  {
    key: "SHS",
    name: "SHS",
    desc: "Senior High School. Programme-based (Science / Business / GA / Home Econ), 4 cores, WASSCE-bound.",
    steps: 8,
    product: "SENIOR",
    schoolType: "SENIOR",
  },
  {
    key: "SHTS",
    name: "SHTS",
    desc: "Senior High Technical School. Same WASSCE base + technical programmes (engineering, IT, building).",
    steps: 8,
    product: "SENIOR",
    schoolType: "SENIOR",
  },
  {
    key: "MULTI",
    name: "Multi-tier",
    desc: "Combined campus running two or more tiers (e.g. JHS + SHS, or Basic + JHS). Both structures coexist.",
    steps: 8,
    product: "COMBINED",
    schoolType: "COMBINED",
  },
];

export const cardForSubtype = (k: SchoolSubtype): SchoolTypeCard =>
  SCHOOL_TYPE_CARDS.find((c) => c.key === k) ?? SCHOOL_TYPE_CARDS[0];

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

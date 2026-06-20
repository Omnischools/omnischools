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

/* ----------------------------------------------- academic calendar (step 3) */

export type PeriodChoice = {
  key: "TERM3" | "SEM2";
  label: string;
  periodType: "TERM" | "SEMESTER";
  count: number;
  names: string[];
};

export const PERIOD_CHOICES: PeriodChoice[] = [
  {
    key: "TERM3",
    label: "3 terms",
    periodType: "TERM",
    count: 3,
    names: ["Term 1", "Term 2", "Term 3"],
  },
  {
    key: "SEM2",
    label: "2 semesters",
    periodType: "SEMESTER",
    count: 2,
    names: ["Semester 1", "Semester 2"],
  },
];

/** GES current academic year, e.g. "2025/26" (rolls over in September). */
export function currentAcademicYearLabel(now = new Date()): string {
  const y = now.getFullYear();
  const start = now.getMonth() >= 8 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/* --------------------------------------------------- grade scale (step 3) */

export type GradeRow = { grade: string; label: string; minScore: number };

/** Default grade scales. Basic uses A–F bands; Senior mirrors WASSCE A1–F9. */
export const GRADE_SCALE_PRESETS: Record<"BASIC" | "WASSCE", GradeRow[]> = {
  BASIC: [
    { grade: "A", label: "Excellent", minScore: 80 },
    { grade: "B", label: "Very good", minScore: 70 },
    { grade: "C", label: "Good", minScore: 60 },
    { grade: "D", label: "Pass", minScore: 50 },
    { grade: "F", label: "Fail", minScore: 0 },
  ],
  WASSCE: [
    { grade: "A1", label: "Excellent", minScore: 80 },
    { grade: "B2", label: "Very good", minScore: 75 },
    { grade: "B3", label: "Good", minScore: 70 },
    { grade: "C4", label: "Credit", minScore: 65 },
    { grade: "C5", label: "Credit", minScore: 60 },
    { grade: "C6", label: "Credit", minScore: 55 },
    { grade: "D7", label: "Pass", minScore: 50 },
    { grade: "E8", label: "Pass", minScore: 45 },
    { grade: "F9", label: "Fail", minScore: 0 },
  ],
};

/** Senior tiers default to the WASSCE scale; Basic/Multi-tier to the A–F bands. */
export const defaultGradePreset = (subtype?: SchoolSubtype): "BASIC" | "WASSCE" =>
  subtype === "SHS" || subtype === "SHTS" ? "WASSCE" : "BASIC";

/* --------------------------------------------- academic structure (step 4) */

/** GES Basic ladder — KG through JHS. Seeded as editable class rows for Basic/Multi. */
export const GES_BASIC_CLASSES = [
  "KG 1",
  "KG 2",
  "Basic 1",
  "Basic 2",
  "Basic 3",
  "Basic 4",
  "Basic 5",
  "Basic 6",
  "JHS 1",
  "JHS 2",
  "JHS 3",
];

/** Common GES Basic-school subjects. */
export const GES_BASIC_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Integrated Science",
  "Our World Our People",
  "Computing (ICT)",
  "Creative Arts & Design",
  "Ghanaian Language",
  "Religious & Moral Education",
  "French",
  "Physical Education",
];

/** The four universal WASSCE cores (every SHS programme). */
export const WASSCE_CORE_SUBJECTS = [
  "English Language",
  "Mathematics (Core)",
  "Integrated Science",
  "Social Studies",
];

/** SHS programmes shown as a stub at step 4 — the full matrix lands in the Senior MVP. */
export const SHS_PROGRAMMES = [
  { name: "Science", electives: ["Chemistry", "Physics", "Biology", "Elective Maths"] },
  {
    name: "Business",
    electives: [
      "Financial Accounting",
      "Cost Accounting",
      "Business Management",
      "Economics",
    ],
  },
  {
    name: "General Arts",
    electives: ["Literature", "Geography", "Government", "History / CRS / French"],
  },
  {
    name: "Home Economics",
    electives: [
      "Management in Living",
      "Food & Nutrition",
      "Clothing & Textiles",
      "Biology",
    ],
  },
];

/** Has a class-based wing (Basic or Multi-tier) → show the classes builder. */
export const hasClassWing = (s?: SchoolSubtype): boolean => s !== "SHS" && s !== "SHTS";
/** Has a senior wing (SHS/SHTS/Multi-tier) → show the programmes stub. */
export const hasSeniorWing = (s?: SchoolSubtype): boolean =>
  s === "SHS" || s === "SHTS" || s === "MULTI";

export const defaultClasses = (s?: SchoolSubtype): string[] =>
  hasClassWing(s) ? GES_BASIC_CLASSES : [];

export const defaultSubjects = (s?: SchoolSubtype): string[] =>
  s === "SHS" || s === "SHTS"
    ? WASSCE_CORE_SUBJECTS
    : s === "MULTI"
      ? Array.from(new Set([...GES_BASIC_SUBJECTS, ...WASSCE_CORE_SUBJECTS]))
      : GES_BASIC_SUBJECTS;

/* ------------------------------------------ billing & payments (step 6) */

export const BILLING_CADENCES = [
  {
    key: "TERM",
    label: "Per term",
    desc: "One bill at the start of each term — the Ghanaian norm.",
  },
  {
    key: "MONTHLY",
    label: "Monthly",
    desc: "Spread fees across monthly instalments.",
  },
] as const;

export const PAYMENT_METHODS = [
  { code: "MTN_MOMO", label: "MTN MoMo" },
  { code: "TELECEL_CASH", label: "Telecel Cash" },
  { code: "AIRTELTIGO_MONEY", label: "AirtelTigo Money" },
  { code: "BANK_TRANSFER", label: "Bank transfer" },
  { code: "CASH", label: "Cash" },
] as const;

export const DEFAULT_PAYMENT_METHODS = ["MTN_MOMO", "CASH"];

export type FeeItem = { item: string; amount: number };

/* ----------------------------------- SHS residency + WAEC (steps 7–8) */

export const RESIDENCY_MODELS = [
  {
    key: "DAY",
    name: "Day-only",
    desc: "All students commute. No on-campus residence.",
  },
  {
    key: "MIXED",
    name: "Mixed",
    desc: "Some boarders, some day — the most common Free SHS pattern.",
  },
  {
    key: "BOARDING",
    name: "Boarding-only",
    desc: "All students reside on campus.",
  },
] as const;

export const VISITING_CADENCES = [
  "Once per term",
  "Twice per term",
  "Monthly",
  "No visiting days",
] as const;

/** Starter fee lines. Public Senior schools default to Free SHS (tuition 0). */
export const defaultFees = (s?: SchoolSubtype, ownership?: string): FeeItem[] => {
  const senior = s === "SHS" || s === "SHTS" || s === "MULTI";
  if (senior && ownership === "PUBLIC") {
    return [
      { item: "Tuition (Free SHS)", amount: 0 },
      { item: "PTA dues", amount: 0 },
      { item: "Boarding", amount: 0 },
    ];
  }
  return [
    { item: "Tuition", amount: 0 },
    { item: "Books", amount: 0 },
    { item: "PTA dues", amount: 0 },
  ];
};

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
  // Step 3 — academic calendar (optional; falls back to GES defaults)
  academicYear: z.string().max(20).optional().or(z.literal("")),
  periodType: z.enum(["TERM", "SEMESTER"]).optional(),
  periodCount: z.coerce.number().int().min(1).max(6).optional(),
  terms: z
    .array(
      z.object({
        label: z.string().max(40),
        startsOn: z.string().optional().or(z.literal("")),
        endsOn: z.string().optional().or(z.literal("")),
      }),
    )
    .max(6)
    .optional(),
  // Step 3 — grade scale (optional; falls back to the tier preset)
  gradeScale: z
    .array(
      z.object({
        grade: z.string().min(1).max(8),
        label: z.string().max(40).optional().or(z.literal("")),
        minScore: z.coerce.number().min(0).max(100),
      }),
    )
    .max(15)
    .optional(),
  // Step 4 — academic structure (optional; falls back to tier defaults)
  classes: z.array(z.string().max(60)).max(60).optional(),
  subjects: z.array(z.string().max(60)).max(80).optional(),
  // Step 6 — billing & payments (optional; falls back to tier defaults)
  fees: z
    .array(z.object({ item: z.string().max(60), amount: z.coerce.number().min(0).max(1000000) }))
    .max(20)
    .optional(),
  billingCadence: z.enum(["TERM", "MONTHLY"]).optional(),
  paymentMethods: z.array(z.string().max(30)).max(10).optional(),
  termsAccepted: z.boolean().optional(),
  // Steps 7–8 (SHS only) — lightweight capture
  residencyModel: z.enum(["DAY", "MIXED", "BOARDING"]).optional(),
  houseCount: z.coerce.number().int().min(0).max(40).optional(),
  visitingDay: z.string().max(60).optional().or(z.literal("")),
  waecCentreCode: z.string().max(40).optional().or(z.literal("")),
  waecOffice: z.string().max(80).optional().or(z.literal("")),
  firstWassceYear: z.string().max(8).optional().or(z.literal("")),
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

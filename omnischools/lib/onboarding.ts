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

export const OnboardSchema = z.object({
  schoolName: z.string().min(2, "School name is required").max(200),
  gesCode: z.string().min(2, "GES code is required").max(40),
  region: z.enum(GH_REGIONS),
  district: z.string().min(2, "District is required").max(120),
  product: z.enum(ONBOARD_PRODUCTS),
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

/** Shared option lists for dropdowns across the app (Issue 9: field uniformity). */

/** Ghana year-groups (KG → SHS) for class level / year-group dropdowns. */
export const YEAR_GROUPS = [
  "KG 1",
  "KG 2",
  "Primary 1",
  "Primary 2",
  "Primary 3",
  "Primary 4",
  "Primary 5",
  "Primary 6",
  "JHS 1",
  "JHS 2",
  "JHS 3",
  "SHS 1",
  "SHS 2",
  "SHS 3",
] as const;

/** Default fee line-item suggestions for the Billing combobox (users can add more). */
export const DEFAULT_FEE_ITEMS = [
  "Tuition",
  "Books",
  "Uniform",
  "Feeding",
  "Transport",
  "PTA dues",
  "Exam fees",
  "Boarding",
  "ICT levy",
  "Sports",
  "Other",
] as const;

/** Common discount names (managed under Settings → Fee structure). */
export const DEFAULT_DISCOUNTS = [
  "Sibling discount",
  "Staff ward",
  "Scholarship",
  "Bursary",
  "Need-based",
  "Early payment",
  "Sports / talent",
  "Bereavement",
] as const;

/** Default chart-of-accounts categories for the Books module (seed + suggestions). */
export const INCOME_CATEGORIES = [
  "Tuition & fees",
  "PTA dues",
  "Admission fees",
  "Donations",
  "Government grant",
  "Boarding fees",
  "Other income",
] as const;

export const EXPENSE_CATEGORIES = [
  "Salaries & wages",
  "Utilities (light & water)",
  "Feeding",
  "Teaching & learning materials",
  "Maintenance & repairs",
  "Transport",
  "Administration",
  "Other expense",
] as const;

/** Common Ghanaian basic-school subjects for subject dropdowns. */
export const COMMON_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Integrated Science",
  "Social Studies",
  "Religious & Moral Education",
  "Ghanaian Language",
  "French",
  "Computing / ICT",
  "Creative Arts & Design",
  "Career Technology",
  "Physical Education",
] as const;

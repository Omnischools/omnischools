/**
 * Settings hub directory — groups + cards for the /settings landing wayfinder
 * (per schoolup-settings.html). A card either links to an existing module (`href`)
 * or to a settings sub-page; `soon: true` marks pages not yet built (rendered dimmed,
 * non-clickable). Pure data — no DB, client/server safe.
 */
export type SettingsTone = "navy" | "gold" | "green" | "terra" | "blue";

export type SettingsCard = {
  key: string;
  name: string;
  em: string; // italic-gold word shown after `name`
  icon: string;
  tone: SettingsTone;
  desc: string;
  href: string;
  soon?: boolean;
  external?: boolean; // links to an existing module rather than a /settings sub-page
};

export type SettingsGroup = {
  num: string;
  title: string;
  em: string;
  meta: string;
  cards: SettingsCard[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    num: "01",
    title: "The",
    em: "school",
    meta: "Set once · rarely changes",
    cards: [
      {
        key: "school",
        name: "School",
        em: "info",
        icon: "i",
        tone: "navy",
        desc: "Name, short name, CSSPS code, year founded, address and ownership. Used on every receipt and statutory form.",
        href: "/settings/school",
      },
      {
        key: "branding",
        name: "Branding &",
        em: "identity",
        icon: "B",
        tone: "gold",
        desc: "School logo, official stamp and brand colour. The stamp appears on every PDF; the logo on receipts and announcements.",
        href: "/settings/branding",
      },
      {
        key: "academic",
        name: "Academic",
        em: "structure",
        icon: "A",
        tone: "gold",
        desc: "Term dates, the school-year calendar, and the grade scale (BECE 1–9 / WASSCE A1–F9 / percentage bands).",
        href: "/settings/academic",
      },
    ],
  },
  {
    num: "02",
    title: "Daily",
    em: "operations",
    meta: "Touched each term",
    cards: [
      {
        key: "attendance",
        name: "Attendance",
        em: "rules",
        icon: "A",
        tone: "navy",
        desc: "Daily register times, the edit window, late thresholds, the absentee SMS and attention flags.",
        href: "/settings/attendance",
      },
      {
        key: "billing",
        name: "Billing &",
        em: "fees",
        icon: "$",
        tone: "green",
        desc: "Fee structures by level, discounts and payment channels. Determines what each parent owes each term.",
        href: "/billing",
        external: true,
      },
      {
        key: "grading",
        name: "Grading &",
        em: "assessment",
        icon: "G",
        tone: "gold",
        desc: "Subjects, the report card and the weighting between continuous assessment and end-of-term exams.",
        href: "/gradebook",
        external: true,
      },
    ],
  },
  {
    num: "03",
    title: "How the school",
    em: "speaks",
    meta: "Voice · channels · privacy",
    cards: [
      {
        key: "messaging",
        name: "SMS &",
        em: "WhatsApp",
        icon: "SM",
        tone: "gold",
        desc: "Sender ID, default channels and language. Messages sign off as your school short name.",
        href: "/settings/messaging",
        soon: true,
      },
      {
        key: "templates",
        name: "Message",
        em: "templates",
        icon: "T",
        tone: "navy",
        desc: "Reusable blueprints — fee reminder, welcome, exam notice. Edit copy and manage variants.",
        href: "/communication",
        external: true,
      },
      {
        key: "engagement",
        name: "Comments &",
        em: "engagement",
        icon: "C",
        tone: "navy",
        desc: "Whether parents can reply to announcements, moderation, and the profanity filter.",
        href: "/settings/engagement",
        soon: true,
      },
      {
        key: "inbox-routing",
        name: "Inbox",
        em: "routing",
        icon: "IR",
        tone: "gold",
        desc: "Rules that decide who handles each parent message — by topic, class or keyword — evaluated top to bottom, first match wins.",
        href: "/settings/inbox/routing",
      },
      {
        key: "whatsapp-templates",
        name: "WhatsApp",
        em: "templates",
        icon: "WA",
        tone: "green",
        desc: "Compose Meta-approved WhatsApp templates — category, variables and buttons — and track their approval status.",
        href: "/settings/channels/whatsapp/templates",
      },
    ],
  },
  {
    num: "04",
    title: "Access &",
    em: "security",
    meta: "Who can do what",
    cards: [
      {
        key: "roles",
        name: "Roles &",
        em: "access",
        icon: "R",
        tone: "terra",
        desc: "Staff accounts and the roles they hold — who can record payments, send announcements or see records.",
        href: "/staff",
        external: true,
      },
      {
        key: "security",
        name: "Login &",
        em: "password",
        icon: "L",
        tone: "navy",
        desc: "Password policy, session length, two-factor for admins and the login activity log.",
        href: "/settings/security",
      },
    ],
  },
  {
    num: "05",
    title: "Data &",
    em: "compliance",
    meta: "Records · retention · export",
    cards: [
      {
        key: "audit",
        name: "Audit",
        em: "log",
        icon: "Au",
        tone: "navy",
        desc: "An immutable record of who changed what and when — payments, records, roles and settings.",
        href: "/settings/audit",
      },
      {
        key: "export",
        name: "Data",
        em: "export",
        icon: "Ex",
        tone: "green",
        desc: "Download your students, staff and fees as CSV. Your records are yours to take anytime.",
        href: "/settings/export",
      },
      {
        key: "retention",
        name: "Retention",
        em: "policy",
        icon: "Re",
        tone: "gold",
        desc: "How long records are kept after a student or staff member leaves, and audit-log retention.",
        href: "/settings/retention",
      },
    ],
  },
  {
    num: "06",
    title: "External",
    em: "integrations",
    meta: "Third parties & data sharing",
    cards: [
      {
        key: "hubtel",
        name: "Hubtel",
        em: "payments",
        icon: "H",
        tone: "blue",
        desc: "Online payment aggregator — routes parent payments to your bank with an auto-reconciliation feed.",
        href: "/settings/hubtel",
        soon: true,
      },
      {
        key: "ges",
        name: "GES & ministry",
        em: "data sharing",
        icon: "G",
        tone: "navy",
        desc: "What aggregate, anonymised data Omnischools may share with the Ministry for performance monitoring.",
        href: "/settings/ges",
        soon: true,
      },
    ],
  },
];

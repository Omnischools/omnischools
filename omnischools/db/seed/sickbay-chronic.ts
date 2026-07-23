import "../_loadenv";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  schools,
  sickbayChronicEntry,
  sickbayChronicMed,
  sickbayScheduleSlot,
  students,
  users,
} from "@/db/schema";

/**
 * CHRONIC REGISTER demo seed for Asankrangwa (SHS module 4.4 / INCR-23a · R127) — the "demo six must
 * be REAL". Six care-plan entries across FIVE seeded students in real seeded Houses (Aggrey ·
 * Guggisberg · Fraser · Aryee — NOT the Kufuor/Nkrumah drift), reviewed by the seeded Matron, so §01,
 * §02 and §03 render live data and the Headmaster carve-out (R116) is demoable:
 *   • ONE MENTAL_HEALTH entry (Joseph Manu) → the Headmaster's register shows 5 of 6, his SQL cannot
 *     return the sixth;
 *   • ONE multi-condition student (Adwoa Mensa · SCD + asthma → two entries) → the (student × condition)
 *     model (R91) is visible;
 *   • all three statuses (ACTIVE_CRISIS · MONITOR · STABLE);
 *   • med rows on every on-site-treatable plan, scheduled against the school's real MEDICATION_ROUND
 *     slots + PRN lines; the MENTAL_HEALTH plan carries NONE (R102).
 *
 * It also RENAMES the seeded `Abena Mensah` (ASK-24-0142) → `Adwoa Mensa` — one string that makes the
 * canonical cross-surface demo case real (asankrangwa.ts carries the same rename for a fresh install;
 * this scoped UPDATE makes it real on an already-seeded dev DB without re-running the non-idempotent
 * baseline).
 *
 * MARKER-SCOPED + RE-RUN-SAFE. The four sickbay_chronic_* tables belong to this module ALONE, so a
 * school-scoped delete of `sickbay_chronic_entry` (cascading to med/grant/read via FK) is safe in the
 * way a `where schoolId` on a shared table never is (repo memory `seed-cleanup-must-be-scoped`).
 * Nothing else is touched: students, houses, classes, the sickbay spine are read-only here.
 *
 * Run AFTER `pnpm db:seed` and `pnpm db:seed-sickbay`. `pnpm db:seed-sickbay-chronic`
 */

const GES_CODE = "WR-WAW-014";
const MATRON_PHONE = "+233244000005"; // Mrs Akua Bediako, seeded by db:seed-sickbay
const ADWOA_CODE = "ASK-24-0142";

const R = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000); // n days ago

type MedSeed = {
  drugName: string;
  doseLabel: string;
  // "morning" | "evening" | null(=PRN) — resolved to a real MEDICATION_ROUND slot id below.
  round: "morning" | "evening" | null;
  note?: string;
};

type EntrySeed = {
  studentCode: string;
  condition: (typeof sickbayChronicEntry.condition.enumValues)[number];
  conditionLabel: string;
  status: (typeof sickbayChronicEntry.status.enumValues)[number];
  version: number;
  reviewedAt: Date;
  onSiteTreatable?: boolean;
  referralManaged?: boolean;
  conditionDetail?: string;
  baselineStatus?: string;
  careGoals?: string;
  emergencyProtocol?: string;
  dischargeCriteria?: string;
  triggers?: string;
  redFlags?: string;
  firstAction?: string;
  externalClinicalHome?: string;
  externalPastoralHome?: string;
  externalCareCadence?: string;
  externalNextVisitAt?: Date;
  meds: MedSeed[];
};

const ENTRIES: EntrySeed[] = [
  // 1 · Adwoa Mensa — sickle cell, in crisis (the canonical cross-surface case)
  {
    studentCode: ADWOA_CODE,
    condition: "SICKLE_CELL",
    conditionLabel: "Sickle cell disease · HbSS",
    status: "ACTIVE_CRISIS",
    version: 4,
    reviewedAt: R(6),
    conditionDetail:
      "Homozygous HbSS, diagnosed in early childhood at Korle Bu. Chronic anaemia with vaso-occlusive " +
      "crises three to five times a year; splenic dysfunction since age eight. Currently in a pain crisis.",
    baselineStatus:
      "Hb baseline 7.8 g/dL (anaemia of SCD, stable). HbF improving on hydroxyurea. Last outpatient " +
      "review at KATH haematology; next review due in three months.",
    careGoals:
      "Zero school days lost to preventable crisis. Hydroxyurea adherence above 95%. Examination " +
      "accommodations: extra time, a separate room and water access.",
    emergencyProtocol:
      "Recognise a crisis early: severe limb, back or abdominal pain, fever or breathlessness.\n\n" +
      "Start oral hydration and paracetamol; call the on-call doctor if pain is not settling within an " +
      "hour or oxygen saturation falls.\n\n" +
      "Refer to Asankrangwa Govt. Hospital for any chest pain, breathlessness or priapism.",
    dischargeCriteria:
      "Pain controlled on oral analgesia, tolerating fluids, afebrile and mobilising.",
    triggers:
      "Dehydration — especially during harmattan and games. Cold exposure — sleeping under a fan. " +
      "Infection — even minor URTIs; daily Penicillin V prophylaxis. Physical exertion — exempt from " +
      "cross-country. Emotional stress — examination weeks.",
    redFlags: "Severe pain · fever · breathlessness · chest pain",
    firstAction: "Hydrate, give paracetamol, call the matron. Chest pain or breathlessness → hospital now.",
    externalClinicalHome: "KATH paediatric haematology",
    externalCareCadence: "Three-monthly outpatient review",
    meds: [
      { drugName: "Hydroxyurea", doseLabel: "500mg", round: "morning", note: "capsule · with food" },
      { drugName: "Folic acid", doseLabel: "5mg", round: "morning", note: "tablet · with food" },
      { drugName: "Penicillin V", doseLabel: "250mg", round: "evening", note: "prophylaxis" },
      {
        drugName: "Paracetamol",
        doseLabel: "500mg",
        round: null,
        note: "for pain ≥ 4/10, max four times a day",
      },
    ],
  },
  // 2 · Adwoa Mensa — asthma (the multi-condition student, R91)
  {
    studentCode: ADWOA_CODE,
    condition: "ASTHMA",
    conditionLabel: "Asthma · moderate persistent",
    status: "MONITOR",
    version: 2,
    reviewedAt: R(11),
    conditionDetail:
      "Moderate persistent asthma, exercise- and dust-triggered. Two exacerbations last year, none " +
      "needing admission.",
    careGoals: "No night-time symptoms; peak flow within personal best. Inhaler technique checked each term.",
    triggers: "Dust, cold air, chest infections and exertion without a warm-up.",
    redFlags: "Breathlessness at rest · peak flow below 60% · reliever not lasting four hours",
    firstAction: "Salbutamol via spacer, sit upright, call the matron. Not improving → hospital.",
    meds: [
      { drugName: "Beclomethasone", doseLabel: "2 puffs", round: "morning", note: "preventer inhaler" },
      { drugName: "Beclomethasone", doseLabel: "2 puffs", round: "evening", note: "preventer inhaler" },
      { drugName: "Salbutamol", doseLabel: "2 puffs", round: null, note: "before games and for wheeze" },
    ],
  },
  // 3 · Joseph Manu — mental health (referral-managed, no on-site meds; the Headmaster carve-out)
  {
    studentCode: "ASK-24-0118",
    condition: "MENTAL_HEALTH",
    conditionLabel: "Anxiety · referral-managed",
    status: "STABLE",
    version: 2,
    reviewedAt: R(38), // deliberately older → the "needing review" tile has something to count
    conditionDetail:
      "Generalised anxiety with examination-period escalation. Primary care is held by the District " +
      "Mental Health Unit; the sickbay role is monitoring and adherence support, not treatment.",
    careGoals:
      "Attends monthly DMHU appointments. The sickbay recognises warning signs and routes distress; " +
      "there is no on-site medication.",
    triggers: "Withdrawal, sleeplessness, missed meals and examination-week distress.",
    redFlags:
      "Talk of self-harm · sudden withdrawal · two missed DMHU visits → escalate to the counsellor and " +
      "the DMHU.",
    externalClinicalHome: "Asankrangwa District Mental Health Unit",
    externalPastoralHome: "School pastoral system · counsellor",
    externalCareCadence: "Monthly DMHU clinic",
    externalNextVisitAt: R(-20), // ~3 weeks from now
    meds: [], // R102 — a referral-managed plan carries NO on-site medication
  },
  // 4 · Akwasi Boateng — epilepsy
  {
    studentCode: "ASK-24-0143",
    condition: "EPILEPSY",
    conditionLabel: "Epilepsy · well-controlled",
    status: "MONITOR",
    version: 1,
    reviewedAt: R(14),
    conditionDetail:
      "Focal epilepsy, seizure-free for over a year on carbamazepine. Rare nocturnal events.",
    careGoals: "Seizure-free; medication adherence 100%; adequate sleep.",
    triggers: "Missed doses, sleep deprivation, flashing lights and illness with fever.",
    redFlags: "Seizure longer than five minutes · repeated seizures · injury → hospital.",
    firstAction: "Protect from injury, time the seizure, recovery position, call the matron.",
    meds: [
      { drugName: "Carbamazepine", doseLabel: "200mg", round: "morning", note: "with food" },
      { drugName: "Carbamazepine", doseLabel: "200mg", round: "evening", note: "with food" },
    ],
  },
  // 5 · Ama Asante — anaphylaxis (PRN-only meds)
  {
    studentCode: "ASK-24-0144",
    condition: "ALLERGY",
    conditionLabel: "Anaphylaxis · peanut",
    status: "STABLE",
    version: 1,
    reviewedAt: R(9),
    conditionDetail:
      "Severe peanut allergy with prior anaphylaxis. The kitchen is briefed; she carries an adrenaline " +
      "auto-injector at all times.",
    careGoals: "Zero exposures. Auto-injector in date and with her. Kitchen segregation maintained.",
    triggers: "Peanut and traces; cross-contamination in shared servings.",
    redFlags: "Lip or throat swelling · breathlessness · collapse → adrenaline and hospital now.",
    firstAction:
      "Give the auto-injector into the outer thigh, call the matron, then hospital. Second pen if no " +
      "better in five minutes.",
    meds: [
      {
        drugName: "Adrenaline auto-injector",
        doseLabel: "300mcg",
        round: null,
        note: "on standby · into the outer thigh for anaphylaxis",
      },
      { drugName: "Cetirizine", doseLabel: "10mg", round: null, note: "for a mild allergic reaction" },
    ],
  },
  // 6 · Kwame Boakye — type 1 diabetes
  {
    studentCode: "ASK-24-0147",
    condition: "DIABETES",
    conditionLabel: "Type 1 diabetes",
    status: "STABLE",
    version: 1,
    reviewedAt: R(4),
    conditionDetail:
      "Type 1 diabetes on twice-daily mixed insulin, self-managed with matron supervision at rounds.",
    baselineStatus: "Most recent HbA1c around target. Occasional morning highs.",
    careGoals: "Pre-meal glucose in range; no hypos in class; insulin stored correctly.",
    triggers: "Missed insulin, illness, irregular meals and intense exercise without adjustment.",
    redFlags: "Very high or very low glucose · vomiting · drowsiness → hospital.",
    firstAction:
      "Hypo: fast sugar then a snack. High and unwell: call the matron; ketones or vomiting → hospital.",
    meds: [
      { drugName: "NovoMix 30 insulin", doseLabel: "pre-breakfast dose", round: "morning" },
      { drugName: "NovoMix 30 insulin", doseLabel: "pre-dinner dose", round: "evening" },
    ],
  },
];

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, GES_CODE));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  // ---- 0) Rename the seeded student — one string, made real on the running dev DB ----
  await db
    .update(students)
    .set({ firstName: "Adwoa", lastName: "Mensa" })
    .where(and(eq(students.schoolId, schoolId), eq(students.studentCode, ADWOA_CODE)));

  // ---- 1) The reviewer (the seeded Matron) ----
  const [matron] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, MATRON_PHONE))
    .limit(1);
  if (!matron) {
    console.error("✗ Matron not seeded — run `pnpm db:seed-sickbay` first.");
    process.exit(1);
  }

  // ---- 2) The real MEDICATION_ROUND slots (med rows FK them; a client id is never invented) ----
  const rounds = await db
    .select({
      id: sickbayScheduleSlot.id,
      startsAt: sickbayScheduleSlot.startsAt,
      isAnchor: sickbayScheduleSlot.isAnchor,
    })
    .from(sickbayScheduleSlot)
    .where(
      and(
        eq(sickbayScheduleSlot.schoolId, schoolId),
        eq(sickbayScheduleSlot.kind, "MEDICATION_ROUND"),
        eq(sickbayScheduleSlot.active, true),
      ),
    );
  if (rounds.length === 0) {
    console.error("✗ No active medication rounds — run `pnpm db:seed-sickbay` first.");
    process.exit(1);
  }
  const sorted = [...rounds].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const morningSlot = rounds.find((r) => r.isAnchor)?.id ?? sorted[0].id;
  const eveningSlot = sorted[sorted.length - 1].id;
  const slotFor = (round: "morning" | "evening" | null): string | null =>
    round === "morning" ? morningSlot : round === "evening" ? eveningSlot : null;

  // ---- 3) The demo students, by code ----
  const codes = [...new Set(ENTRIES.map((e) => e.studentCode))];
  const studentRows = await db
    .select({ id: students.id, code: students.studentCode })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.studentCode, codes)));
  const idByCode = new Map(studentRows.map((s) => [s.code, s.id]));
  const missing = codes.filter((c) => !idByCode.has(c));
  if (missing.length > 0) {
    console.warn(`• Skipping entries for un-seeded students: ${missing.join(", ")} (run \`pnpm db:seed\`).`);
  }

  // ---- 4) Marker-scoped cleanup — the whole module is the marker; the entry delete cascades ----
  await db.delete(sickbayChronicEntry).where(eq(sickbayChronicEntry.schoolId, schoolId));

  // ---- 5) Insert the entries + their med rows ----
  let entryCount = 0;
  let medCount = 0;
  for (const e of ENTRIES) {
    const studentId = idByCode.get(e.studentCode);
    if (!studentId) continue;
    // R96 — MENTAL_HEALTH is referral-managed and not on-site treated (the DB CHECK enforces it too).
    const mh = e.condition === "MENTAL_HEALTH";
    const [row] = await db
      .insert(sickbayChronicEntry)
      .values({
        schoolId,
        studentId,
        condition: e.condition,
        conditionLabel: e.conditionLabel,
        status: e.status,
        onSiteTreatable: mh ? false : e.onSiteTreatable ?? true,
        referralManaged: mh ? true : e.referralManaged ?? false,
        conditionDetail: e.conditionDetail ?? null,
        baselineStatus: e.baselineStatus ?? null,
        careGoals: e.careGoals ?? null,
        emergencyProtocol: e.emergencyProtocol ?? null,
        dischargeCriteria: e.dischargeCriteria ?? null,
        triggers: e.triggers ?? null,
        redFlags: e.redFlags ?? null,
        firstAction: e.firstAction ?? null,
        externalClinicalHome: e.externalClinicalHome ?? null,
        externalPastoralHome: e.externalPastoralHome ?? null,
        externalCareCadence: e.externalCareCadence ?? null,
        externalNextVisitAt: e.externalNextVisitAt ?? null,
        version: e.version,
        reviewedAt: e.reviewedAt,
        reviewedByUserId: matron.id,
      })
      .returning({ id: sickbayChronicEntry.id });
    entryCount++;

    if (e.meds.length > 0) {
      await db.insert(sickbayChronicMed).values(
        e.meds.map((m) => ({
          schoolId,
          entryId: row.id,
          drugName: m.drugName,
          doseLabel: m.doseLabel,
          isPrn: m.round === null,
          slotId: slotFor(m.round),
          note: m.note ?? null,
        })),
      );
      medCount += e.meds.length;
    }
  }

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: matron.id,
    actorRole: "MATRON",
    actionType: "created",
    entityType: "sickbay_chronic_entry",
    entityId: schoolId,
    afterState: { entries: entryCount, meds: medCount, mentalHealth: 1, multiCondition: "Adwoa Mensa" },
    reason: "Chronic register demo seed (INCR-23a)",
  });

  console.log(
    `✓ Seeded chronic register — ${entryCount} entries (1 mental-health · Adwoa Mensa multi-condition), ` +
      `${medCount} med rows. Headmaster sees ${entryCount - 1} of ${entryCount}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Chronic register seed failed:", err);
    process.exit(1);
  });

import "@/db/_loadenv";
import { eq } from "drizzle-orm";
import { onboardSchool } from "@/lib/actions/onboarding";
import { db } from "@/lib/db";
import {
  schools,
  schoolProducts,
  academicPeriod,
  roleAssignments,
  auditLog,
} from "@/db/schema";

// End-to-end check: the onboarding action creates a school + related rows in the dev DB.
const GES = "TEST-ONB-001";

async function main() {
  // clean any prior run
  await db.delete(schools).where(eq(schools.gesCode, GES));

  const res = await onboardSchool({
    schoolName: "Test Onboard SHS",
    gesCode: GES,
    region: "Ashanti",
    district: "Kumasi Metro",
    product: "SENIOR",
    ownership: "PRIVATE",
    headmasterName: "H. Test",
    headmasterPhone: "0240000010",
    adminName: "A. Test",
    adminPhone: "0240000011",
  });
  console.log("onboard result:", res);
  if (!res.ok) process.exit(1);

  const [school] = await db.select().from(schools).where(eq(schools.gesCode, GES));
  const products = await db
    .select()
    .from(schoolProducts)
    .where(eq(schoolProducts.schoolId, school.id));
  const periods = await db
    .select()
    .from(academicPeriod)
    .where(eq(academicPeriod.schoolId, school.id));
  const assignments = await db
    .select()
    .from(roleAssignments)
    .where(eq(roleAssignments.schoolId, school.id));
  const audits = await db.select().from(auditLog).where(eq(auditLog.schoolId, school.id));

  console.log(`school=${school.name} type=${school.schoolType}`);
  console.log(
    `products=${products.map((p) => p.product).join(",")} periods=${periods.length} roleAssignments=${assignments.length} audit=${audits.length}`,
  );

  const pass =
    school.schoolType === "SENIOR" &&
    products.length === 1 &&
    assignments.length === 2 &&
    audits.length === 1;

  // cleanup (cascades products, periods, assignments, audit)
  await db.delete(schools).where(eq(schools.gesCode, GES));

  console.log(pass ? "\n✓ Onboarding verified." : "\n✗ Onboarding assertions failed.");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-onboarding error:", err);
  process.exit(1);
});

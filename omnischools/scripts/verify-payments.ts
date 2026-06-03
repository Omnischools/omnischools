import "@/db/_loadenv";
import { eq } from "drizzle-orm";
import { createStudent } from "@/lib/actions/students";
import { issueInvoice, recordPayment, voidPayment } from "@/lib/actions/fees";
import { db } from "@/lib/db";
import { students, invoices, payments, receipts } from "@/db/schema";
import { num } from "@/lib/fees-helpers";

// End-to-end fees flow against the dev active school (Asankrangwa).
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

async function invoiceState(studentId: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.studentId, studentId));
  return inv;
}

async function main() {
  // 1. create a throwaway student
  const cs = await createStudent({
    firstName: "Fee",
    lastName: "Tester",
    sex: "MALE",
    guardianName: "G. Tester",
    guardianPhone: "0240000088",
  });
  if (!cs.ok) {
    console.error("createStudent failed", cs);
    process.exit(1);
  }
  const sid = cs.studentId;

  // 2. issue invoice: 600 subtotal - 100 discount = 500 billed
  const inv = await issueInvoice({
    studentId: sid,
    discountAmount: 100,
    lineItems: [{ description: "Tuition", amount: 600 }],
  });
  check(
    "issue invoice ok",
    inv.ok,
    inv.ok
      ? `${inv.invoiceNumber} billed ${inv.billed}`
      : (inv as { error: string }).error,
  );
  if (inv.ok) check("billed = 500", inv.billed === 500);
  let s = await invoiceState(sid);
  check(
    "invoice ISSUED, balance 500",
    s.status === "ISSUED" && num(s.balanceAmount) === 500,
  );

  // 3. partial cash payment 200
  const p1 = await recordPayment({ studentId: sid, method: "CASH", grossAmount: 200 });
  check(
    "payment 1 ok + receipt",
    p1.ok,
    p1.ok ? p1.receiptNumber : (p1 as { error: string }).error,
  );
  s = await invoiceState(sid);
  check(
    "invoice PARTIAL, paid 200 / balance 300",
    s.status === "PARTIAL" && num(s.paidAmount) === 200 && num(s.balanceAmount) === 300,
  );

  // 4. full momo payment 300
  const p2 = await recordPayment({
    studentId: sid,
    method: "MTN_MOMO",
    grossAmount: 300,
  });
  check("payment 2 ok", p2.ok);
  s = await invoiceState(sid);
  check("invoice PAID, balance 0", s.status === "PAID" && num(s.balanceAmount) === 0);

  const receiptCount = (
    await db.select().from(receipts).where(eq(receipts.studentId, sid))
  ).length;
  check("two receipts generated", receiptCount === 2, `count=${receiptCount}`);

  // 5. void the momo payment → back to PARTIAL
  if (p2.ok) {
    const v = await voidPayment({ paymentId: p2.paymentId });
    check("void ok", v.ok);
  }
  s = await invoiceState(sid);
  check(
    "after void: PARTIAL, balance 300",
    s.status === "PARTIAL" && num(s.balanceAmount) === 300,
  );

  // cleanup (payments first → cascades allocations + receipts, then invoices, then student)
  await db.delete(payments).where(eq(payments.studentId, sid));
  await db.delete(invoices).where(eq(invoices.studentId, sid));
  await db.delete(students).where(eq(students.id, sid));

  console.log(
    failures === 0 ? "\n✓ Fees flow verified." : `\n✗ ${failures} assertion(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-payments error:", err);
  process.exit(1);
});

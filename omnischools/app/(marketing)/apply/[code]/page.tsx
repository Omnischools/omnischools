import { eq } from "drizzle-orm";
import { withoutTenantScope } from "@/lib/db/rls";
import { schools } from "@/db/schema";
import { ApplyForm } from "@/components/admissions/apply-form";

export const dynamic = "force-dynamic";

export default async function ApplyPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code);
  const found = await withoutTenantScope((tx) =>
    tx.select({ name: schools.name }).from(schools).where(eq(schools.gesCode, code)),
  );
  const school = found[0];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      {!school ? (
        <div className="border-border-2 bg-surface rounded-2xl border border-dashed p-12 text-center">
          <h1 className="font-display text-2xl font-semibold text-navy">
            School not found
          </h1>
          <p className="mt-2 text-sm text-navy-3">
            The application link <span className="font-mono">{code}</span> doesn&apos;t
            match a school. Please check the link from the school.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-8 text-center">
            <div className="mb-3 inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
              Admission application
            </div>
            <h1 className="font-display text-4xl font-semibold text-navy">
              {school.name}
            </h1>
            <p className="mt-2 text-sm text-navy-2">
              Complete the form below. The school reviews each application and contacts
              the guardian by SMS.
            </p>
          </div>
          <ApplyForm schoolCode={code} />
        </>
      )}
    </main>
  );
}

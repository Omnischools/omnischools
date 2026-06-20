import Link from "next/link";
import { eq } from "drizzle-orm";
import { withoutTenantScope } from "@/lib/db/rls";
import { invites, schools } from "@/db/schema";
import { roleLabel } from "@/lib/staff-roles";
import { AcceptForm } from "@/components/auth/accept-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invite" };

function maskPhone(p: string) {
  return p.length > 6 ? `${p.slice(0, 7)} •••• ${p.slice(-2)}` : p;
}

export default async function AcceptInvitePage({
  params,
}: {
  params: { token: string };
}) {
  const data = await withoutTenantScope(async (tx) => {
    const [inv] = await tx
      .select({
        id: invites.id,
        role: invites.role,
        fullName: invites.fullName,
        phone: invites.phone,
        email: invites.email,
        status: invites.status,
        expiresAt: invites.expiresAt,
        schoolName: schools.name,
        schoolType: schools.schoolType,
      })
      .from(invites)
      .innerJoin(schools, eq(invites.schoolId, schools.id))
      .where(eq(invites.token, params.token));
    return inv ?? null;
  });

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <main className="mx-auto flex min-h-[80vh] max-w-content items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-md">
        {children}
      </div>
    </main>
  );

  if (!data) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-navy">
          Invite not found
        </h1>
        <p className="mt-2 text-sm text-navy-3">
          This invite link isn&apos;t valid. Ask your school to resend it.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-gold">
          ← Home
        </Link>
      </Shell>
    );
  }

  const invalid =
    data.status !== "PENDING"
      ? "This invite has already been used or was revoked."
      : data.expiresAt && data.expiresAt.getTime() < Date.now()
        ? "This invite has expired — ask your school to resend it."
        : null;

  if (invalid) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-navy">
          Invite unavailable
        </h1>
        <p className="mt-2 text-sm text-navy-3">{invalid}</p>
        <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-gold">
          Go to sign in →
        </Link>
      </Shell>
    );
  }

  const tier = data.schoolType.charAt(0) + data.schoolType.slice(1).toLowerCase();

  return (
    <Shell>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">
        You&apos;re invited on Omnischools
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-navy font-display text-base font-semibold italic text-gold-soft">
          {data.schoolName.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="font-display text-base font-semibold text-navy">
            {data.schoolName}
          </div>
          <div className="text-xs text-navy-3">{tier}</div>
        </div>
      </div>

      <h1 className="mt-5 font-display text-2xl font-semibold text-navy">
        Welcome, {data.fullName.split(" ")[0]}.
      </h1>
      <p className="mt-1 text-sm text-navy-3">
        You&apos;ve been added as{" "}
        <span className="font-semibold text-navy">
          {roleLabel(data.role)}
        </span>
        . Set a password to get started.
      </p>

      <div className="mt-5">
        <AcceptForm token={params.token} contact={maskPhone(data.phone ?? "")} />
      </div>
    </Shell>
  );
}

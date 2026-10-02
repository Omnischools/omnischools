import type { ReactNode } from "react";
import { getAdminSession, adminConsoleConfigured } from "@/lib/provisioning/admin-auth";
import { AdminShell } from "@/components/oversight/admin-shell";
import { PageBody, PageHead } from "@/components/oversight/shell";
import { Banner } from "@/components/oversight/primitives";

export const dynamic = "force-dynamic";

export const metadata = { title: "Oversight Admin · Omnischools" };

/**
 * THE ADMIN CONSOLE'S ROLE GATE (Kofi R7 · Lucy G8/R10).
 *
 * Middleware has already established that there is a verified, MFA'd, unexpired Supabase session
 * (it protects every path by default). This layout decides the thing middleware cannot: whether that
 * identity is an OMNISCHOOLS ADMINISTRATOR — which is a different question from "is a senior GES
 * officer", and is answered by `lib/provisioning/admin-auth.ts`:
 *
 *   · an explicit allow-list of Omnischools staff uids (unset ⇒ nobody, fail closed), AND
 *   · NOT a provisioned GES officer, at any tier including NATIONAL.
 *
 * The refusal below is identical whatever the reason — not an administrator, a GES officer who
 * wandered in, an unconfigured deployment — so this page cannot be used to learn who is one.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await getAdminSession();

  if (!admin) {
    return (
      <AdminShell adminName="Not authorised">
        <PageHead
          crumb="Oversight administration"
          title={
            <>
              Not <em className="accent-italic">authorised.</em>
            </>
          }
          lede="This console is operated by Omnischools and provisions GES Oversight accounts."
        />
        <PageBody>
          <Banner tone="gold" glyph="⊘" title="You don't have access to this console.">
            Officer provisioning is an Omnischools operations function. A GES Oversight officer
            session — at any tier, including national — is not sufficient, by design: the most
            senior reader of the data must not also be able to decide who may read it.
          </Banner>
          {adminConsoleConfigured() ? null : (
            <p className="text-xs text-navy-3">
              This deployment has no provisioning configuration (`OVERSIGHT_ADMIN_UIDS` /
              `PROVISIONER_DATABASE_URL`), so the console refuses for everybody. That is the
              fail-closed default and needs no repair unless provisioning is meant to happen
              here.
            </p>
          )}
        </PageBody>
      </AdminShell>
    );
  }

  return <AdminShell adminName={admin.displayName}>{children}</AdminShell>;
}

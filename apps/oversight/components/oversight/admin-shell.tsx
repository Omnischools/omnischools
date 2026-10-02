import Link from "next/link";
import type { ReactNode } from "react";

/**
 * THE ADMIN CONSOLE'S OWN CHROME (Lucy G8).
 *
 * Deliberately NOT the GES shell. Lucy's map is explicit: the provisioning console "must be visually
 * and structurally distinct from the GES Oversight app — it is operated by Omnischools staff, not
 * GES". So the crest reads **Omnischools · Oversight Admin** and there is no gold `GES` mark, no
 * "Your jurisdiction" chip and no officer nav. Someone who lands here must not be able to mistake it
 * for a government surface, because the thing it does — granting and withdrawing oversight authority
 * — is Omnischools' internal control, not a GES function.
 *
 * It reuses the TOKENS and the primitives (one brand, one set of colours); what differs is the
 * composition and every label.
 */
const ADMIN_NAV = [
  { href: "/admin/officers", label: "Provisioned officers" },
  { href: "/admin/officers/provision", label: "Provision an officer" },
  { href: "/admin/officers/approvals", label: "Approve a grant" },
] as const;

export function AdminShell({
  adminName,
  children,
}: {
  adminName: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[230px_1fr]">
      <aside className="hidden flex-col justify-between bg-navy p-5 text-bg md:flex">
        <div>
          <div className="leading-tight">
            <div className="font-display text-sm">Omnischools</div>
            <div className="text-bg/60 text-[10px] uppercase tracking-[0.14em]">
              Oversight Admin
            </div>
          </div>

          <p className="text-bg/70 border-border-2/20 bg-bg/5 mt-5 rounded-md border px-3 py-2 text-[11px]">
            Internal operations console. Officer accounts are provisioned here — officers
            never self-register.
          </p>

          <nav className="mt-6 space-y-1">
            {ADMIN_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-bg/80 hover:bg-bg/10 block rounded px-2 py-1 text-xs"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="text-bg/60 text-[10px]">
          <div className="text-xs text-bg">{adminName}</div>
          <div>Omnischools administrator</div>
          <div className="mt-3">Not a GES surface</div>
        </div>
      </aside>

      <div className="min-h-screen bg-bg">{children}</div>
    </div>
  );
}

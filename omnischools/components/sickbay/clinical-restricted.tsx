/**
 * The ADMIN restriction panel (SHS module 4.4 / INCR-22a · owner D2 · AC Z2).
 *
 * ADMIN keeps MODULE access — the route resolves, it is not a 404 and not a redirect — but gets NO
 * clinical detail. The page returns this INSTEAD of fetching the record, so nothing clinical exists
 * in the flight payload to hide: no complaint, no working impression, no vital, no consult.
 *
 * It names the restriction honestly and does NOT promise a grant that does not exist yet: the
 * per-student, expiring grant is INCR-23. The escape that IS real today is stated — clinical read
 * travels with the MATRON role, so an administrator who genuinely runs the sickbay holds it.
 *
 * A server component with no props and no data access, deliberately: there is nothing to pass.
 */
export function ClinicalRestricted() {
  return (
    <div className="mx-auto max-w-page px-6 pb-16 pt-6 md:px-9">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        <a href="/senior/sickbay/setup" className="text-gold no-underline">
          Sickbay
        </a>{" "}
        · Visit record
      </div>
      <h1 className="font-display text-[28px] font-medium leading-[1.1] tracking-[-0.018em] text-navy">
        Clinical detail is <em className="font-normal italic text-gold">restricted.</em>
      </h1>
      <div className="mt-5 max-w-[720px] rounded-[10px] border border-dashed border-border-2 bg-bg p-[18px_20px]">
        <p className="text-[13px] leading-[1.65] text-navy-2">
          Sickbay visit records — the presenting complaint, the Matron&rsquo;s working impression,
          vitals and the doctor&rsquo;s consult — are readable by the{" "}
          <b className="font-semibold text-navy">Matron</b> and the{" "}
          <b className="font-semibold text-navy">Headmaster</b> only. Your administrator account
          reaches the sickbay module and its setup, not a student&rsquo;s clinical record.
        </p>
        <p className="mt-3 text-[13px] leading-[1.65] text-navy-2">
          Clinical read travels with the Matron role. If you run the sickbay yourself, that role is
          the right way to hold it.
        </p>
      </div>
      {/* The surfaces' non-disclosure line here reads "Diagnosis stays inside the sickbay module per
          privacy default." It is preserved verbatim for INCR-25's referral log; at 22a it cannot be
          rendered, because R43 forbids that word appearing in any label this increment ships. The
          rule it states is enforced above regardless. */}
      <p className="mt-4 text-[12px] italic text-navy-3">
        Clinical detail stays inside the sickbay module per privacy default.
      </p>
    </div>
  );
}

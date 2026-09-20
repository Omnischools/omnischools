import Link from "next/link";
import { TemplateDownloadLink } from "./template-download-link";

type Path = {
  icon: string;
  iconSmall?: boolean;
  pre: string;
  gold: string;
  body: string;
  meta: string;
  cta: string;
  href: string;
  recommended?: boolean;
};

const PATHS: Path[] = [
  {
    icon: ".csv",
    iconSmall: true,
    pre: "Upload a",
    gold: "spreadsheet",
    body: "If you have a list of students in Excel or Google Sheets — names, classes, parent contacts — this is the fastest way. We validate every row before importing.",
    meta: "Best for · 50+ students",
    cta: "Upload CSV →",
    href: "/students/import",
    recommended: true,
  },
  {
    icon: "+",
    pre: "Add one",
    gold: "by one",
    body: "Type each student in directly. Good for small schools, or for adding new admissions later in the term once your main roster is in.",
    meta: "Best for · Under 50 students",
    cta: "Add manually →",
    href: "/students/new",
  },
  {
    icon: "↓",
    pre: "Import from",
    gold: "another system",
    body: "Migrating from another school management tool? We support direct import from common providers — your data lands here ready to use.",
    meta: "Talk to us · Available on request",
    cta: "Get help →",
    href: "mailto:hello@omnischools.gh?subject=Importing%20students%20from%20another%20system",
  },
];

/** Students module-entry empty state — the path-picker from schoolup-empty-states-modules. */
export function StudentsEmpty() {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-navy-3">Students</div>
      <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
        Add your <em className="text-gold">first students</em>
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm text-navy-3">
        Pick the path that matches what you have on hand. You can mix and match — start with a CSV,
        then add stragglers manually later.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {PATHS.map((p) => (
          <div
            key={p.cta}
            className={`relative flex flex-col rounded-xl border p-6 ${
              p.recommended ? "border-gold bg-gold-bg" : "border-border bg-surface"
            }`}
          >
            {p.recommended && (
              <span className="absolute -top-2.5 left-6 rounded-pill bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-navy">
                Recommended
              </span>
            )}
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-[10px] font-display font-bold text-gold ${
                p.recommended ? "border border-gold-soft bg-surface" : "bg-gold-bg"
              } ${p.iconSmall ? "text-xs" : "text-lg"}`}
              aria-hidden
            >
              {p.icon}
            </div>
            <h3 className="mt-3 font-display text-lg font-semibold text-navy">
              {p.pre} <em className="text-gold">{p.gold}</em>
            </h3>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-navy-2">{p.body}</p>
            <div className="mt-3 border-t border-dashed border-border-2 pt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
              {p.meta}
            </div>
            <Link
              href={p.href}
              className={`mt-3 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
                p.recommended
                  ? "bg-gold text-navy hover:bg-gold-soft"
                  : "text-gold hover:underline"
              }`}
            >
              {p.cta}
            </Link>
          </div>
        ))}
      </div>

      {/* Safety reassurance — every row is validated/previewed before anything is saved.
          (Import-undo / "Settings → Imports" rollback is MVP2, so we don't promise it.) */}
      <div className="mt-4 flex items-start gap-3 rounded-xl bg-green-bg p-4">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green text-sm font-bold text-bg"
          aria-hidden
        >
          ↺
        </span>
        <div>
          <div className="text-sm font-semibold text-green">Nothing happens until you confirm</div>
          <p className="mt-0.5 text-xs leading-relaxed text-navy-2">
            Every CSV row is validated and shown for review before anything is saved — fix the
            flagged rows, then import the clean ones. <b className="text-navy">No surprises</b>, no
            half-imported roster.
          </p>
        </div>
      </div>

      {/* Template strip */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border-2 bg-surface p-4">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gold-bg font-mono text-[10px] font-bold text-gold"
          aria-hidden
        >
          CSV
        </span>
        <p className="flex-1 text-sm text-navy-2">
          <b className="text-navy">Need our template?</b> The format is simple — first &amp; last
          name, gender, date of birth, class, guardian name &amp; phone.
        </p>
        <TemplateDownloadLink />
      </div>
    </div>
  );
}

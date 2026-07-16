import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { BOARDING_ROLES } from "@/lib/access";
import { listAccessibleHouses } from "@/lib/boarding/roster-data";
import { isLightColour } from "@/lib/boarding/roster";

export const dynamic = "force-dynamic";

const GENDER_LABEL: Record<"BOYS" | "GIRLS" | "COED", string> = {
  BOYS: "Boys",
  GIRLS: "Girls",
  COED: "Mixed",
};

export default async function BoardingLandingPage() {
  const { school, user } = await requireSchoolRole(BOARDING_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const current = await getCurrentUser();
  const roles = current?.roles ?? user.roles;
  const userId = current?.id ?? user.id;

  const houses = await listAccessibleHouses(school.id, roles, userId);
  const anyBoarders = houses.some((h) => h.boarderCount > 0);

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools Senior · Boarding
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Houses &amp; <em className="italic text-gold">bed allocation.</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          Every House&apos;s boarders and where each one sleeps. Open a House to see its
          dormitories, the four bunk states and to reassign a boarder within the House.
        </p>
      </div>

      {houses.length === 0 ? (
        <EmptyState
          title="No Houses you can open"
          body="You are not assigned as Housemaster to any House, or this school has no boarding Houses configured."
        />
      ) : !anyBoarders ? (
        <>
          <EmptyState
            title="Boarding is not in use yet"
            body="No active boarders are recorded in these Houses. When students are enrolled as boarders and dormitories are set up, their rosters appear here."
          />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {houses.map((h) => (
              <HouseCardLink key={h.id} house={h} />
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {houses.map((h) => (
            <HouseCardLink key={h.id} house={h} />
          ))}
        </div>
      )}
    </div>
  );
}

function HouseCardLink({
  house,
}: {
  house: {
    id: string;
    name: string;
    colour: string | null;
    gender: "BOYS" | "GIRLS" | "COED" | null;
    capacity: number | null;
    hmName: string | null;
    boarderCount: number;
    dormCount: number;
  };
}) {
  const light = isLightColour(house.colour);
  return (
    <Link
      href={`/senior/boarding/houses/${house.id}/roster`}
      className="group overflow-hidden rounded-xl border border-border bg-surface transition-shadow hover:shadow-md"
    >
      <div
        className={`flex items-center gap-3 px-5 py-4 ${
          light ? "border-b-2 border-border-2" : ""
        }`}
        style={{
          backgroundColor: house.colour ?? "var(--navy)",
          color: light ? "var(--navy)" : "var(--bg)",
        }}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg font-display text-lg font-bold"
          style={{ color: house.colour ?? "var(--navy)" }}
        >
          {house.name.charAt(0).toUpperCase()}
        </span>
        <div>
          <div className="font-display text-lg font-semibold leading-tight">{house.name}</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-80">
            {house.gender ? GENDER_LABEL[house.gender] : "Gender not set"}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-5 py-3 text-[12px] text-navy-3">
        <span>
          <b className="text-navy">{house.boarderCount}</b> boarders ·{" "}
          <b className="text-navy">{house.dormCount}</b> dorms
        </span>
        <span className="text-navy-3 group-hover:text-gold">Open roster →</span>
      </div>
      <div className="border-t border-border px-5 py-2 text-[11px] text-navy-3">
        HM {house.hmName ?? "unassigned"}
      </div>
    </Link>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-navy-3">{body}</p>
    </div>
  );
}

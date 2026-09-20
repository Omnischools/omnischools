import { previewPromotion } from "@/lib/actions/promotion";
import { PromotionRunner } from "@/components/settings/promotion-runner";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Year-end promotion" };

export default async function PromotionPage() {
  const res = await previewPromotion();

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/settings/academic" label="Academic structure" />
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Year-end{" "}
          <em className="not-italic text-gold [font-style:italic]">promotion.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Move every active student up one class for the new academic year and graduate the
          exit year. Follows the KG → Primary → JHS ladder; review and hold back anyone
          repeating before you commit.
        </p>
      </div>

      {!res.ok ? (
        <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">{res.error}</p>
      ) : res.preview.rows.length === 0 ? (
        <EmptyState
          title="No active students to promote."
          body="Add students from the Students module first."
          primary={{ label: "Open Students →", href: "/students" }}
        />
      ) : (
        <PromotionRunner preview={res.preview} />
      )}
    </div>
  );
}

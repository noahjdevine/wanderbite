export type MakeupSpot = {
  id: string;
  restaurantName: string;
};

/**
 * One granted make-up visit per reviewed case. The original visit stays recorded.
 * An empty list renders nothing.
 */
export function MakeupOpportunities({ spots }: { spots: readonly MakeupSpot[] }) {
  if (spots.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="makeup-challenges">
      <h2 id="makeup-challenges" className="m-0 text-lg font-semibold text-wb-ink">
        Make-up challenge
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {spots.map((spot) => (
          <li key={spot.id} className="rounded-2xl border border-[#e3d9c6] bg-[#f4efe6] px-4 py-3">
            <p className="m-0 text-sm font-medium text-wb-ink">One extra visit is ready</p>
            <p className="m-0 mt-1 text-sm text-wb-ink">
              This spot is from a review of {spot.restaurantName}. Your original visit stays on your record.
              It does not add a credit, a badge, or savings.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

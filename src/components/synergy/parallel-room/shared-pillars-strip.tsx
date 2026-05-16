// ── Shared pillars strip ──
//
// Renders the 1-3 goal-level overlap noun-phrases as hairline-bordered
// pills. The "what we share" line — sits below the header, above the
// divergence callout.

interface Props {
  pillars: string[];
}

export function SharedPillarsStrip({ pillars }: Props) {
  if (pillars.length === 0) return null;
  return (
    <section className="mb-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
        Shared pillars
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pillars.map((p, i) => (
          <span
            key={`${p}-${i}`}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-gray-700"
          >
            {p}
          </span>
        ))}
      </div>
    </section>
  );
}

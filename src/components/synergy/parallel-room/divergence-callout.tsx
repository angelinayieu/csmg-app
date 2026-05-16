// ── Divergence callout ──
//
// LLM-generated sentence about how the two strategies execute
// differently. Persisted on strategy_matches.divergence_summary at
// match-creation time — never regenerated client-side. This is the
// "what gives this room its conversational opening" line.
//
// Read-only. No dismissal in C-1 (could become dismissible per-user
// in a future iteration if it becomes noise after months of room
// activity).

interface Props {
  summary: string | null;
}

export function DivergenceCallout({ summary }: Props) {
  if (!summary || summary.trim().length === 0) return null;
  return (
    <section className="mb-9">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
        How your approaches diverge
      </div>
      <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-gray-700">
        {summary}
      </p>
    </section>
  );
}

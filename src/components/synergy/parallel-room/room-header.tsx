// ── Parallel-room header ──
//
// Top of the doc body. Three lines stacked:
//   1. Kind label + similarity %  (mono caps, gray-500)
//   2. Shared theme               (H1, font-display-tight, 28px)
//   3. Matched-date + pillar count (12px gray-500)
//
// Pure presentational. No interactivity.

interface Props {
  sharedTheme: string;
  similarityScore: number;
  createdAt: string;
  pillarCount: number;
}

export function RoomHeader({
  sharedTheme,
  similarityScore,
  createdAt,
  pillarCount,
}: Props) {
  const matched = formatMatchedDate(createdAt);
  return (
    <header className="mb-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
        Parallel path · {similarityScore}% similar
      </div>
      <h1 className="font-display-tight mt-3 text-[28px] font-semibold leading-[1.1] text-gray-900">
        {sharedTheme}
      </h1>
      <p className="font-numerical mt-2 text-[12.5px] tabular-nums text-gray-500">
        Matched {matched} · {pillarCount} shared pillar
        {pillarCount === 1 ? "" : "s"}
      </p>
    </header>
  );
}

function formatMatchedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

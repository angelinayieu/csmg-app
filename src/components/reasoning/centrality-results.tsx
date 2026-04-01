"use client";

import { Ring } from "@/components/ui/ring";

interface CentralityRanking {
  entity_id: string;
  name: string;
  score: number;
  degree: number;
  broken_paths: number;
  explanation: string;
}

interface CentralityResultsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export function CentralityResults({ result }: CentralityResultsProps) {
  const rankings = (result?.rankings ?? []) as CentralityRanking[];

  if (rankings.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Centrality Rankings
      </div>
      {rankings.map((r, i) => (
        <div
          key={r.entity_id}
          className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-gray-800">
              <span className="text-gray-400">{r.entity_id}</span> {r.name}
            </div>
            <div className="mt-0.5 text-[10px] text-gray-500">
              {r.degree} connections · {r.broken_paths} paths broken if removed
            </div>
          </div>
          <Ring value={r.score} size={32} showValue />
        </div>
      ))}
    </div>
  );
}

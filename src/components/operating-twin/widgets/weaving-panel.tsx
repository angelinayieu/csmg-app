"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw, ArrowUpRight, Link2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpaceData } from "@/contexts/space-data-context";
import type { RankedBridge } from "@/lib/weaving/rank-bridges";

interface WeavingPanelProps {
  className?: string;
}

interface WeaveEnrichResponse {
  peers_considered: number;
  peers_invoked: Array<{ peer_id: string; peer_name: string; bridges_found: number; error?: string }>;
  new_bridges: number;
  total_bridges: number;
  ranked: RankedBridge[];
  callout: string | null;
}

interface RerankResponse {
  ranked: RankedBridge[];
  total: number;
  has_goal: boolean;
  has_chains: boolean;
}

export function WeavingPanel({ className }: WeavingPanelProps) {
  const ctx = useSpaceData();
  const router = useRouter();

  const [ranked, setRanked] = useState<RankedBridge[]>([]);
  const [totalBridges, setTotalBridges] = useState(0);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [lastEnrichedAt, setLastEnrichedAt] = useState<number | null>(null);

  // Agent B — fetch ranked bridges on mount (fast, deterministic)
  const loadRanked = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/weave/rerank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: ctx.space.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Rerank failed");
      }
      const data = (await res.json()) as RerankResponse;
      setRanked(data.ranked);
      setTotalBridges(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ctx.space.id]);

  useEffect(() => {
    loadRanked();
  }, [loadRanked]);

  // Agent A + C combined — "Re-weave" button
  const runEnrich = useCallback(async () => {
    setEnriching(true);
    setError(null);
    setCallout(null);
    try {
      const res = await fetch("/api/causal-chains/weave-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: ctx.space.id, maxPeers: 3 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error ?? "Weave-enrich failed");
      }
      const data = (await res.json()) as WeaveEnrichResponse;
      setRanked(data.ranked);
      setTotalBridges(data.total_bridges);
      setCallout(data.callout);
      setLastEnrichedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnriching(false);
    }
  }, [ctx.space.id, router]);

  const top = ranked.slice(0, 4);

  return (
    <div
      className={cn(
        "bg-white rounded-[14px] border border-black/5 p-5 flex flex-col gap-3",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 text-white"
          style={{ background: "var(--accent-600, #4F46E5)" }}
        >
          <Link2 className="h-3 w-3" strokeWidth={2.5} />
        </div>
        <h3
          className="text-[13px] font-semibold text-gray-900"
          style={{ letterSpacing: "-0.015em" }}
        >
          Cross-Space Weaving
        </h3>
        <span className="ml-auto font-mono text-[10px] text-gray-500 font-semibold">
          {totalBridges} bridge{totalBridges === 1 ? "" : "s"}
        </span>
      </div>

      {/* Re-weave button */}
      <button
        onClick={runEnrich}
        disabled={enriching || loading}
        className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background: "var(--accent-50, #EEF2FF)",
          color: "var(--accent-700, #3730A3)",
          border: "1px solid var(--accent-100, #C7D2FE)",
        }}
      >
        {enriching ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Re-weaving against your other spaces…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            Re-weave against other spaces
          </>
        )}
      </button>

      {/* Callout */}
      {callout && (
        <div
          className="text-[11.5px] leading-relaxed px-3 py-2 rounded-lg"
          style={{
            background: "var(--accent-50, #EEF2FF)",
            color: "var(--accent-700, #3730A3)",
            border: "1px dashed var(--accent-100, #C7D2FE)",
          }}
        >
          <Sparkles
            className="h-3 w-3 inline mr-1.5 -mt-0.5"
            style={{ color: "var(--accent-600, #4F46E5)" }}
          />
          {callout}
          {lastEnrichedAt && (
            <span className="ml-1.5 font-mono text-[10px] opacity-70">
              · just now
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="text-[11.5px] px-3 py-2 rounded-lg flex items-start gap-1.5"
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#991B1B",
          }}
        >
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Ranked bridges list */}
      {loading && ranked.length === 0 && (
        <div className="text-[11px] text-gray-400 text-center py-3">
          Scoring bridges against your goal…
        </div>
      )}

      {!loading && ranked.length === 0 && !error && (
        <div className="text-[11px] text-gray-400 leading-relaxed">
          No bridges yet. Click <b className="text-gray-600">Re-weave</b> to connect this
          dashboard with your other spaces.
        </div>
      )}

      {top.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div
            className="font-mono text-[9px] font-bold uppercase text-gray-400"
            style={{ letterSpacing: "0.14em" }}
          >
            Most relevant to your goal
          </div>
          {top.map((rb) => (
            <BridgeRow key={rb.bridge.id} rb={rb} />
          ))}
          {ranked.length > top.length && (
            <div className="text-[10px] text-gray-400 text-center pt-1">
              +{ranked.length - top.length} more · sorted by strategic relevance
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BridgeRow({ rb }: { rb: RankedBridge }) {
  const couplingColor =
    rb.bridge.coupling_strength === "strong"
      ? "#047857"
      : rb.bridge.coupling_strength === "moderate"
        ? "#B45309"
        : "#6B7280";

  const scoreTint =
    rb.score >= 2
      ? "#DBEAFE"
      : rb.score >= 1
        ? "var(--accent-50, #EEF2FF)"
        : "#F3F4F6";

  return (
    <div
      className="rounded-lg p-2.5 hover:bg-gray-50 transition-colors cursor-pointer group"
      style={{ border: "0.5px solid rgba(10,11,15,0.08)" }}
    >
      <div className="flex items-start gap-2">
        <div
          className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0 mt-0.5"
          style={{
            background: scoreTint,
            color: rb.score >= 2 ? "#1D4ED8" : rb.score >= 1 ? "var(--accent-700, #3730A3)" : "#374151",
            letterSpacing: "0.08em",
          }}
          title={`Relevance score ${rb.score.toFixed(2)}`}
        >
          {rb.score.toFixed(1)}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[12px] font-semibold text-gray-900 truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {rb.bridge.shared_variable_name}
          </div>
          <div className="text-[10.5px] text-gray-500 leading-[1.4] line-clamp-1">
            {rb.reasons[0] ?? "no rationale"}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[9.5px] font-semibold">
            <span
              style={{ color: couplingColor }}
              className="uppercase tracking-wider"
            >
              {rb.bridge.coupling_strength}
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500 capitalize">{rb.bridge.bridge_type}</span>
            {rb.chain_id && (
              <>
                <span className="text-gray-300">·</span>
                <span style={{ color: "var(--accent-700, #3730A3)" }}>chain</span>
              </>
            )}
          </div>
        </div>
        <ArrowUpRight
          className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-600 flex-shrink-0 mt-0.5"
          strokeWidth={2}
        />
      </div>
    </div>
  );
}

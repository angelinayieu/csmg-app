"use client";

// ── Outcomes tab ────────────────────────────────────────────────────
//
// The "is this working?" lens. Three sections, top-down:
//
//   1. Pain metrics — the dual-framing scorecard. Refresh button
//      re-runs the extractor (Phase 0 endpoint).
//   2. Proposal fidelity — how faithfully the materialized twin
//      tracks the approved proposal.
//   3. Prediction ledger — recent predictions + resolution state,
//      so the user can see whether the twin's calls are landing.
//
// Phase 1 keeps "Log observation" as a placeholder — Phase 2 wires
// it to the observations table the migration already created.

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { TwinPainMetricCard } from "../parts/twin-pain-metric-card";
import { TwinFidelityStrip } from "../parts/twin-fidelity-strip";
import { TwinPredictionHistory } from "../parts/twin-prediction-history";
import {
  TwinObservationFeed,
  type ObservationFeedHandle,
} from "../parts/twin-observation-feed";
import {
  TwinLatestSnapshotCard,
  type LatestSnapshotCardHandle,
} from "../parts/twin-latest-snapshot-card";
import { LogObservationDialog } from "../parts/dialogs/log-observation-dialog";
import { PainIcon, ObservationIcon } from "@/components/twin/icons/twin-icons";
import { toast } from "@/lib/hooks/use-toast";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Props {
  spaceId: string;
  bundle: TwinPageBundle;
  setBundle: (next: TwinPageBundle) => void;
}

export function TwinOutcomesTab({ spaceId, bundle, setBundle }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [observationDialogOpen, setObservationDialogOpen] = useState(false);
  const observationFeedRef = useRef<ObservationFeedHandle>(null);
  const snapshotCardRef = useRef<LatestSnapshotCardHandle>(null);

  // Refresh the snapshot card whenever the dispatcher fires the
  // `twin:snapshot-captured` window event (emitted right after a
  // successful POST /snapshots). Avoids a full bundle refetch since
  // the snapshot card owns its own data.
  useEffect(() => {
    const handler = () => {
      void snapshotCardRef.current?.refresh();
    };
    window.addEventListener("twin:snapshot-captured", handler);
    return () => window.removeEventListener("twin:snapshot-captured", handler);
  }, []);

  // Re-run the pain extractor, then bust the bundle cache so the next
  // bundle read picks up the new pain_metrics rows.
  const handleRefreshPain = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const extractRes = await fetch(
        `/api/spaces/${spaceId}/twin/extract-pain-metrics`,
        { method: "POST" },
      );
      if (!extractRes.ok) {
        toast.error("Couldn't refresh metrics", {
          description: "The extractor didn't respond. Try again.",
        });
        return;
      }
      const bundleRes = await fetch(
        `/api/spaces/${spaceId}/twin-page-bundle`,
        { cache: "no-store" },
      );
      if (!bundleRes.ok) return;
      const json = (await bundleRes.json()) as { bundle: TwinPageBundle };
      setBundle(json.bundle);
      toast.success("Pain metrics refreshed", {
        description: `${json.bundle.pain_metrics.length} metric${json.bundle.pain_metrics.length === 1 ? "" : "s"} now tracked`,
      });
    } catch (err) {
      console.warn("[outcomes-tab] pain refresh failed:", err);
      toast.error("Couldn't refresh metrics");
    } finally {
      setRefreshing(false);
    }
  }, [spaceId, refreshing, setBundle]);

  return (
    <div className="space-y-6">
      {/* ── Pain metrics section ─────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              <PainIcon size={11} />
              Pain we&apos;re reducing
            </div>
            <h2 className="mt-1 font-display-tight text-[22px] font-semibold leading-tight text-gray-900">
              Baseline → current → target, per friction point
            </h2>
          </div>
          <button
            onClick={handleRefreshPain}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-gray-600 transition hover:bg-black/[0.04] hover:text-gray-900 disabled:opacity-40"
            title="Re-run the pain extractor"
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
            {refreshing ? "Refreshing" : "Refresh metrics"}
          </button>
        </div>

        {bundle.pain_metrics.length === 0 ? (
          <div
            className="rounded-2xl px-7 py-8 text-[13px] leading-relaxed text-gray-500"
            style={{
              background: "var(--glass-card-bg)",
              boxShadow: "var(--shadow-card)",
              backdropFilter: "blur(var(--blur-card))",
              WebkitBackdropFilter: "blur(var(--blur-card))",
            }}
          >
            No pain metrics extracted yet. Click <em>Refresh metrics</em> to
            ask the extractor to find them in your twin&apos;s entities.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {bundle.pain_metrics.map((m) => (
              <TwinPainMetricCard key={m.id} metric={m} />
            ))}
          </div>
        )}
      </section>

      {/* ── Snapshots section ────────────────────────────────────── */}
      <section>
        <TwinLatestSnapshotCard ref={snapshotCardRef} spaceId={spaceId} />
      </section>

      {/* ── Fidelity section ─────────────────────────────────────── */}
      <section>
        <TwinFidelityStrip
          proposalDiff={bundle.proposal_diff}
          latestProposal={bundle.latest_proposal}
        />
      </section>

      {/* ── Prediction ledger ────────────────────────────────────── */}
      <section>
        <TwinPredictionHistory predictions={bundle.prediction_history} />
      </section>

      {/* ── Observation loop ─────────────────────────────────────── */}
      <section>
        <button
          onClick={() => setObservationDialogOpen(true)}
          className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-gray-300 px-6 py-4 text-left transition hover:border-gray-500 hover:bg-white/40"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: "rgba(15,23,42,0.04)",
                color: "var(--accent-500)",
              }}
            >
              <ObservationIcon size={13} />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-gray-700">
                Log an observation
              </div>
              <div className="text-[11.5px] text-gray-500">
                Tell the twin what actually happened — it&apos;ll score it
                against open predictions and recalibrate.
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2.5 py-1 text-[10.5px] font-medium text-white transition group-hover:bg-gray-700">
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            New
          </span>
        </button>
      </section>

      {/* ── Recent observations feed ─────────────────────────────── */}
      <section>
        <TwinObservationFeed
          ref={observationFeedRef}
          spaceId={spaceId}
        />
      </section>

      <LogObservationDialog
        spaceId={spaceId}
        open={observationDialogOpen}
        onClose={() => setObservationDialogOpen(false)}
        onSubmitted={(obs) => {
          // Optimistic prepend to the feed so the user sees their row
          // immediately; refresh in the background to pick up the
          // server-side calibration_applied if the optimistic copy
          // missed any post-write enrichment.
          observationFeedRef.current?.prepend(obs);
          void observationFeedRef.current?.refresh();
          // Also bust the bundle so the next tab navigation picks up
          // the recalibrated pain metrics / coach inputs.
          void (async () => {
            try {
              const res = await fetch(
                `/api/spaces/${spaceId}/twin-page-bundle`,
                { cache: "no-store" },
              );
              if (!res.ok) return;
              const json = (await res.json()) as { bundle: TwinPageBundle };
              setBundle(json.bundle);
            } catch {
              /* non-fatal */
            }
          })();
        }}
      />
    </div>
  );
}

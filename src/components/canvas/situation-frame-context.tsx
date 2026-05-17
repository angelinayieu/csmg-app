"use client";

// ── SituationFrame canvas context ──
//
// Fetches the persisted situation_frame for the current space once on
// mount and re-fetches whenever the painter dispatches
// `interaxis:framing-proposed` / `interaxis:framing-approved` (which
// fire when the frame-panel stage commits a frame mid-run). Provides
// the frame + a memoized lens-support lookup so shapes can render
// attribution without each one doing its own fetch.
//
// Producer: spaces.situation_frame, written by /api/pipeline/frame-panel
// (lib/pipeline/framing-panel.ts → runFramingPanel).
//
// Consumers:
//   - ProbabilitySpaceShellShape: looks up axis → cells → supporting_lenses
//     to render lens-attribution chips on the shell footer + expanded view.
//   - CanvasDivergenceStrip: reads `divergences[]` + `candidate_framings[]`
//     to render the "N lenses framed this differently" chrome strip.
//
// Soft-fail: legacy spaces / mid-pipeline mounts return `frame: null`;
// consumers branch on absence and render nothing rather than spinners.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  SituationFrame,
  FramingDivergence,
  LensWholeFraming,
} from "@/types/situation-frame";
import type { SituationFrameResponse } from "@/app/api/spaces/[id]/situation-frame/route";

interface LensSupportSummary {
  /** Distinct lens IDs that backed the axis (union across its target cells). */
  lenses: string[];
  /** Mean of per-cell `confidence` across the axis's target cells. 0 when
   *  the axis has no resolved cells (legacy / fallback). */
  meanCellConfidence: number;
  /** From AxisProposal.lens_support_count — how many lenses independently
   *  proposed THIS axis (distinct from how many lenses voted required on
   *  the cells the axis covers). Higher = stronger panel consensus on
   *  the axis itself. */
  axisSupportCount: number;
  /** Mirrors AxisProposal.source — distinguishes catalog vs panel-minted. */
  source: "catalog" | "ad_hoc" | null;
}

interface SituationFrameValue {
  frame: SituationFrame | null;
  loading: boolean;
  /** Look up lens attribution + confidence for a specific axis_id. Returns
   *  null when the frame is absent or the axis isn't in the frame (e.g.
   *  legacy shells whose axis predates the panel). */
  getLensSupportForAxis: (axisId: string) => LensSupportSummary | null;
  /** Divergences worth surfacing on the canvas (severity ≥ surface).
   *  Memo'd so the strip can render without re-filtering on every paint. */
  surfaceDivergences: FramingDivergence[];
  /** Candidate framings ordered by per-framing confidence desc. Surfaced
   *  by the divergence strip's CTA count ("see alternatives (N)"). */
  candidateFramings: LensWholeFraming[];
}

const NULL_VALUE: SituationFrameValue = {
  frame: null,
  loading: false,
  getLensSupportForAxis: () => null,
  surfaceDivergences: [],
  candidateFramings: [],
};

const SituationFrameContext = createContext<SituationFrameValue>(NULL_VALUE);

export function useSituationFrame(): SituationFrameValue {
  return useContext(SituationFrameContext);
}

interface ProviderProps {
  spaceId: string;
  children: ReactNode;
}

export function SituationFrameProvider({ spaceId, children }: ProviderProps) {
  const [frame, setFrame] = useState<SituationFrame | null>(null);
  const [loading, setLoading] = useState(false);

  // Track in-flight fetches so a burst of framing events doesn't trigger
  // a fetch storm. The painter can fire `framing-proposed` then
  // `framing-approved` ~200ms apart on auto-approve; we want at most one
  // fetch in flight at a time.
  const inflightRef = useRef<boolean>(false);
  // Track mount status so a stale fetch can't write to unmounted state
  // (canvas remount during navigation).
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchFrame = useCallback(async () => {
    if (!spaceId) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/situation-frame`, {
        credentials: "include",
      });
      if (!res.ok) {
        // 401/403/500 — leave frame as-is so consumers keep last good
        // state. Auth issues will surface elsewhere; this isn't the
        // place to spawn an error toast.
        return;
      }
      const body = (await res.json()) as SituationFrameResponse;
      if (!mountedRef.current) return;
      setFrame(body.frame);
    } catch (err) {
      console.warn("[situation-frame] fetch failed:", err);
    } finally {
      inflightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [spaceId]);

  // Initial fetch on mount.
  useEffect(() => {
    void fetchFrame();
  }, [fetchFrame]);

  // Mid-run refresh: re-fetch when the painter signals a new frame
  // landed. Both events trigger the same fetch — `proposed` brings the
  // initial frame into view, `approved` covers the user picking a
  // different framing from the framing-pick page (or auto-approve).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      void fetchFrame();
    };
    window.addEventListener("interaxis:framing-proposed", handler);
    window.addEventListener("interaxis:framing-approved", handler);
    return () => {
      window.removeEventListener("interaxis:framing-proposed", handler);
      window.removeEventListener("interaxis:framing-approved", handler);
    };
  }, [fetchFrame]);

  // Retry once if the initial fetch arrived before the panel finished
  // writing. Frame-panel typically commits 4-12s after intake, but the
  // canvas mounts within ~500ms of bootstrap. A single 8s retry covers
  // the common case without hammering the endpoint.
  useEffect(() => {
    if (frame !== null) return;
    if (!spaceId) return;
    const t = window.setTimeout(() => {
      void fetchFrame();
    }, 8000);
    return () => window.clearTimeout(t);
  }, [frame, spaceId, fetchFrame]);

  // ── Derived: per-axis lens support lookup ──
  //
  // Joins frame.axes[i].target_cells → frame.cells → supporting_lenses.
  // Memoized on `frame` identity so the lookup function is referentially
  // stable across renders of shape utils (which re-render on every
  // tldraw store tick).
  const getLensSupportForAxis = useCallback(
    (axisId: string): LensSupportSummary | null => {
      if (!frame) return null;
      const axis = frame.axes.find((a) => a.axis_id === axisId);
      if (!axis) return null;
      // Index cells by "layer|category" so cell lookup is O(1) instead
      // of an O(targets * cells) scan per axis lookup.
      const cellKey = (layer: string, category: string) => `${layer}|${category}`;
      const cellIndex = new Map<string, (typeof frame.cells)[number]>();
      for (const c of frame.cells) {
        cellIndex.set(cellKey(c.layer, c.category), c);
      }
      const lensSet = new Set<string>();
      const confidences: number[] = [];
      for (const tc of axis.target_cells) {
        const cell = cellIndex.get(cellKey(tc.layer, tc.category));
        if (!cell) continue;
        for (const l of cell.supporting_lenses) lensSet.add(l);
        if (typeof cell.confidence === "number") {
          confidences.push(cell.confidence);
        }
      }
      const meanCellConfidence =
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0;
      return {
        lenses: Array.from(lensSet).sort(),
        meanCellConfidence,
        axisSupportCount: axis.lens_support_count,
        source: axis.source,
      };
    },
    [frame],
  );

  // ── Derived: surfaceable divergences ──
  //
  // Only `surface` and `block` severities are worth user attention.
  // `note` severity is telemetry-only by design. Pre-filter once so the
  // strip doesn't re-iterate on every render.
  const surfaceDivergences = useMemo(() => {
    if (!frame) return [];
    return frame.divergences.filter(
      (d) => d.severity === "surface" || d.severity === "block",
    );
  }, [frame]);

  // ── Derived: candidate framings sorted by per-framing confidence ──
  //
  // `frame.candidate_framings` is populated by the panel but the order
  // is not guaranteed. The divergence strip's CTA needs a stable
  // confidence-desc ordering so the "best alternative" lands first.
  const candidateFramings = useMemo(() => {
    if (!frame) return [];
    return [...frame.candidate_framings].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
    );
  }, [frame]);

  const value = useMemo<SituationFrameValue>(
    () => ({
      frame,
      loading,
      getLensSupportForAxis,
      surfaceDivergences,
      candidateFramings,
    }),
    [frame, loading, getLensSupportForAxis, surfaceDivergences, candidateFramings],
  );

  return (
    <SituationFrameContext.Provider value={value}>
      {children}
    </SituationFrameContext.Provider>
  );
}

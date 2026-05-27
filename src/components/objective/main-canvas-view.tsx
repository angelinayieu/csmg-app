"use client";

// ── Main Canvas View ──
//
// Stage = "main". Shows the refined core objective in the center
// with the picked sub-objectives forking out as clickable cards.
// Clicking a sub-objective opens its room
// (/app/objective/[spaceId]/sub/[subId]) for the 4-stage layered
// analysis (Phase 5+).
//
// The center node is rendered by <AnnotatedObjectiveCard /> — the
// user's raw text with AI-extracted phrase annotations (dotted
// underlines, hover popovers, optional margin-notes mode).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, Layers, RefreshCw, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  AnnotatedObjectiveCard,
  type ObjectiveAnnotation,
} from "@/components/objective/annotated-objective-card";
import { IncrementalCutLab } from "@/components/objective/incremental-cut-lab";
import { CrossRoomSignalsStrip } from "@/components/objective/cross-room-signals-strip";
import { ConceptMemoryFeedStrip } from "@/components/objective/concept-memory-feed-strip";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import type { ClusterAnalysis } from "@/lib/objective-canvas/cluster-proposals";
import type { ConceptMemoryEntry } from "@/lib/objective-canvas/concept-memory-feed";
import type { RoomDecisionSummary } from "@/lib/objective-canvas/canvas-decisions";
import { CanvasDecisionSurface } from "@/components/objective/canvas-decision-surface";
import { HCDToggle } from "@/components/objective/hcd-toggle";
import { CanvasAutopilotRunner } from "@/components/objective/canvas-autopilot-runner";
// Phase 11.0b — LabNotebookPanel is mounted at the layout level
// (app/objective/[spaceId]/layout.tsx) as a persistent right rail.
// The page-level mount + Notebook button moved out so we don't
// double-render. router stays — IncrementalCutLab still uses it
// (and CanvasAutopilotRunner's onAllComplete refreshes via it).

export interface ApprovedItem {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective";
}

/** Tier 3 — per-lane sub-category breakdown for a sub-objective.
 *  Each row is one category that has ≥1 item in the room. The
 *  three lane arrays compose the categorical tree fork displayed
 *  on the main canvas SubCard. */
export interface LaneBreakdownRow {
  label: string;
  color: string;
  count: number;
}

/** Tier 3 — a chain archetype triple. Each entry is either the
 *  resolved category display data or null (when that item wasn't
 *  categorized). Renders as colored pips with × between. */
export interface SubCardArchetype {
  key: string;
  triple: Array<{ label: string; color: string } | null>;
  count: number;
}

export interface MainCanvasSub {
  id: string;
  title: string;
  description: string | null;
  rationale: string | null;
  /** Entities surfaced under this sub-objective after the user
   *  approved cross-layer correlations in its room (Phase 7).
   *  Empty until at least one edge is approved. */
  approvedItems: ApprovedItem[];
  generatedAt: string | null;
  /** Synthesized room-level negative outcome — populated by the
   *  room generator. Rendered under the sub title as "Counters: …"
   *  so the user sees the causal chain across the canvas. */
  topNegativeOutcome: string | null;
  /** Tier 3 — categorical tree fork per lane. Filtered to
   *  categories that have ≥1 item; sorted by count descending. */
  laneBreakdown: {
    friction: LaneBreakdownRow[];
    mechanism: LaneBreakdownRow[];
    result: LaneBreakdownRow[];
  };
  /** Total item counts per lane — what's the size of the
   *  strategy on this fork? */
  laneTotalCounts: {
    friction: number;
    mechanism: number;
    result: number;
  };
  /** Tier 3 — approved chain archetypes grouped by category
   *  triple. Empty when no chains are approved yet. */
  approvedArchetypes: SubCardArchetype[];
  /** Total number of approved chains (regardless of archetype
   *  grouping). Used in the status pip. */
  approvedPlayCount: number;
}

interface Props {
  spaceId: string;
  objective: string;
  subs: MainCanvasSub[];
  /** Server-rendered annotations on the core objective text.
   *  Empty array = not yet generated; the AnnotatedObjectiveCard
   *  will lazy-fetch on mount. */
  coreAnnotations: ObjectiveAnnotation[];
  /** Variant Lab — the user's revealed top-preferred intent. Passed
   *  through to the incremental cut lab below so the post-confirm
   *  affordance starts pre-set to the right direction. Null for new
   *  users → falls back to "creative" inside the lab. */
  preferredIntent?: SubObjectiveIntent | null;
  /** Cross-room signals — recurring mechanisms / shared root causes
   *  / lens convergence detected by walking entities + edges across
   *  the space's sub-objective rooms. Server-rendered; null when
   *  fewer than 2 rooms exist (no cross-room to compute). */
  crossRoomSignals?: CrossRoomSignals | null;
  /** Persisted sub-objective theme analysis from
   *  /api/brainstorm/space/cluster-sub-objectives. Null until the user
   *  first runs "Detect themes" on the canvas. When present, the
   *  canvas offers a "by theme" view that groups SubCards into
   *  row-per-theme galleries. */
  initialSubObjectiveThemes?: ClusterAnalysis | null;
  /** Ambient KG memory — top canonical concepts the user has been
   *  actively reasoning across (recency × cross-space spread).
   *  Renders as a small chip strip above the cross-room signals so
   *  the user feels their KG accumulating regardless of the current
   *  objective. Empty array hides the strip. */
  conceptMemory?: ConceptMemoryEntry[];
  /** Per-room "what needs your attention" summaries. Empty array
   *  hides the surface. Server-aggregated in page.tsx via
   *  computeRoomDecisionSummaries — no client-side fetches. */
  roomDecisions?: RoomDecisionSummary[];
}

export function MainCanvasView({
  spaceId,
  objective,
  subs,
  coreAnnotations,
  preferredIntent = null,
  crossRoomSignals = null,
  initialSubObjectiveThemes = null,
  conceptMemory = [],
  roomDecisions = [],
}: Props) {
  // Themed view state — same pattern as the picker's cluster view.
  // Default to "grid" so existing users see no change unless they
  // explicitly choose "by theme."
  const [themeView, setThemeView] = useState<"grid" | "themes">(
    initialSubObjectiveThemes && initialSubObjectiveThemes.clusters.length > 0
      ? "themes"
      : "grid",
  );
  // Phase 11.0b — notebook state moved to the layout. router still
  // needed for IncrementalCutLab + CanvasAutopilotRunner refresh.
  const router = useRouter();
  const [themes, setThemes] = useState<ClusterAnalysis | null>(
    initialSubObjectiveThemes,
  );
  const [themesBusy, setThemesBusy] = useState(false);
  const [themesError, setThemesError] = useState<string | null>(null);

  // Staleness — set ids on the cached themes vs the current sub list.
  // When the user adds a sub-objective via the Incremental Cut Lab
  // after themes were computed, the new sub won't appear in any
  // theme until the user re-runs. Surface that as a "stale" badge.
  const themesStale = (() => {
    if (!themes || themes.clusters.length === 0) return false;
    const cachedIds = new Set(
      themes.clusters.flatMap((c) => c.proposal_ids),
    );
    const liveIds = subs.map((s) => s.id);
    if (cachedIds.size !== liveIds.length) return true;
    for (const id of liveIds) if (!cachedIds.has(id)) return true;
    return false;
  })();

  async function runDetectThemes(force = false) {
    setThemesError(null);
    setThemesBusy(true);
    try {
      const res = await fetch(
        "/api/brainstorm/space/cluster-sub-objectives",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            mode: force ? "force" : "default",
          }),
        },
      );
      // Parse defensively. If the server returned HTML (Next.js error
      // page, upstream proxy timeout, etc.), res.json() throws with
      // "Unexpected token …". Catch + show a meaningful message.
      let json: { error?: string; sub_objective_themes?: ClusterAnalysis } = {};
      try {
        json = await res.json();
      } catch {
        setThemesError(
          res.status === 504 || res.status === 408
            ? "Theme detection timed out. Try again — large sub-objective sets can take a while."
            : `Server returned an unexpected response (status ${res.status}). Try again, and check the server logs if it persists.`,
        );
        return;
      }
      if (!res.ok) {
        setThemesError(json?.error ?? "Theme detection failed.");
        return;
      }
      const analysis = json.sub_objective_themes as ClusterAnalysis;
      setThemes(analysis);
      if (analysis.clusters.length > 0) setThemeView("themes");
    } catch (err) {
      setThemesError(
        err instanceof Error ? err.message : "Network error.",
      );
    } finally {
      setThemesBusy(false);
    }
  }
  // Pass the sub list (id + title only) down so the annotated card
  // can resolve linked_sub_objective_id → title for hover popovers.
  const subStubs = subs.map((s) => ({ id: s.id, title: s.title }));

  return (
    <div className="relative mx-auto w-full max-w-5xl">
      {/* Phase 10b/11 — canvas-level toolbar. Notebook trigger +
          HCD toggle + Canvas Autopilot sit top-right as a paired
          cluster so they read as one chrome. HCDToggle self-fetches
          its state on mount; no prop plumbing required from the
          parent. CanvasAutopilotRunner triggers the canvas-wide
          score+refine loop and posts the parent autopilot_run
          event so the notebook can group every per-chain event
          under one header. */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
        <HCDToggle spaceId={spaceId} />
        {/* Only render the canvas autopilot button when at least one
            sub-objective room has been generated. Empty-canvas runs
            would return zero targets anyway; hiding the button
            removes a dead affordance. */}
        {subs.some((s) => s.generatedAt) && (
          <CanvasAutopilotRunner
            spaceId={spaceId}
            onAllComplete={() => {
              // Refresh the page so the new candidates from refine
              // appear in the per-room SubCards + the cross-room
              // signals strip picks up the freshly-rescanned findings.
              router.refresh();
            }}
          />
        )}
        {/* Phase 11.0b — Notebook button removed. The Lab Notebook
            is now a persistent right rail mounted at the layout
            level, default open, collapse-to-strip when hidden. */}
      </div>

      {/* Annotated core objective — the centerpiece */}
      <AnnotatedObjectiveCard
        spaceId={spaceId}
        objective={objective}
        initialAnnotations={coreAnnotations}
        subObjectives={subStubs}
      />

      {/* Concept memory feed — ambient KG signal. Top canonical
          concepts the user has been reasoning across (recency ×
          cross-space spread). Lives above the cross-room signals so
          the user feels their KG even when this specific space hasn't
          accumulated anything yet. Hidden when empty. */}
      {conceptMemory.length > 0 && (
        <div className="mx-auto mt-6">
          <ConceptMemoryFeedStrip
            concepts={conceptMemory}
            currentSpaceId={spaceId}
          />
        </div>
      )}

      {/* Canvas Decision Surface — "what needs your attention" per
          room, aggregated across all rooms in the space. Sits ABOVE
          the cross-room signals strip because actions outrank
          patterns: the user should see what needs DOING before
          browsing what's HAPPENING. Renders nothing when no room
          has pending decisions, so calm canvases stay calm. */}
      {roomDecisions.length > 0 && (
        <div
          className={
            conceptMemory.length > 0
              ? "mx-auto mt-3 w-full max-w-5xl"
              : "mx-auto mt-6 w-full max-w-5xl"
          }
        >
          <CanvasDecisionSurface
            spaceId={spaceId}
            summaries={roomDecisions}
          />
        </div>
      )}

      {/* Cross-room signals — recurring mechanisms, shared root causes,
          lens convergence. Lives between the core card and the
          sub-cards so the user sees structural patterns BEFORE
          diving into individual rooms. Renders only when ≥2 signals
          actually exist; otherwise hidden. */}
      {crossRoomSignals && (
        <div
          className={
            // Tighter top spacing when the Decision Surface above
            // already established the "between core + rooms" zone.
            roomDecisions.length > 0
              ? "mx-auto mt-3 w-full max-w-5xl"
              : conceptMemory.length > 0
                ? "mx-auto mt-3 w-full max-w-5xl"
                : "mx-auto mt-6 w-full max-w-5xl"
          }
        >
          <CrossRoomSignalsStrip
            spaceId={spaceId}
            signals={crossRoomSignals}
          />
        </div>
      )}

      {/* Theme control bar — visible when there are enough sub-
          objectives to make grouping meaningful. Pre-themes: a
          "Detect themes" CTA. Post-themes: a view toggle + refresh
          button (stale-aware). Mounts above the grid so the user
          sees structure before scanning the cards. */}
      {subs.length >= 4 && (
        <div className="mx-auto mt-6 max-w-5xl">
          <ThemeControlBar
            hasThemes={!!themes && themes.clusters.length > 0}
            themeCount={themes?.clusters?.length ?? 0}
            stale={themesStale}
            view={themeView}
            onViewChange={setThemeView}
            onRun={() => runDetectThemes(false)}
            onRerun={() => runDetectThemes(true)}
            busy={themesBusy}
            error={themesError}
          />
        </div>
      )}

      {/* Trunk → fork connector */}
      <div
        aria-hidden
        className={
          // Tight top when ANY surface (decisions / signals / themes)
          // already established the "between core + rooms" zone.
          // Otherwise widen so the trunk reads as the connector
          // between core and rooms across empty space.
          roomDecisions.length > 0 ||
          crossRoomSignals ||
          (themes && themes.clusters.length > 0)
            ? "mx-auto mt-2 h-8 w-px"
            : "mx-auto mt-6 h-8 w-px"
        }
        style={{ background: appleVibe.stroke.medium }}
      />

      {/* Sub-objective cards — either the flat grid (default) or the
          theme-row gallery (when the user has detected themes and is
          viewing "by theme"). */}
      {subs.length === 0 ? (
        <div className="relative mx-auto mt-2 grid w-full gap-5">
          <EmptyState />
        </div>
      ) : themeView === "themes" && themes && themes.clusters.length > 0 ? (
        <ThemedSubGallery
          themes={themes}
          subs={subs}
          spaceId={spaceId}
          stale={themesStale}
        />
      ) : (
        <div
          className="relative mx-auto mt-2 grid w-full gap-5"
          style={{
            gridTemplateColumns:
              subs.length <= 2
                ? "repeat(auto-fit, minmax(280px, 1fr))"
                : "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          {subs.map((sub) => (
            <SubCard key={sub.id} spaceId={spaceId} sub={sub} />
          ))}
        </div>
      )}

      {/* Post-confirm variant lab — lets the user add another cut
          after seeing the initial rooms. Single-batch quota; the
          lab calls /api/brainstorm/sub-objectives/add which keeps
          stage at "main" and only materializes ONE goal at a time. */}
      {subs.length > 0 && (
        <IncrementalCutLab
          spaceId={spaceId}
          preferredIntent={preferredIntent}
        />
      )}

      {/* Phase 11.0b — LabNotebookPanel mount moved to
          src/app/app/objective/[spaceId]/layout.tsx so it persists
          as a right rail across all pages in the objective canvas. */}
    </div>
  );
}


function SubCard({
  spaceId,
  sub,
  representative = false,
}: {
  spaceId: string;
  sub: MainCanvasSub;
  /** Theme gallery — when true, this sub is the LLM-nominated
   *  strongest member of its cluster. Renders a small "Rep" badge
   *  so the user can spot the entry-point card in each theme row. */
  representative?: boolean;
}) {
  const hasApproved = sub.approvedItems.length > 0;
  const status: "pending" | "generated" | "approved" = hasApproved
    ? "approved"
    : sub.generatedAt
      ? "generated"
      : "pending";

  // Categorical tree is renderable when room generation has produced
  // at least one item in any lane. Pre-generation cards stay compact.
  const hasTree =
    sub.laneTotalCounts.friction +
      sub.laneTotalCounts.mechanism +
      sub.laneTotalCounts.result >
    0;

  return (
    <Link
      href={`/app/objective/${spaceId}/sub/${sub.id}`}
      className="group relative flex flex-col gap-2 rounded-3xl p-5 transition-all"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${
          hasApproved ? "rgba(22,163,74,0.25)" : appleVibe.stroke.soft
        }`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = appleVibe.shadow.cardHover;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = appleVibe.shadow.card;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          <Layers className="h-2.5 w-2.5" strokeWidth={2} />
          Sub
        </span>
        <StatusPip
          status={status}
          approvedPlayCount={sub.approvedPlayCount}
        />
        {representative && (
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={{
              background: "rgba(22,163,74,0.10)",
              color: "rgba(20,83,45,0.95)",
              border: "1px solid rgba(22,163,74,0.22)",
            }}
            title="LLM-nominated strongest member of this theme"
          >
            Rep
          </span>
        )}
      </div>

      <h3
        className="text-[15px] font-semibold leading-snug tracking-tight"
        style={{
          color: appleVibe.text.primary,
          fontFamily: appleVibe.font.display,
        }}
      >
        {sub.title}
      </h3>

      {/* Once the room has generated, the LLM-synthesized negative
          outcome IS the most useful subtitle — replaces the raw
          description. Falls back to description before generation. */}
      {sub.topNegativeOutcome ? (
        <p
          className="line-clamp-2 text-[12px] font-light italic leading-snug"
          style={{ color: appleVibe.text.secondary }}
        >
          <span
            className="not-italic font-semibold"
            style={{ color: appleVibe.text.tertiary }}
          >
            Counters:
          </span>{" "}
          {sub.topNegativeOutcome}
        </p>
      ) : (
        sub.description && (
          <p
            className="line-clamp-3 text-[12.5px] font-light leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            {sub.description}
          </p>
        )
      )}

      {/* Categorical tree fork — Tier 3. One row per lane showing
          the dominant sub-categories with counts. Quiet typography;
          color does the work. Only renders when the room has at
          least one item. */}
      {hasTree && (
        <div
          className="mt-1 flex flex-col gap-1 rounded-2xl p-2.5"
          style={{
            background: "rgba(15,23,42,0.025)",
            border: `1px solid ${appleVibe.stroke.hairline}`,
            borderRadius: appleVibe.radius.md,
          }}
        >
          <LaneRow
            label="Problems"
            laneColor={appleVibe.stage.pain}
            total={sub.laneTotalCounts.friction}
            rows={sub.laneBreakdown.friction}
          />
          <LaneRow
            label="Mechanisms"
            laneColor={appleVibe.stage.features}
            total={sub.laneTotalCounts.mechanism}
            rows={sub.laneBreakdown.mechanism}
          />
          <LaneRow
            label="Results"
            laneColor={appleVibe.stage.outcomes}
            total={sub.laneTotalCounts.result}
            rows={sub.laneBreakdown.result}
          />
        </div>
      )}

      {/* Approved plays — Tier 3. Replaces / augments the legacy
          approved chip strip. Shows the category triples grouped
          by archetype with their counts. Quietly hides when nothing
          is approved yet. */}
      {sub.approvedArchetypes.length > 0 ? (
        <div className="mt-1">
          <div
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {sub.approvedPlayCount} approved play
            {sub.approvedPlayCount === 1 ? "" : "s"}
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {sub.approvedArchetypes.slice(0, 3).map((a) => (
              <li
                key={a.key}
                className="flex items-center gap-1 text-[10.5px]"
              >
                <ArchetypeTriple triple={a.triple} />
                {a.count > 1 && (
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    ×{a.count}
                  </span>
                )}
              </li>
            ))}
            {sub.approvedArchetypes.length > 3 && (
              <li
                className="text-[10px] font-light"
                style={{ color: appleVibe.text.tertiary }}
              >
                +{sub.approvedArchetypes.length - 3} more
              </li>
            )}
          </ul>
        </div>
      ) : (
        hasApproved && <ApprovedStrip items={sub.approvedItems} />
      )}

      <div className="mt-1 flex items-center justify-between">
        {sub.rationale ? (
          <span
            className="line-clamp-1 text-[11px] font-light italic"
            style={{ color: appleVibe.text.tertiary }}
            title={sub.rationale}
          >
            {sub.rationale}
          </span>
        ) : (
          <span />
        )}
        <ArrowRight
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
          strokeWidth={2}
          style={{ color: appleVibe.text.secondary }}
        />
      </div>
    </Link>
  );
}

function StatusPip({
  status,
  approvedPlayCount,
}: {
  status: "pending" | "generated" | "approved";
  approvedPlayCount?: number;
}) {
  if (status === "approved") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
        style={{
          background: "rgba(22,163,74,0.12)",
          color: "rgba(20,83,45,0.95)",
        }}
        title={
          approvedPlayCount
            ? `${approvedPlayCount} approved play${approvedPlayCount === 1 ? "" : "s"} ready to promote`
            : undefined
        }
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
        approved
        {approvedPlayCount && approvedPlayCount > 0 && (
          <span
            className="ml-0.5 font-mono"
            style={{ color: "rgba(20,83,45,0.7)" }}
          >
            {approvedPlayCount}
          </span>
        )}
      </span>
    );
  }
  if (status === "generated") {
    return (
      <span
        className="text-[10px] font-medium"
        style={{ color: appleVibe.text.tertiary }}
      >
        Generated · approve from the room
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-medium"
      style={{ color: appleVibe.text.tertiary }}
    >
      Pending · open the room
    </span>
  );
}

const LAYER_COLORS: Record<ApprovedItem["layer"], string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

function ApprovedStrip({ items }: { items: ApprovedItem[] }) {
  const max = 6;
  const shown = items.slice(0, max);
  const overflow = items.length - shown.length;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((it) => (
        <span
          key={it.id}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: `${LAYER_COLORS[it.layer]}14`,
            color: LAYER_COLORS[it.layer],
            maxWidth: 200,
          }}
          title={it.name}
        >
          <span
            className="block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: LAYER_COLORS[it.layer] }}
            aria-hidden
          />
          <span className="truncate">{it.name}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-3xl p-8 text-center"
      style={{
        background: appleVibe.surface.card,
        border: `1px dashed ${appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.xl,
      }}
    >
      <p
        className="text-[13px] font-light"
        style={{ color: appleVibe.text.secondary }}
      >
        No sub-objectives are picked yet. Go back to the picker if you
        want to re-select.
      </p>
    </div>
  );
}

// ── Categorical tree primitives ───────────────────────────────────

function LaneRow({
  label,
  laneColor,
  total,
  rows,
}: {
  label: string;
  laneColor: string;
  total: number;
  rows: LaneBreakdownRow[];
}) {
  if (total === 0) return null;
  // Truncate to top 4 by count; render +N for the rest.
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const shown = sorted.slice(0, 4);
  const overflow = sorted.length - shown.length;
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-[3px] block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: laneColor }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: laneColor }}
          >
            {label}
          </span>
          <span
            className="font-mono text-[9px]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {total}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {shown.length > 0 ? (
            shown.map((r) => (
              <span
                key={r.label}
                className="inline-flex items-center gap-0.5 text-[10.5px] font-medium"
                style={{ color: r.color }}
                title={`${r.label} · ${r.count}`}
              >
                <span
                  className="block h-1 w-1 rounded-full"
                  style={{ background: r.color }}
                  aria-hidden
                />
                {r.label}
                <span
                  className="font-mono text-[9px]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {r.count}
                </span>
              </span>
            ))
          ) : (
            <span
              className="text-[10px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              uncategorized
            </span>
          )}
          {overflow > 0 && (
            <span
              className="text-[10px] font-light"
              style={{ color: appleVibe.text.tertiary }}
            >
              +{overflow}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArchetypeTriple({
  triple,
}: {
  triple: Array<{ label: string; color: string } | null>;
}) {
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {triple.map((t, i) =>
        t ? (
          <span key={i} className="flex items-center gap-0.5">
            <span
              className="font-medium"
              style={{ color: t.color }}
            >
              {t.label}
            </span>
            {i < triple.length - 1 && triple[i + 1] && (
              <span
                className="text-[9px]"
                style={{ color: appleVibe.text.faint }}
              >
                ×
              </span>
            )}
          </span>
        ) : null,
      )}
    </span>
  );
}

// ── Theme control bar ──────────────────────────────────────────────
//
// Pre-themes: a "Detect themes" CTA explaining the value.
// Post-themes: a "by grid / by theme" toggle + refresh (loud when
// the proposal set has changed since the last theming pass).

function ThemeControlBar({
  hasThemes,
  themeCount,
  stale,
  view,
  onViewChange,
  onRun,
  onRerun,
  busy,
  error,
}: {
  hasThemes: boolean;
  themeCount: number;
  stale: boolean;
  view: "grid" | "themes";
  onViewChange: (v: "grid" | "themes") => void;
  onRun: () => void;
  onRerun: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div
      className="border"
      style={{
        background: "#ffffff",
        borderColor: appleVibe.stroke.hairline,
        borderRadius: appleVibe.radius.lg,
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {!hasThemes && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
              style={{
                background:
                  "linear-gradient(180deg, rgba(124,58,237,0.14) 0%, rgba(124,58,237,0.06) 100%)",
                border: `1px solid rgba(124,58,237,0.18)`,
              }}
              aria-hidden
            >
              <Sparkles
                className="h-3.5 w-3.5"
                strokeWidth={1.8}
                style={{ color: "rgba(91,33,182,0.95)" }}
              />
            </span>
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[13px] font-semibold leading-none tracking-[-0.005em]"
                style={{ color: appleVibe.text.primary }}
              >
                Detect themes
              </span>
              <span
                className="text-[11.5px] leading-snug"
                style={{ color: appleVibe.text.tertiary }}
              >
                Group your sub-objectives by shared concept so structure becomes visible
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold transition-all disabled:cursor-wait"
            style={{
              background: busy
                ? "rgba(124,58,237,0.10)"
                : "linear-gradient(180deg, rgba(139,92,246,1) 0%, rgba(124,58,237,1) 100%)",
              color: busy ? "rgba(91,33,182,0.85)" : "#fff",
              boxShadow: busy
                ? "none"
                : "0 1px 0 rgba(255,255,255,0.22) inset, 0 6px 16px -6px rgba(124,58,237,0.55)",
              letterSpacing: "-0.005em",
            }}
          >
            {busy ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={2.2} />
                Detecting…
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" strokeWidth={2.2} />
                Detect themes
              </>
            )}
          </button>
        </div>
      )}

      {hasThemes && (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
              style={{
                background:
                  "linear-gradient(180deg, rgba(124,58,237,0.14) 0%, rgba(124,58,237,0.06) 100%)",
                border: `1px solid rgba(124,58,237,0.18)`,
              }}
              aria-hidden
            >
              <Sparkles
                className="h-3.5 w-3.5"
                strokeWidth={1.8}
                style={{ color: "rgba(91,33,182,0.95)" }}
              />
            </span>
            <div className="flex items-center gap-2">
              <span
                className="text-[13px] font-semibold leading-none tracking-[-0.005em]"
                style={{ color: appleVibe.text.primary }}
              >
                {themeCount} {themeCount === 1 ? "theme" : "themes"}
              </span>
              {stale && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
                  style={{
                    background: "rgba(217,119,6,0.12)",
                    color: "rgba(146,64,14,0.95)",
                  }}
                >
                  stale
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="inline-flex rounded-full p-0.5"
              style={{ background: "rgba(15,23,42,0.05)" }}
            >
              <button
                type="button"
                onClick={() => onViewChange("grid")}
                className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                style={{
                  background: view === "grid" ? "#fff" : "transparent",
                  color:
                    view === "grid"
                      ? appleVibe.text.primary
                      : appleVibe.text.tertiary,
                  boxShadow:
                    view === "grid"
                      ? "0 1px 2px rgba(15,23,42,0.08)"
                      : undefined,
                }}
              >
                grid
              </button>
              <button
                type="button"
                onClick={() => onViewChange("themes")}
                className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                style={{
                  background:
                    view === "themes" ? "#fff" : "transparent",
                  color:
                    view === "themes"
                      ? appleVibe.text.primary
                      : appleVibe.text.tertiary,
                  boxShadow:
                    view === "themes"
                      ? "0 1px 2px rgba(15,23,42,0.08)"
                      : undefined,
                }}
              >
                by theme
              </button>
            </div>
            <button
              type="button"
              onClick={onRerun}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold"
              style={{
                background: stale
                  ? "rgba(217,119,6,0.15)"
                  : appleVibe.surface.chip,
                color: stale
                  ? "rgba(146,64,14,0.95)"
                  : appleVibe.text.tertiary,
                cursor: busy ? "wait" : "pointer",
              }}
              title={
                stale
                  ? "Re-detect themes — sub-objective set has changed"
                  : "Re-detect themes"
              }
            >
              <RefreshCw
                className={
                  busy ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"
                }
                strokeWidth={2}
              />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mx-4 mb-3 -mt-1 rounded-xl px-2.5 py-1.5 text-[11.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ── Themed sub-objective gallery ───────────────────────────────────
//
// Row per theme. Each row carries: theme label + description + count,
// and a horizontal-scroll strip of SubCards. Keeps SubCard render
// untouched — just rehouses it inside a themed container.
//
// Theme ordering: descending member count (most populous theme top).
// Within a theme: order from the LLM's cluster.proposal_ids
// (representative first if present).

function ThemedSubGallery({
  themes,
  subs,
  spaceId,
  stale,
}: {
  themes: ClusterAnalysis;
  subs: MainCanvasSub[];
  spaceId: string;
  stale: boolean;
}) {
  const subsById = new Map(subs.map((s) => [s.id, s] as const));
  const placedIds = new Set<string>();

  // Theme ordering: by member count desc; tie-break on representative
  // appearing in the live sub set (i.e., real not just-deleted ids).
  const ordered = [...themes.clusters].sort(
    (a, b) => b.proposal_ids.length - a.proposal_ids.length,
  );

  return (
    <div className="mx-auto mt-2 flex w-full max-w-5xl flex-col gap-6">
      {ordered.map((cluster) => {
        // Reorder members: representative first, others in original
        // cluster order. Drop ids that no longer exist in the live
        // sub set (deleted sub-objectives) — happens when the user
        // archives a sub after themes were computed.
        const memberSubs: MainCanvasSub[] = [];
        const rep = subsById.get(cluster.representative_id);
        if (rep) {
          memberSubs.push(rep);
          placedIds.add(rep.id);
        }
        for (const id of cluster.proposal_ids) {
          if (id === cluster.representative_id) continue;
          const s = subsById.get(id);
          if (!s) continue;
          memberSubs.push(s);
          placedIds.add(s.id);
        }
        if (memberSubs.length === 0) return null;
        return (
          <section key={cluster.id}>
            <header className="mb-2">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "rgba(91,33,182,0.95)" }}
                >
                  {cluster.label}
                </span>
                <span
                  className="text-[10.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  · {memberSubs.length} sub-objective
                  {memberSubs.length === 1 ? "" : "s"}
                </span>
              </div>
              {cluster.description && (
                <p
                  className="mt-0.5 text-[12px] font-light italic leading-snug"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  {cluster.description}
                </p>
              )}
            </header>
            <div
              className="flex w-full gap-4 overflow-x-auto pb-2"
              style={{ scrollbarWidth: "thin" }}
            >
              {memberSubs.map((sub) => (
                <div
                  key={sub.id}
                  className="flex-shrink-0"
                  style={{ width: 280 }}
                >
                  <SubCard
                    spaceId={spaceId}
                    sub={sub}
                    representative={sub.id === cluster.representative_id}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* Orphan rescue — sub-objectives added after themes were
          computed don't belong to any cluster yet. Surface them in a
          dedicated row so they don't disappear. Cleared automatically
          once themes are re-detected (stale → fresh). */}
      {stale &&
        (() => {
          const orphans = subs.filter((s) => !placedIds.has(s.id));
          if (orphans.length === 0) return null;
          return (
            <section>
              <header className="mb-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: "rgba(146,64,14,0.95)" }}
                  >
                    Added since last themed
                  </span>
                  <span
                    className="text-[10.5px] font-light"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    · re-detect to place these in a theme
                  </span>
                </div>
              </header>
              <div
                className="flex w-full gap-4 overflow-x-auto pb-2"
                style={{ scrollbarWidth: "thin" }}
              >
                {orphans.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex-shrink-0"
                    style={{ width: 280 }}
                  >
                    <SubCard spaceId={spaceId} sub={sub} />
                  </div>
                ))}
              </div>
            </section>
          );
        })()}
    </div>
  );
}

"use client";

// ── PromptSharpeningCardShapeUtil ──
//
// The first intake intelligence object. Lands on the board connected below
// the objective card. Collapsed: distilled title + sharpened prompt + the 3
// highest-priority ambiguity chips. Expanded: the full 10-zone ambiguity
// heatmap (minimal high/med/low palette) + Explore / Distill actions.
//
// Clicking an ambiguity chip or a heatmap zone forks that ambiguity out as
// its own card (a `seeds_question` node). The deep analysis stays hidden in
// synthesis_data for downstream agents — only this calm refinement shows.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw, ListChecks, Check, ArrowUpRight } from "lucide-react";
import { Wand2 as Sparkles } from "@/lib/cute-icons";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  forkAmbiguity,
  openResolutionStudio,
  refreshSharpening,
  REFRESH_SHARPENING_EVENT,
  emitAiAutoResolveStarted,
  emitAiAutoResolveEnded,
  deployHeatmapCard,
  deployPriorityMapCard,
} from "@/components/objective/board-bus";
import type { Resolution } from "@/lib/objective-canvas/prompt-sharpening-prompt";
import { useAutoFitHeight } from "@/components/objective/canvas-interactions/use-auto-fit-height";

const COLLAPSED_H = 204;
const EXPANDED_H = 524;
const CARD_W = 348;

// Phrase → concept_slug (mirrors the slugify in prompt-sharpening-prompt.ts +
// the inline aiDecide path). Used to match salience rows against the user's
// resolved concepts so the priority map can check them off.
const slugifyPhrase = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

// Force a fresh depth/salience pass (POST { force:true }) and return its
// annotations, or null on any failure. Shared by the manual "Re-scan" button
// and the auto-refresh that fires after resolutions reframe the prompt — both
// need the SAME recompute, so the recomputed (usually lower) uncertainty shows.
async function forceDepthScan(spaceId: string): Promise<SalienceItem[] | null> {
  try {
    const r = await fetch(`/api/objective/${spaceId}/sharpening-depth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      status?: string;
      salience?: { annotations?: SalienceItem[] };
    };
    return j.status === "ready" && j.salience?.annotations
      ? j.salience.annotations
      : null;
  } catch {
    return null;
  }
}

// Named generation stages shown while the artifact is in flight. The card
// fires ONE LLM call, so these are paced across the expected window — the
// FINAL completion is real (it lands when the artifact does); the earlier
// ticks pace the model's internal phases.
const SHARPEN_STAGES = [
  "Reading your objective",
  "Mapping ambiguity zones",
  "Sharpening the prompt",
  "Ranking what matters",
] as const;
const STAGE_TIMES_MS = [1600, 4000, 6400, 8400];
const GEN_EXPECTED_MS = 9000;

/** Short chip label from a ranked ambiguity's type ("Output format
 *  ambiguity" → "Output format"). */
function chipLabelOf(r: { ambiguity_type?: string }): string {
  const t = (r?.ambiguity_type ?? "").replace(/ambiguity/i, "").trim();
  const label = t || "Ambiguity";
  return label.length > 24 ? label.slice(0, 23) + "…" : label;
}

// The card's accent — blue (the Features-stage color), not violet. This is a
// calm, product-forward refinement object; it shouldn't shout in purple.
// Single source of truth so the board materializer + status mount agree.
export const SHARPEN_COLOR = "#2563EB";

const SEV_COLOR: Record<string, string> = {
  high: "#DC2626",
  medium: "#D97706",
  low: "#94A3B8",
};

// Salience kind → accent + short tag. Tropical Punch palette: orange (pain),
// teal (lever), pink (term), yellow (goal/limit). Pain & limit share the
// warm-orange end of the palette since both signal "attention here".
const KIND_STYLE: Record<string, { color: string; label: string }> = {
  pain: { color: "#FF8243", label: "Pain" },
  goal: { color: "#FCE883", label: "Goal" },
  lever: { color: "#069494", label: "Lever" },
  constraint: { color: "#FF8243", label: "Limit" },
  concept: { color: "#FFC0CB", label: "Term" },
};

export const ZONE_LABEL: Record<string, string> = {
  intent: "Intent",
  target_user: "Target user",
  problem: "Problem",
  desired_outcome: "Outcome",
  scope: "Scope",
  mechanism: "Mechanism",
  output_format: "Output format",
  source_context: "Source / context",
  constraint: "Constraint",
  downstream_routing: "Routing",
};

interface HeatZone {
  severity?: string;
  ambiguity?: string;
  question_to_resolve?: string;
}
interface RankedItem {
  ambiguity_type?: string;
  ambiguity?: string;
  question_to_resolve?: string;
  severity?: string;
}
interface SalienceItem {
  phrase: string;
  kind: string;
  leverage: number;
  uncertainty: number;
  why?: string;
  candidate_readings?: string[];
  priority?: number;
}

export type PromptSharpeningCardShape = TLBaseShape<
  "prompt-sharpening",
  {
    w: number;
    h: number;
    expanded: boolean;
    spaceId: string;
    /** distilled_title */
    title: string;
    /** sharpened_prompt */
    sharpenedPrompt: string;
    /** short chip labels for the top ranked ambiguities */
    chips: string[];
    /** ambiguity_heatmap, JSON-encoded (10 zones) */
    heatmapJson: string;
    /** ranked_ambiguities, JSON-encoded (for fork bodies) */
    rankedJson: string;
    color: string;
  }
>;

export class PromptSharpeningCardShapeUtil extends BaseBoxShapeUtil<PromptSharpeningCardShape> {
  static override type = "prompt-sharpening" as const;
  static override props: RecordProps<PromptSharpeningCardShape> = {
    w: T.number,
    h: T.number,
    expanded: T.boolean,
    spaceId: T.string,
    title: T.string,
    sharpenedPrompt: T.string,
    chips: T.arrayOf(T.string),
    heatmapJson: T.string,
    rankedJson: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: PromptSharpeningCardShape,
    info: TLResizeInfo<PromptSharpeningCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): PromptSharpeningCardShape["props"] {
    return {
      w: CARD_W,
      h: COLLAPSED_H,
      expanded: false,
      spaceId: "",
      title: "",
      sharpenedPrompt: "",
      chips: [],
      heatmapJson: "{}",
      rankedJson: "[]",
      color: SHARPEN_COLOR,
    };
  }

  component(shape: PromptSharpeningCardShape) {
    return <PromptSharpeningRenderer shape={shape} util={this} />;
  }

  indicator(shape: PromptSharpeningCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function parseRanked(json: string): RankedItem[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as RankedItem[]) : [];
  } catch {
    return [];
  }
}

/** Client fallback for the priority map. The depth pass can 504 (the LLM output
 *  takes >60s → SDK aborts → retries → exceeds the route's maxDuration), in
 *  which case NOTHING persists and the GET stays "pending" forever. Rather than
 *  leave the priority-map fork blank, derive a coarse map from the ranked
 *  ambiguities the card already holds. No micro-decomposition / candidate
 *  readings (the depth pass owns those) — but never nothing. Mirrors
 *  deriveSalienceFromRanked() in generate-sharpening-depth.ts. */
function deriveSalienceFallback(ranked: RankedItem[]): SalienceItem[] {
  return ranked.slice(0, 6).map((r) => {
    const uncertainty =
      r.severity === "high" ? 0.85 : r.severity === "medium" ? 0.6 : 0.4;
    const phrase =
      (r.ambiguity_type || "").replace(/ambiguity/i, "").trim() ||
      (r.ambiguity || "").slice(0, 48) ||
      "Ambiguity";
    const leverage = 0.7;
    return {
      phrase,
      kind: "concept",
      leverage,
      uncertainty,
      why: (r.ambiguity || r.question_to_resolve || "").trim(),
      candidate_readings: [],
      priority: Math.round(leverage * (0.5 + 0.5 * uncertainty) * 1000) / 1000,
    };
  });
}
function parseHeatmap(json: string): Record<string, HeatZone> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, HeatZone>) : {};
  } catch {
    return {};
  }
}

function PromptSharpeningRenderer({
  shape,
  util,
}: {
  shape: PromptSharpeningCardShape;
  util: PromptSharpeningCardShapeUtil;
}) {
  const editor = util.editor;
  const { expanded, title, sharpenedPrompt, chips, color } = shape.props;
  // The heatmap + priority map now FORK OUT as their own cards (the two-way
  // downward fork below the objective); this card stays title + desc + the
  // resolve CTA. Flip true to restore the inline heatmap/priority/chips.
  const INLINE_DETAILS = false;
  const ranked = parseRanked(shape.props.rankedJson);
  const heatmap = parseHeatmap(shape.props.heatmapJson);
  // No real heatmap yet → the artifact is still generating (the optimistic
  // "Sharpening…" placeholder). Show a progress bar instead of the toggle.
  const loading = Object.keys(heatmap).length === 0;
  // Terminal-failure surface: if generation never lands (poll exhausted, or a
  // credits/error response) flip to a "couldn't sharpen — retry" state instead
  // of leaving the card stuck on the 94% bar forever. Retry re-triggers
  // generation + resumes polling (retryTick re-runs the poll effect).
  const [failed, setFailed] = useState(false);
  const [failReason, setFailReason] = useState<string>("");
  const [retryTick, setRetryTick] = useState(0);

  // Self-heal: while loading, poll the status route and fill the card's OWN
  // props when the artifact lands — independent of the deploy event, so the
  // card can never stay stuck on the placeholder if a deploy raced or was
  // missed. Nudges one regenerate if generation stalls (transient recovery).
  const spaceId = shape.props.spaceId;
  useEffect(() => {
    if (!loading || !spaceId) return;
    let cancelled = false;
    let tries = 0;
    let retried = false;
    let timer: ReturnType<typeof setTimeout>;

    function applyArtifact(a: { [k: string]: unknown }) {
      const rk = Array.isArray(a.ranked_ambiguities) ? a.ranked_ambiguities : [];
      editor.updateShape<PromptSharpeningCardShape>({
        id: shape.id,
        type: "prompt-sharpening",
        props: {
          title: (a.distilled_title as string) ?? "",
          sharpenedPrompt: (a.sharpened_prompt as string) ?? "",
          chips: (rk as { ambiguity_type?: string }[]).slice(0, 3).map(chipLabelOf),
          heatmapJson: JSON.stringify(a.ambiguity_heatmap ?? {}),
          rankedJson: JSON.stringify(rk),
          h: COLLAPSED_H,
        },
      });
    }

    async function poll() {
      if (cancelled) return;
      tries += 1;
      try {
        const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as {
            status?: string;
            artifact?: { [k: string]: unknown };
          };
          if (json.status === "ready" && json.artifact) {
            applyArtifact(json.artifact);
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      // Stalled past ~18s → drive ONE awaited regenerate. Its open request keeps
      // the function alive for the whole generation and its response is
      // definitive: ready → fill; error/402 (credits) → surface a retry instead
      // of spinning forever.
      if (!retried && tries === 12) {
        retried = true;
        try {
          const r = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          if (cancelled) return;
          if (r.ok) {
            const j = (await r.json()) as {
              status?: string;
              detail?: string;
              artifact?: { [k: string]: unknown };
            };
            if (j.status === "ready" && j.artifact) {
              applyArtifact(j.artifact);
              return;
            }
            if (j.status === "error") {
              if (j.detail) setFailReason(j.detail);
              setFailed(true);
              return;
            }
          } else if (r.status === 402) {
            setFailReason("out of credits (402)");
            setFailed(true);
            return;
          }
        } catch {
          /* network — fall through and keep polling */
        }
      }
      if (cancelled) return;
      if (tries < 60) {
        timer = setTimeout(poll, 1500);
      } else {
        // Exhausted (~90s) with nothing → stop the spinner, offer a retry.
        setFailReason("timed out waiting for generation (~90s)");
        setFailed(true);
      }
    }
    timer = setTimeout(poll, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, spaceId, shape.id, editor, retryTick]);

  // ── Depth & salience (lazy second pass) ──
  // Once the fast artifact has landed (!loading), fetch the salience priority
  // map; if it isn't generated yet, drive ONE awaited POST (its open request
  // keeps the function alive for the whole pass) then poll. Kept in local
  // state — it arrives after the card is already on the board, so it's display
  // data, not a core shape prop (no migration needed).
  const [salience, setSalience] = useState<SalienceItem[] | null>(null);
  const [saliencePending, setSaliencePending] = useState(false);
  // "Scan for ambiguities" re-run state + the set of concept_slugs the user has
  // already resolved (Resolution Studio or inline "Let AI decide"). resolvedSlugs
  // drives the check-off on the priority map; rescanPending drives the button +
  // dot spinner during a forced re-scan.
  const [rescanPending, setRescanPending] = useState(false);
  const [resolvedSlugs, setResolvedSlugs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (loading || !spaceId || salience !== null) return;
    let cancelled = false;
    let tries = 0;
    let drove = false;
    let timer: ReturnType<typeof setTimeout>;
    setSaliencePending(true);

    function done(items: SalienceItem[]) {
      if (cancelled) return;
      setSalience(items);
      setSaliencePending(false);
    }
    // Coarse priority map from the ranked ambiguities the card already holds —
    // used whenever the server depth pass can't deliver (504 / error / polled
    // out) so the fork + resolve panel never stay blank.
    function fallback(): SalienceItem[] {
      return deriveSalienceFallback(parseRanked(shape.props.rankedJson));
    }

    async function tick() {
      if (cancelled) return;
      tries += 1;
      try {
        const res = await fetch(`/api/objective/${spaceId}/sharpening-depth`, {
          cache: "no-store",
        });
        if (res.ok) {
          const j = (await res.json()) as {
            status?: string;
            salience?: { annotations?: SalienceItem[] };
          };
          if (j.status === "ready" && j.salience?.annotations?.length) {
            done(j.salience.annotations);
            return;
          }
        }
      } catch {
        /* transient — keep going */
      }
      // Not generated yet → drive ONE awaited generation, then keep polling.
      if (!drove) {
        drove = true;
        try {
          const r = await fetch(`/api/objective/${spaceId}/sharpening-depth`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          if (cancelled) return;
          if (r.ok) {
            const j = (await r.json()) as {
              status?: string;
              salience?: { annotations?: SalienceItem[] };
            };
            if (j.status === "ready" && j.salience?.annotations?.length) {
              done(j.salience.annotations);
              return;
            }
          } else if (r.status >= 500) {
            // Depth pass timed out (504) or errored server-side — it won't
            // recover by polling, so surface the coarse fallback immediately.
            done(fallback());
            return;
          }
        } catch {
          // Network error / abort (the 504 often surfaces as a throw) — same.
          done(fallback());
          return;
        }
      }
      if (cancelled) return;
      if (tries < 8) {
        timer = setTimeout(tick, 2000);
      } else {
        // Polled out with nothing persisted → last-resort coarse fallback so the
        // priority map + resolve panel still appear.
        done(fallback());
      }
    }
    timer = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, spaceId, salience]);

  // Auto-fork the heatmap + priority map out as their OWN cards (the two-way
  // downward fork below the objective) so this card itself stays title+desc.
  // Idempotent server-side per sourceId (updates, never duplicates); the refs
  // stop re-firing within a session. Heatmap lands with the fast artifact;
  // priority waits for the salience (depth) pass.
  const autoForkedHeat = useRef(false);
  const autoForkedPriority = useRef(false);
  useEffect(() => {
    if (loading || !spaceId || autoForkedHeat.current) return;
    const hm = shape.props.heatmapJson;
    if (hm && hm !== "{}") {
      autoForkedHeat.current = true;
      deployHeatmapCard({ sourceId: shape.id, spaceId, heatmapJson: hm, color });
    }
  }, [loading, spaceId, shape.props.heatmapJson, shape.id, color]);
  useEffect(() => {
    if (!spaceId || autoForkedPriority.current) return;
    if (salience && salience.length > 0) {
      autoForkedPriority.current = true;
      deployPriorityMapCard({
        sourceId: shape.id,
        spaceId,
        salienceJson: JSON.stringify(salience),
        color,
      });
    }
  }, [spaceId, salience, shape.id, color]);

  // Phase 3: re-fetch + re-render when resolutions are applied (the re-framed
  // sharpened prompt). The card is past `loading`, so its self-heal poll is
  // off — this event is how the re-framed objective reaches the card in place.
  useEffect(() => {
    if (!spaceId) return;
    function onRefresh(e: Event) {
      const d = (e as CustomEvent<{ spaceId?: string }>).detail;
      if (d?.spaceId && d.spaceId !== spaceId) return;
      void (async () => {
        try {
          const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const json = (await res.json()) as {
            status?: string;
            artifact?: { [k: string]: unknown };
          };
          if (json.status === "ready" && json.artifact) {
            const a = json.artifact;
            const rk = Array.isArray(a.ranked_ambiguities)
              ? a.ranked_ambiguities
              : [];
            editor.updateShape<PromptSharpeningCardShape>({
              id: shape.id,
              type: "prompt-sharpening",
              props: {
                title: (a.distilled_title as string) ?? "",
                sharpenedPrompt: (a.sharpened_prompt as string) ?? "",
                chips: (rk as { ambiguity_type?: string }[])
                  .slice(0, 3)
                  .map(chipLabelOf),
                heatmapJson: JSON.stringify(a.ambiguity_heatmap ?? {}),
                rankedJson: JSON.stringify(rk),
              },
            });
            // Mark resolved concepts + auto re-scan. The resolutions reframed
            // the sharpened prompt, so a fresh depth pass recomputes (usually
            // lowers) uncertainty for what was just pinned → the dots visibly
            // move and the resolved rows check off.
            const ress = Array.isArray(
              (a as { resolutions?: unknown }).resolutions,
            )
              ? ((a as { resolutions?: { concept_slug?: string }[] })
                  .resolutions ?? [])
              : [];
            const set = new Set<string>();
            for (const rr of ress) if (rr?.concept_slug) set.add(rr.concept_slug);
            setResolvedSlugs(set);
            setRescanPending(true);
            const anns = await forceDepthScan(spaceId);
            if (anns) setSalience(anns);
            setRescanPending(false);
          }
        } catch {
          /* soft-fail */
        }
      })();
    }
    window.addEventListener(REFRESH_SHARPENING_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_SHARPENING_EVENT, onRefresh);
  }, [spaceId, shape.id, editor]);

  // Load already-resolved concepts once the card is live (so reopening a board
  // with prior resolutions shows the check-offs without re-resolving).
  useEffect(() => {
    if (loading || !spaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as {
          artifact?: { resolutions?: { concept_slug?: string }[] };
        };
        const set = new Set<string>();
        for (const rr of j.artifact?.resolutions ?? [])
          if (rr?.concept_slug) set.add(rr.concept_slug);
        if (!cancelled) setResolvedSlugs(set);
      } catch {
        /* soft-fail */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, spaceId]);

  // Manual "scan for ambiguities" — force a fresh depth pass on the latest
  // (possibly re-framed) objective and re-render the priority map in place.
  async function onRescanAmbiguities(e: React.MouseEvent) {
    e.stopPropagation();
    if (!spaceId || rescanPending) return;
    setRescanPending(true);
    const anns = await forceDepthScan(spaceId);
    if (anns) setSalience(anns);
    setRescanPending(false);
  }

  // No-crop on spawn: grow the card to fit its content (the loading view's
  // title + activity + stage list, the full title + sharpened text, and the
  // "Optimize for" salience rows once they land). Disabled while expanded —
  // that state has a fixed height with an internal scroll.
  const contentRef = useRef<HTMLDivElement>(null);
  useAutoFitHeight(
    editor,
    shape.id,
    "prompt-sharpening",
    shape.props.h,
    contentRef,
    [
      loading,
      title,
      sharpenedPrompt,
      chips.length,
      expanded,
      salience,
      saliencePending,
    ],
    !expanded,
  );

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !expanded;
    editor.updateShape<PromptSharpeningCardShape>({
      id: shape.id,
      type: "prompt-sharpening",
      props: { expanded: next, h: next ? EXPANDED_H : COLLAPSED_H },
    });
  }

  function fork(headline: string, body: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!headline.trim()) return;
    forkAmbiguity({ sourceId: shape.id, headline, body, color });
  }

  // ── Inline "Let AI decide" ──
  // Same downstream effect as Resolution Studio's "answer everything" path,
  // but driven directly from the card so the user never has to enter the
  // modal: auto-resolve → POST resolutions → POST apply-resolutions
  // (re-frame + glossary write-back) → refreshSharpening + decompose into
  // Feature/Variable cards. Falls back to each concept's top candidate reading
  // if the auto-resolve call fails so something is always committed.
  const [autoResolving, setAutoResolving] = useState(false);
  const [hovered, setHovered] = useState(false);
  async function aiDecideInline(e: React.MouseEvent) {
    e.stopPropagation();
    if (!salience || salience.length === 0 || autoResolving) return;
    setAutoResolving(true);
    const now = new Date().toISOString();
    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

    // Notify any listener (the goal rail's AI activity strip) that the
    // auto-resolver is in flight. Bus event is fire-and-forget; nothing here
    // depends on a subscriber.
    emitAiAutoResolveStarted({
      spaceId,
      trigger: "card",
      conceptCount: salience.length,
    });
    let aiRes: Resolution[] = [];
    let aiOk = false;
    try {
      const r = await fetch(`/api/objective/${spaceId}/auto-resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          concepts: salience.map((s) => ({
            concept_slug: slugify(s.phrase),
            phrase: s.phrase,
            kind: s.kind,
            why: s.why,
            candidate_readings: s.candidate_readings || [],
          })),
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as { resolutions?: Resolution[] };
        aiRes = Array.isArray(j?.resolutions) ? j.resolutions : [];
        aiOk = aiRes.length > 0;
      }
    } catch {
      /* soft-fail → fall back below */
    }
    emitAiAutoResolveEnded({
      spaceId,
      trigger: "card",
      resolvedCount: aiRes.length,
      reviewCount: aiRes.filter((r) => r.needs_review).length,
      ok: aiOk,
    });

    const bySlug = new Map<string, Resolution>();
    for (const s of salience) {
      const slug = slugify(s.phrase);
      const reads = s.candidate_readings || [];
      if (reads.length) {
        bySlug.set(slug, {
          concept_slug: slug,
          phrase: s.phrase,
          kind: s.kind,
          chosen_readings: [reads[0]],
          answer_text: "",
          source: "ai",
          resolved_at: now,
        });
      }
    }
    for (const r of aiRes) bySlug.set(r.concept_slug, r);
    const res = [...bySlug.values()];

    try {
      if (res.length) {
        await fetch(`/api/objective/${spaceId}/resolutions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolutions: res }),
        });
        let sp: string | undefined;
        try {
          const r = await fetch(`/api/objective/${spaceId}/apply-resolutions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          if (r.ok) {
            const j = (await r.json()) as { sharpenedPrompt?: string };
            sp = j?.sharpenedPrompt;
          }
        } catch {
          /* soft-fail — resolutions still saved */
        }
        refreshSharpening(spaceId);
        window.dispatchEvent(
          new CustomEvent("objective-board:decompose-into-cards", {
            detail: sp ? { objective: sp } : undefined,
          }),
        );
      }
    } finally {
      setAutoResolving(false);
    }
  }

  // Fork EVERY ambiguity at once → one insight-card each to address. Uses the
  // ranked (high-impact) set, falling back to high/medium heatmap zones.
  function forkAll(e: React.MouseEvent) {
    e.stopPropagation();
    const rankedItems = parseRanked(shape.props.rankedJson);
    const heat = parseHeatmap(shape.props.heatmapJson);
    const items: { headline: string; body: string }[] = rankedItems.length
      ? rankedItems.map((r) => ({
          headline: (r.ambiguity || r.ambiguity_type || "Ambiguity").trim(),
          body: r.question_to_resolve || "",
        }))
      : Object.keys(ZONE_LABEL)
          .map((k) => ({ k, z: heat[k] ?? {} }))
          .filter(({ z }) => z.severity === "high" || z.severity === "medium")
          .map(({ k, z }) => ({
            headline: (z.ambiguity || ZONE_LABEL[k]).trim(),
            body: z.question_to_resolve || "",
          }));
    for (const it of items) {
      if (it.headline)
        forkAmbiguity({ sourceId: shape.id, headline: it.headline, body: it.body, color });
    }
  }

  // Fork the heatmap / priority-map out as their own cards on the board. The
  // sections stay visible inline; this is additive — the user opts in when they
  // want the heatmap or priority map living next to other thinking. Connectors
  // are drawn from the sharpening card by the bezier overlay.
  function forkOutHeatmap(e: React.MouseEvent) {
    e.stopPropagation();
    deployHeatmapCard({
      sourceId: shape.id,
      spaceId,
      heatmapJson: shape.props.heatmapJson,
      color,
    });
  }
  function forkOutPriorityMap(e: React.MouseEvent) {
    e.stopPropagation();
    if (!salience || salience.length === 0) return;
    deployPriorityMapCard({
      sourceId: shape.id,
      spaceId,
      salienceJson: JSON.stringify(salience),
      color,
    });
  }

  // Open the immersive Resolution Studio with the salience deck — the user
  // resolves each high-leverage ambiguity (flashcards + voice + live AI).
  function openStudio(e: React.MouseEvent) {
    e.stopPropagation();
    if (!salience || salience.length === 0) return;
    openResolutionStudio({
      spaceId,
      objectiveTitle: title,
      sharpenedPrompt,
      concepts: salience.map((s) => ({
        phrase: s.phrase,
        kind: s.kind,
        leverage: s.leverage,
        uncertainty: s.uncertainty,
        why: s.why,
        candidate_readings: s.candidate_readings,
      })),
    });
  }

  // Retry after a failed generation: clear the failed state, re-trigger
  // generation (idempotent bare POST), and re-run the poll effect (retryTick).
  function retry(e: React.MouseEvent) {
    e.stopPropagation();
    setFailed(false);
    setRetryTick((t) => t + 1);
    void fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all", position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        ref={contentRef}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(246,250,255,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 46px -18px ${color}4D, 0 8px 22px -12px rgba(11,18,40,0.14)`,
          padding: "13px 15px 12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow — just the AI sparkle mark, no "Prompt Sharpened" label.
            It pulses while the artifact is still generating and settles once
            the sharpened result lands, so we never claim "Sharpened" mid-flight
            (the title + progress bar carry the in-progress state). */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            className={loading ? "animate-pulse" : undefined}
            style={{ display: "inline-flex" }}
          >
            <Sparkle style={{ width: 13, height: 13, color }} strokeWidth={2.4} />
          </span>
          {!loading && (
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={forkOutHeatmap}
              aria-label="Fork heatmap out"
              title="Fork the ambiguity heatmap out as its own card"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "2px 7px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: "rgba(15,23,42,0.04)",
                color: appleVibe.text.tertiary,
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              Heatmap
              <ArrowUpRight style={{ width: 11, height: 11 }} strokeWidth={2.4} />
            </button>
          )}
        </div>

        {/* Distilled title — title-only render; the sharpened prompt lives in
            the title attr so it surfaces on hover. Body prose is gone (the
            title alone has to read clearly). */}
        <div
          title={!loading && sharpenedPrompt ? sharpenedPrompt : undefined}
          style={{
            marginTop: 9,
            fontSize: 15.5,
            fontWeight: 700,
            lineHeight: 1.32,
            color: appleVibe.text.primary,
            paddingBottom: 1,
          }}
        >
          {loading
            ? failed
              ? "Couldn't sharpen the prompt"
              : "Sharpening your prompt"
            : title || "Untitled objective"}
        </div>

        {loading &&
          (failed ? (
            <GenerationFailed color={color} onRetry={retry} reason={failReason} />
          ) : (
            <GenerationActivity color={color} />
          ))}

        {/* Resolve panel — the FIRST thing the user sees once the artifact
            lands: an honest count of what still needs answering plus the two
            ways to address it. "Let AI decide" auto-resolves with the model's
            best reading for every concept (no modal); "Answer questions"
            opens the Resolution Studio so the user answers in their own words.
            Surfacing this above the salience/heatmap means the user never has
            to expand the card to act on it. */}
        {INLINE_DETAILS && !loading && (salience !== null || saliencePending) ? (
          <ResolvePanel
            color={color}
            count={salience?.length ?? 0}
            pending={saliencePending && !salience}
            busy={autoResolving}
            onAiDecide={aiDecideInline}
            onAnswer={openStudio}
          />
        ) : null}

        {/* Optimize for — the salience priority map (pain / goal / lever
            weighting). Lands a beat after the card via the lazy depth pass;
            shows a quiet "weighing…" hint until it does. Leads ABOVE the
            ambiguities: the levers are the result, the ambiguities are the gaps. */}
        {INLINE_DETAILS && !loading && (salience?.length || saliencePending) ? (
          <div style={{ marginTop: 11 }}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: appleVibe.text.tertiary,
                marginBottom: 6,
              }}
            >
              Optimize for
            </div>
            {salience && salience.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {salience.slice(0, 3).map((s, i) => {
                  const ks = KIND_STYLE[s.kind] ?? KIND_STYLE.concept;
                  return (
                    <div
                      key={i}
                      title={s.why || s.phrase}
                      style={{ display: "flex", alignItems: "center", gap: 7 }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: ks.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: appleVibe.text.primary,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {s.phrase}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          width: 34,
                          height: 4,
                          borderRadius: 999,
                          background: `${ks.color}24`,
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${Math.round(s.leverage * 100)}%`,
                            background: ks.color,
                            borderRadius: 999,
                          }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: appleVibe.text.faint,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  className="animate-pulse"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: appleVibe.text.faint,
                  }}
                />
                Weighing leverage &amp; pain points…
              </div>
            )}
          </div>
        ) : null}

        {/* Ambiguity chips (top ranked) */}
        {INLINE_DETAILS && chips.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: appleVibe.text.tertiary,
                marginBottom: 5,
              }}
            >
              Ambiguities
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {chips.slice(0, 3).map((c, i) => {
                const r = ranked[i];
                return (
                  <button
                    key={i}
                    type="button"
                    onPointerDown={stopEventPropagation}
                    onClick={(e) =>
                      fork(
                        r?.ambiguity || c,
                        r?.question_to_resolve || "",
                        e,
                      )
                    }
                    title={r?.ambiguity || c}
                    style={{
                      maxWidth: "100%",
                      padding: "3px 9px",
                      borderRadius: 999,
                      border: `1px solid ${color}2E`,
                      background: `${color}12`,
                      color: appleVibe.text.secondary,
                      fontSize: 10.5,
                      fontWeight: 550,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Expanded: priority map + heatmap + actions */}
        {INLINE_DETAILS && expanded && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 11,
              borderTop: `1px solid ${appleVibe.stroke.hairline}`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              flex: 1,
            }}
          >
            {/* Scrolls as one; the actions below stay pinned. */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Priority map — what to optimize for, ranked by leverage. The
                  richer view of the collapsed "Optimize for" list: each row
                  shows kind + a pair of MiniDots (leverage, uncertainty) whose
                  opacity tracks the value. */}
              {salience && salience.length > 0 && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 7,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: appleVibe.text.tertiary,
                      }}
                    >
                      Priority map · what to optimize for
                    </div>
                    <button
                      type="button"
                      onPointerDown={stopEventPropagation}
                      onClick={forkOutPriorityMap}
                      title="Fork the priority map out as its own card"
                      style={{
                        marginLeft: "auto",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "none",
                        cursor: "pointer",
                        background: `${color}12`,
                        color,
                        fontSize: 10,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      <ArrowUpRight style={{ width: 11, height: 11 }} strokeWidth={2.4} />
                      Fork out
                    </button>
                    <button
                      type="button"
                      onPointerDown={stopEventPropagation}
                      onClick={onRescanAmbiguities}
                      disabled={rescanPending}
                      title="Re-scan for ambiguities — re-runs the analysis on the latest objective"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "none",
                        cursor: rescanPending ? "default" : "pointer",
                        background: `${color}12`,
                        color,
                        fontSize: 10,
                        fontWeight: 600,
                        opacity: rescanPending ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      <RotateCcw
                        className={rescanPending ? "animate-spin" : undefined}
                        style={{ width: 11, height: 11 }}
                        strokeWidth={2.4}
                      />
                      {rescanPending ? "Scanning…" : "Re-scan"}
                    </button>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {salience.map((s, i) => {
                      const ks = KIND_STYLE[s.kind] ?? KIND_STYLE.concept;
                      const resolved = resolvedSlugs.has(slugifyPhrase(s.phrase));
                      return (
                        <div
                          key={i}
                          style={{
                            padding: "7px 9px",
                            borderRadius: 9,
                            border: resolved
                              ? "1px solid #BBF7D0"
                              : `1px solid ${appleVibe.stroke.soft}`,
                            background: resolved ? "#F0FDF4" : "#FFFFFF",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 8.5,
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                color: appleVibe.text.primary,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: ks.color,
                                flexShrink: 0,
                              }}
                            >
                              {ks.label}
                            </span>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 650,
                                color: appleVibe.text.primary,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {s.phrase}
                            </span>
                            {resolved ? (
                              <span
                                title="Resolved — you've pinned this meaning"
                                style={{
                                  marginLeft: "auto",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  flexShrink: 0,
                                  color: "#16A34A",
                                  fontSize: 9,
                                  fontWeight: 700,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                }}
                              >
                                <Check
                                  style={{ width: 12, height: 12 }}
                                  strokeWidth={3}
                                />
                                Resolved
                              </span>
                            ) : (
                              <span
                                title={`Leverage ${Math.round(s.leverage * 100)}% · Uncertainty ${Math.round(s.uncertainty * 100)}%`}
                                style={{
                                  marginLeft: "auto",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  flexShrink: 0,
                                }}
                              >
                                <MiniDot value={s.leverage} color={ks.color} />
                                <MiniDot value={s.uncertainty} color="#94A3B8" />
                              </span>
                            )}
                          </div>
                          {s.why && (
                            <div
                              style={{
                                marginTop: 3,
                                fontSize: 10.5,
                                lineHeight: 1.4,
                                color: appleVibe.text.tertiary,
                              }}
                            >
                              {s.why}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Ambiguity heatmap */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 7,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: appleVibe.text.tertiary,
                    }}
                  >
                    Ambiguity heatmap · tap to fork
                  </div>
                  <button
                    type="button"
                    onPointerDown={stopEventPropagation}
                    onClick={forkOutHeatmap}
                    title="Fork the heatmap out as its own square card"
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "none",
                      cursor: "pointer",
                      background: `${color}12`,
                      color,
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    <ArrowUpRight style={{ width: 11, height: 11 }} strokeWidth={2.4} />
                    Fork out
                  </button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 4,
                  }}
                >
              {Object.keys(ZONE_LABEL).map((key) => {
                const z = heatmap[key] ?? {};
                const sev = (z.severity as string) || "low";
                const sc = SEV_COLOR[sev] ?? SEV_COLOR.low;
                return (
                  <button
                    key={key}
                    type="button"
                    onPointerDown={stopEventPropagation}
                    onClick={(e) =>
                      fork(z.ambiguity || ZONE_LABEL[key], z.question_to_resolve || "", e)
                    }
                    title={z.ambiguity || ZONE_LABEL[key]}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "6px 8px",
                      borderRadius: 9,
                      border: `1px solid ${sc}26`,
                      background: `${sc}0F`,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: sc,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 550,
                        color: appleVibe.text.secondary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ZONE_LABEL[key]}
                    </span>
                  </button>
                );
              })}
                </div>
              </div>
            </div>

            {/* Fork every ambiguity out as its own card to address. The
                Diverge/Converge verbs that used to live here were a duplicate
                of the canvas-wide ‹ › buttons on every card — kept in one
                place to avoid confusion. */}
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={forkAll}
              style={{
                marginTop: 11,
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: `1px solid ${appleVibe.stroke.hairline}`,
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
                fontSize: 11.5,
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: appleVibe.font.stack,
              }}
            >
              Fork every ambiguity to its own card
            </button>
          </div>
        )}
      </div>

      {/* Hovering floating resolve pill. The objective card is pure title+desc;
          the resolve action floats in on hover (gently), firing the AI to
          resolve every ambiguity. The 3-mode choice lives on the forked cards. */}
      {!loading && salience && salience.length > 0 && (
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={aiDecideInline}
          disabled={autoResolving}
          title="Let AI resolve every ambiguity"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 12,
            transform: `translateX(-50%) translateY(${hovered || autoResolving ? 0 : 8}px)`,
            opacity: hovered || autoResolving ? 1 : 0,
            transition: "opacity 0.22s ease, transform 0.22s ease",
            pointerEvents: hovered || autoResolving ? "all" : "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            cursor: autoResolving ? "default" : "pointer",
            background: color,
            color: "white",
            fontSize: 12.5,
            fontWeight: 650,
            boxShadow: `0 10px 24px -6px ${color}AA`,
            whiteSpace: "nowrap",
          }}
        >
          <Sparkle style={{ width: 14, height: 14 }} strokeWidth={2.5} />
          {autoResolving ? "Resolving…" : "AI resolve"}
        </button>
      )}
    </HTMLContainer>
  );
}

/** Terminal-failure view — replaces the progress bar when generation never
 *  lands (poll exhausted, or a credits/error response). Gives the user a clear
 *  reason + a Retry that re-triggers generation, instead of a card frozen at
 *  94% with no way forward. */
function GenerationFailed({
  color,
  onRetry,
  reason,
}: {
  color: string;
  onRetry: (e: React.MouseEvent) => void;
  reason?: string;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.45,
          color: appleVibe.text.secondary,
        }}
      >
        Couldn&apos;t generate the sharpened prompt — the AI service may be
        briefly overloaded. This isn&apos;t a credits issue. Tap Retry.
      </div>
      {reason ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 10.5,
            lineHeight: 1.4,
            color: appleVibe.text.tertiary,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            wordBreak: "break-word",
          }}
        >
          {reason}
        </div>
      ) : null}
      <button
        type="button"
        onPointerDown={stopEventPropagation}
        onClick={onRetry}
        style={{
          marginTop: 9,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 999,
          border: `1px solid ${color}`,
          background: color,
          color: "white",
          fontSize: 11.5,
          fontWeight: 650,
          cursor: "pointer",
          fontFamily: appleVibe.font.stack,
        }}
      >
        <RotateCcw style={{ width: 12, height: 12 }} strokeWidth={2.4} />
        Retry
      </button>
    </div>
  );
}

/** Generation activity — shown while the artifact is still generating. A
 *  determinate progress bar (eases 4% → ~94% over the expected window; never
 *  claims 100% before done) PLUS a named-stage checklist so the user sees
 *  WHAT is being generated, ticking off like a deploy pipeline. */
function GenerationActivity({ color }: { color: string }) {
  const [pct, setPct] = useState(4);
  const [done, setDone] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const el = Date.now() - start;
      const t = Math.min(1, el / GEN_EXPECTED_MS);
      const eased = 1 - Math.pow(1 - t, 2.2); // ease-out: fast, then decelerate
      setPct(Math.min(94, Math.round(4 + eased * 90)));
      setDone(STAGE_TIMES_MS.filter((st) => el >= st).length);
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={{ marginTop: 12 }}>
      {/* Progress bar + live % */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: appleVibe.text.tertiary,
          }}
        >
          Generating
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {pct}%
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: `${color}1A`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: color,
            transition: "width 0.2s linear",
          }}
        />
      </div>

      {/* Stage checklist — what's being generated, ticking off */}
      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {SHARPEN_STAGES.map((label, i) => {
          const state = i < done ? "done" : i === done ? "active" : "pending";
          return (
            <div
              key={label}
              style={{ display: "flex", alignItems: "center", gap: 9 }}
            >
              <StageIcon state={state} color={color} />
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: state === "done" ? 600 : 500,
                  color:
                    state === "done"
                      ? appleVibe.text.primary
                      : state === "active"
                        ? appleVibe.text.secondary
                        : appleVibe.text.faint,
                  transition: "color 0.25s ease",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Stage glyph — filled check (done), spinning dashed ring (active), static
 *  dotted ring (pending). Matches the deploy-pipeline reference. */
function StageIcon({
  state,
  color,
}: {
  state: "done" | "active" | "pending";
  color: string;
}) {
  if (state === "done") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="8" r="8" fill={color} />
        <path
          d="M4.6 8.2 L7 10.4 L11.4 5.6"
          fill="none"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "active") {
    return (
      <svg
        className="animate-spin"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        style={{ flexShrink: 0 }}
      >
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        style={{ stroke: appleVibe.stroke.medium }}
        strokeWidth="1.6"
        strokeDasharray="2 3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Compact dot — value 0..1 maps to opacity. Two of these stand in for the
 *  old labelled leverage + uncertainty bars in the priority map so the row
 *  stays one line. The title attr (on the parent span) carries the exact %. */
function MiniDot({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        opacity: 0.25 + v * 0.75,
        display: "inline-block",
      }}
    />
  );
}

/** The top-of-card resolve panel — count + two ways to address it. The
 *  primary action is "Let AI decide" (auto-resolve inline, no modal); the
 *  secondary is "Answer questions" (open the Resolution Studio). Both are
 *  disabled until salience has loaded; while it's still being weighed we show
 *  a quiet "analyzing…" hint so the user can see something is coming. */
function ResolvePanel({
  color,
  count,
  pending,
  busy,
  onAiDecide,
  onAnswer,
}: {
  color: string;
  count: number;
  pending: boolean;
  busy: boolean;
  onAiDecide: (e: React.MouseEvent) => void;
  onAnswer: (e: React.MouseEvent) => void;
}) {
  const ready = count > 0 && !pending;
  return (
    <div
      style={{
        marginTop: 11,
        padding: "9px 10px 10px",
        borderRadius: 12,
        border: `1px solid ${color}26`,
        background: `${color}0D`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            background: color,
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {pending ? "…" : count}
        </span>
        <div
          title={
            pending
              ? "Weighing leverage & pain points"
              : "Pick fast or careful — both re-sharpen the prompt"
          }
          style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
        >
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 650,
              color: appleVibe.text.primary,
              lineHeight: 1.2,
            }}
          >
            {pending
              ? "Analyzing ambiguities…"
              : count === 0
                ? "No ambiguities to resolve"
                : `${count} ambiguit${count === 1 ? "y" : "ies"} to resolve`}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={onAiDecide}
          disabled={!ready || busy}
          title="Let AI commit the most likely reading for every ambiguity"
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            padding: "7px 10px",
            borderRadius: 999,
            border: "none",
            background: ready && !busy ? color : `${color}66`,
            color: "white",
            fontSize: 11,
            fontWeight: 650,
            cursor: ready && !busy ? "pointer" : "not-allowed",
            fontFamily: appleVibe.font.stack,
            boxShadow: ready && !busy ? `0 4px 12px -4px ${color}80` : "none",
          }}
        >
          <Sparkles style={{ width: 12, height: 12 }} strokeWidth={2.4} />
          {busy ? "Resolving…" : "Let AI decide"}
        </button>
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={onAnswer}
          disabled={!ready || busy}
          title="Walk through each ambiguity yourself in the Resolution Studio"
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            padding: "7px 10px",
            borderRadius: 999,
            border: `1px solid ${ready ? `${color}40` : appleVibe.stroke.soft}`,
            background: "rgba(255,255,255,0.85)",
            color: ready && !busy ? appleVibe.text.primary : appleVibe.text.faint,
            fontSize: 11,
            fontWeight: 600,
            cursor: ready && !busy ? "pointer" : "not-allowed",
            fontFamily: appleVibe.font.stack,
          }}
        >
          <ListChecks style={{ width: 12, height: 12 }} strokeWidth={2.4} />
          Answer questions
        </button>
      </div>
    </div>
  );
}

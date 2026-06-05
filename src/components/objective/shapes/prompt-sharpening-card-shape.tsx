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
import { ChevronDown, RotateCcw } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  forkAmbiguity,
  dispatchCardAction,
  openResolutionStudio,
  REFRESH_SHARPENING_EVENT,
} from "@/components/objective/board-bus";
import { useAutoFitHeight } from "@/components/objective/canvas-interactions/use-auto-fit-height";

const COLLAPSED_H = 204;
const EXPANDED_H = 524;
const CARD_W = 348;

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
          if (j.status === "ready" && j.salience?.annotations) {
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
            if (j.status === "ready" && j.salience?.annotations) {
              done(j.salience.annotations);
              return;
            }
          }
        } catch {
          /* fall through to polling */
        }
      }
      if (cancelled) return;
      if (tries < 8) {
        timer = setTimeout(tick, 2000);
      } else {
        setSaliencePending(false);
      }
    }
    timer = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, spaceId, salience]);

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
          }
        } catch {
          /* soft-fail */
        }
      })();
    }
    window.addEventListener(REFRESH_SHARPENING_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_SHARPENING_EVENT, onRefresh);
  }, [spaceId, shape.id, editor]);

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

  function runOp(action: "diverge" | "converge", e: React.MouseEvent) {
    e.stopPropagation();
    dispatchCardAction({
      action,
      entityId: "",
      title: sharpenedPrompt || title,
      shapeId: shape.id,
    });
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
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
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
              onClick={toggle}
              aria-label={expanded ? "Collapse" : "Expand heatmap"}
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
              {expanded ? "Less" : "Heatmap"}
              <ChevronDown
                style={{
                  width: 12,
                  height: 12,
                  transform: expanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.18s ease",
                }}
                strokeWidth={2.4}
              />
            </button>
          )}
        </div>

        {/* Distilled title — shown in FULL (no line clamp) so the spawned card
            never cuts it off. The card auto-fits its height to the title's
            real length (the distilled title is compact by design). */}
        <div
          style={{
            marginTop: 9,
            fontSize: 15.5,
            fontWeight: 700,
            // Roomier line-height + a hair of bottom padding so descenders
            // (p, g, y) are never clipped.
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

        {/* Sharpened prompt — hidden while generating; the activity view below
            carries the in-progress state. Shown in FULL (no line clamp): it's a
            1–2 sentence rewrite, and the card auto-fits its height so the
            sharpened objective is never clipped on spawn. */}
        {!loading && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
            }}
          >
            {sharpenedPrompt}
          </div>
        )}

        {loading &&
          (failed ? (
            <GenerationFailed color={color} onRetry={retry} reason={failReason} />
          ) : (
            <GenerationActivity color={color} />
          ))}

        {/* Optimize for — the salience priority map (pain / goal / lever
            weighting). Lands a beat after the card via the lazy depth pass;
            shows a quiet "weighing…" hint until it does. Leads ABOVE the
            ambiguities: the levers are the result, the ambiguities are the gaps. */}
        {!loading && (salience?.length || saliencePending) ? (
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
            {salience && salience.length > 0 && (
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={openStudio}
                style={resolveBtnStyle(color)}
              >
                Resolve to sharpen
                <span aria-hidden> →</span>
              </button>
            )}
          </div>
        ) : null}

        {/* Ambiguity chips (top ranked) */}
        {chips.length > 0 && (
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
        {expanded && (
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
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: appleVibe.text.tertiary,
                      marginBottom: 7,
                    }}
                  >
                    Priority map · what to optimize for
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {salience.map((s, i) => {
                      const ks = KIND_STYLE[s.kind] ?? KIND_STYLE.concept;
                      return (
                        <div
                          key={i}
                          style={{
                            padding: "7px 9px",
                            borderRadius: 9,
                            border: `1px solid ${appleVibe.stroke.soft}`,
                            background: "#FFFFFF",
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
                  <button
                    type="button"
                    onPointerDown={stopEventPropagation}
                    onClick={openStudio}
                    style={resolveBtnStyle(color)}
                  >
                    Resolve to sharpen
                    <span aria-hidden> →</span>
                  </button>
                </div>
              )}

              {/* Ambiguity heatmap */}
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: appleVibe.text.tertiary,
                    marginBottom: 7,
                  }}
                >
                  Ambiguity heatmap · tap to fork
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

            {/* Diverge / Converge — the SAME verbs as the rest of the canvas
                (replaces the old Explore/Distill). */}
            <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => runOp("diverge", e)}
                style={actionBtn(color, true)}
                title="Diverge — open up & generate"
              >
                ‹ Diverge
              </button>
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => runOp("converge", e)}
                style={actionBtn(color, false)}
                title="Converge — narrow & commit"
              >
                Converge ›
              </button>
            </div>
            {/* One button → fork EVERY ambiguity out as its own card to address. */}
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={forkAll}
              style={{
                marginTop: 7,
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
              Address all ambiguities
            </button>
          </div>
        )}
      </div>
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
        stroke={appleVibe.stroke.medium}
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

/** Full-width primary pill that opens the Resolution Studio. */
function resolveBtnStyle(color: string): React.CSSProperties {
  return {
    marginTop: 9,
    width: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: "8px 12px",
    borderRadius: 999,
    border: "none",
    background: color,
    color: "white",
    fontSize: 11.5,
    fontWeight: 650,
    cursor: "pointer",
    fontFamily: appleVibe.font.stack,
    boxShadow: `0 6px 16px -5px ${color}80`,
  };
}

function actionBtn(color: string, primary: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "7px 12px",
    borderRadius: 999,
    border: primary ? "none" : `1px solid ${appleVibe.stroke.soft}`,
    cursor: "pointer",
    background: primary ? color : "rgba(255,255,255,0.7)",
    color: primary ? "white" : appleVibe.text.secondary,
    fontSize: 11.5,
    fontWeight: 600,
    boxShadow: primary ? `0 4px 12px -3px ${color}80` : "none",
  };
}

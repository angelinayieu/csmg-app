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
import { ChevronDown } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { forkAmbiguity, dispatchCardAction } from "@/components/objective/board-bus";
import { useAutoFitHeight } from "@/components/objective/canvas-interactions/use-auto-fit-height";

const COLLAPSED_H = 204;
const EXPANDED_H = 452;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            artifact?: any;
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
                title: a.distilled_title ?? "",
                sharpenedPrompt: a.sharpened_prompt ?? "",
                chips: rk.slice(0, 3).map(chipLabelOf),
                heatmapJson: JSON.stringify(a.ambiguity_heatmap ?? {}),
                rankedJson: JSON.stringify(rk),
                h: COLLAPSED_H,
              },
            });
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      // Stalled past ~18s → nudge a regenerate once, then keep polling.
      if (!retried && tries === 12) {
        retried = true;
        void fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
          method: "POST",
        }).catch(() => {});
      }
      if (!cancelled && tries < 60) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, spaceId, shape.id, editor]);

  // No-crop on spawn: grow the card to fit its content (the loading view's
  // title + activity + stage list, or long sharpened text). Disabled while
  // expanded — that state has a fixed height with an internal scroll.
  const contentRef = useRef<HTMLDivElement>(null);
  useAutoFitHeight(
    editor,
    shape.id,
    "prompt-sharpening",
    shape.props.h,
    contentRef,
    [loading, title, sharpenedPrompt, chips.length, expanded],
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

        {/* Distilled title */}
        <div
          style={{
            marginTop: 9,
            fontSize: 15.5,
            fontWeight: 700,
            // Roomier line-height + a hair of bottom padding so descenders
            // (p, g, y) are never clipped. While loading the title isn't
            // clamped (it's a fixed short string); the real distilled title
            // clamps to 2 lines.
            lineHeight: 1.32,
            color: appleVibe.text.primary,
            display: loading ? "block" : "-webkit-box",
            WebkitLineClamp: loading ? undefined : 2,
            WebkitBoxOrient: "vertical",
            overflow: loading ? "visible" : "hidden",
            paddingBottom: 1,
          }}
        >
          {loading ? "Sharpening your prompt" : title || "Untitled objective"}
        </div>

        {/* Sharpened prompt — hidden while generating; the activity view below
            carries the in-progress state. */}
        {!loading && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: expanded ? 3 : 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {sharpenedPrompt}
          </div>
        )}

        {loading && <GenerationActivity color={color} />}

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

        {/* Expanded: heatmap + actions */}
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
            }}
          >
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
                overflowY: "auto",
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

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
import { ChevronDown } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { forkAmbiguity, dispatchCardAction } from "@/components/objective/board-bus";

const COLLAPSED_H = 204;
const EXPANDED_H = 452;
const CARD_W = 348;

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
      color: "#7C3AED",
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

  function runOp(action: "questions" | "make_plan", e: React.MouseEvent) {
    e.stopPropagation();
    dispatchCardAction({
      action,
      entityId: "",
      title: sharpenedPrompt || title,
      shapeId: shape.id,
    });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(250,248,255,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 46px -18px ${color}4D, 0 8px 22px -12px rgba(11,18,40,0.14)`,
          padding: "13px 15px 12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Sparkle style={{ width: 12, height: 12, color }} strokeWidth={2.4} />
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em", color }}>
            Prompt Sharpened
          </span>
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
        </div>

        {/* Distilled title */}
        <div
          style={{
            marginTop: 9,
            fontSize: 15.5,
            fontWeight: 700,
            lineHeight: 1.18,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title || "Untitled objective"}
        </div>

        {/* Sharpened prompt */}
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

            {/* Explore / Distill — reuse existing canvas operations */}
            <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => runOp("questions", e)}
                style={actionBtn(color, true)}
              >
                Explore
              </button>
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => runOp("make_plan", e)}
                style={actionBtn(color, false)}
              >
                Distill
              </button>
            </div>
          </div>
        )}
      </div>
    </HTMLContainer>
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

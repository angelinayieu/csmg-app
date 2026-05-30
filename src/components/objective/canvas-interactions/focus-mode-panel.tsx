"use client";

// ── FocusModePanel — "Converge" ─────────────────────────────────────
//
// The Apple-style port of Synergism's Focus Mode (CANVAS_INTERACTIONS_
// PORT_PLAN.md item #2 + #5). It REUSES the framework-agnostic logic
// verbatim — `autoMarkBoard` / `groupForStage1` (lib/synergy/focus-mode)
// and the `useFocusMode` state machine — and only rewrites the visuals
// for the clean white canvas.
//
// Scope vs. the old 4-stage immersive flow: stages 2–3 (extract
// brainstorm_components, synergy clarify MCQs) are Synergism-data-
// specific and don't map onto the objective canvas, so this collapses
// Stage 1 ("what did you decide?") + Stage 4 ("publish") into one panel:
//   · auto-marks every board node into kept / set-aside buckets
//   · the user toggles any row keep ⇄ exclude
//   · hovering a row drives a two-way highlight on the canvas (onFocusNode)
//   · Publish hands the kept set to the Strategy Brief surface
//
// Presentational + tldraw-free: the host owns `useFocusMode(nodes)` (so it
// can read `keptIds` to dim out-of-scope shapes via editor opacity) and
// passes it down. Board → nodes is the shape-node-adapter's job.

import { useMemo } from "react";
import {
  Check,
  Sparkles,
  GitBranch,
  FlaskConical,
  CircleDashed,
  X,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { autoMarkBoard, groupForStage1 } from "@/lib/synergy/focus-mode";
import type { ClientNode } from "@/lib/synergy/types";
import type { UseFocusModeReturn } from "@/components/synergy/focus-mode/use-focus-mode";

type Bucket = "plans" | "expanded" | "unclear" | "exploratory";

const SECTION: Record<
  Bucket,
  { label: string; hint: string; Icon: typeof Sparkles; color: string }
> = {
  plans: {
    label: "Synthesized",
    hint: "Plans you converged",
    Icon: Sparkles,
    color: appleVibe.stage.objective,
  },
  expanded: {
    label: "Expanded",
    hint: "Threads you pursued",
    Icon: GitBranch,
    color: appleVibe.stage.features,
  },
  unclear: {
    label: "Other items",
    hint: "Kept by default",
    Icon: CircleDashed,
    color: appleVibe.text.tertiary,
  },
  exploratory: {
    label: "Exploratory",
    hint: "Scratch — set aside",
    Icon: FlaskConical,
    color: appleVibe.text.faint,
  },
};

export interface FocusModePanelProps {
  /** Board projected to nodes (via shape-node-adapter). */
  nodes: ClientNode[];
  /** The focus-mode state machine — owned by the host so it can also
   *  read `keptIds` for canvas dimming. */
  focus: UseFocusModeReturn;
  /** Commit the converged set — wire to the Strategy Brief surface. */
  onPublish: (keptIds: string[]) => void;
  /** Two-way canvas binding: fired as the user hovers a row so the host
   *  can highlight / zoom the matching shape. */
  onFocusNode?: (id: string | null) => void;
  /** Primary accent (defaults to the objective violet). */
  accent?: string;
}

export function FocusModePanel({
  nodes,
  focus,
  onPublish,
  onFocusNode,
  accent = appleVibe.stage.objective,
}: FocusModePanelProps) {
  const { phase, keptIds, hoveredNodeId, scopedIds } = focus;

  const scoped = useMemo(
    () => (scopedIds ? nodes.filter((n) => scopedIds.has(n.id)) : nodes),
    [nodes, scopedIds],
  );
  const groups = useMemo(() => {
    const marks = autoMarkBoard(scoped);
    return groupForStage1(scoped, marks);
  }, [scoped]);

  if (phase === "closed") return null;

  const keptCount = scoped.reduce(
    (acc, n) => acc + (keptIds.has(n.id) ? 1 : 0),
    0,
  );
  const publishing = phase === "publishing";
  const transitioning = phase === "entering" || phase === "exiting";

  function toggle(id: string) {
    if (keptIds.has(id)) focus.setOverride(id, "exclude");
    else focus.setOverride(id, "keep");
  }

  function publish() {
    if (keptCount === 0 || publishing) return;
    focus.beginPublishing();
    onPublish(scoped.filter((n) => keptIds.has(n.id)).map((n) => n.id));
  }

  const ordered: Array<[Bucket, typeof groups.plans]> = [
    ["plans", groups.plans],
    ["expanded", groups.expanded],
    ["unclear", groups.unclear],
    ["exploratory", groups.exploratory],
  ];

  return (
    <div
      role="dialog"
      aria-label="Converge — review what you decided"
      style={{
        width: 360,
        maxHeight: "min(78vh, 640px)",
        display: "flex",
        flexDirection: "column",
        borderRadius: appleVibe.radius.xl,
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.cardHover,
        overflow: "hidden",
        fontFamily: appleVibe.font.stack,
        opacity: transitioning ? 0 : 1,
        transform: transitioning ? "translateY(6px) scale(0.99)" : "none",
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "16px 16px 12px",
          borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            flexShrink: 0,
            borderRadius: 10,
            background: `${accent}14`,
            color: accent,
          }}
        >
          <Sparkles style={{ width: 16, height: 16 }} strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 650,
              letterSpacing: "-0.01em",
              color: appleVibe.text.primary,
            }}
          >
            Converge
          </div>
          <div style={{ fontSize: 12, color: appleVibe.text.secondary }}>
            Mark what you actually decided
          </div>
        </div>
        <button
          type="button"
          onClick={focus.close}
          aria-label="Close"
          title="Close"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "transparent",
            color: appleVibe.text.tertiary,
          }}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
        </button>
      </div>

      {/* Kept counter */}
      <div
        style={{
          padding: "10px 16px",
          fontSize: 12,
          color: appleVibe.text.secondary,
          borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
        }}
      >
        <strong style={{ color: appleVibe.text.primary, fontWeight: 650 }}>
          {keptCount}
        </strong>{" "}
        kept · {Math.max(0, scoped.length - keptCount)} set aside
      </div>

      {/* Sections (scrollable) */}
      <div style={{ overflowY: "auto", padding: "6px 8px 10px", flex: 1 }}>
        {scoped.length === 0 && (
          <div
            style={{
              padding: "28px 16px",
              textAlign: "center",
              fontSize: 12.5,
              color: appleVibe.text.tertiary,
            }}
          >
            Nothing on the board yet — add cards, then converge.
          </div>
        )}

        {ordered.map(([bucket, items]) => {
          if (items.length === 0) return null;
          const meta = SECTION[bucket];
          const { Icon } = meta;
          return (
            <div key={bucket} style={{ marginTop: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                }}
              >
                <Icon
                  style={{ width: 13, height: 13, color: meta.color }}
                  strokeWidth={2.2}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 650,
                    letterSpacing: "0.01em",
                    color: appleVibe.text.secondary,
                  }}
                >
                  {meta.label}
                </span>
                <span style={{ fontSize: 11, color: appleVibe.text.faint }}>
                  {meta.hint}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                    color: appleVibe.text.faint,
                  }}
                >
                  {items.length}
                </span>
              </div>

              {items.map(({ node, mark }) => {
                const kept = keptIds.has(node.id);
                const active = hoveredNodeId === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    title={mark.why}
                    onMouseEnter={() => {
                      focus.setHoveredNodeId(node.id);
                      onFocusNode?.(node.id);
                    }}
                    onMouseLeave={() => {
                      focus.setHoveredNodeId(null);
                      onFocusNode?.(null);
                    }}
                    onClick={() => toggle(node.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 12,
                      textAlign: "left",
                      cursor: "pointer",
                      border: "1px solid transparent",
                      background: active
                        ? appleVibe.surface.chipHover
                        : "transparent",
                      transition: "background 120ms ease",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        borderRadius: 6,
                        background: kept ? accent : "transparent",
                        border: kept
                          ? `1px solid ${accent}`
                          : `1.5px solid ${appleVibe.stroke.medium}`,
                        color: appleVibe.text.onAccent,
                        transition: "all 120ms ease",
                      }}
                    >
                      {kept && (
                        <Check style={{ width: 12, height: 12 }} strokeWidth={3} />
                      )}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: 1.3,
                        color: kept
                          ? appleVibe.text.primary
                          : appleVibe.text.tertiary,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {node.label || "Untitled"}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Publish */}
      <div
        style={{
          padding: 12,
          borderTop: `1px solid ${appleVibe.stroke.hairline}`,
        }}
      >
        <button
          type="button"
          onClick={publish}
          disabled={keptCount === 0 || publishing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            width: "100%",
            padding: "11px 14px",
            borderRadius: appleVibe.radius.md,
            border: "none",
            cursor: keptCount === 0 || publishing ? "default" : "pointer",
            background: keptCount === 0 ? appleVibe.surface.chip : accent,
            color:
              keptCount === 0 ? appleVibe.text.faint : appleVibe.text.onAccent,
            fontSize: 13.5,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            boxShadow:
              keptCount === 0 || publishing
                ? "none"
                : `0 8px 20px -8px ${accent}88`,
            transition: "background 140ms ease, box-shadow 140ms ease",
          }}
        >
          {publishing ? (
            <>
              <Loader2
                style={{ width: 15, height: 15 }}
                strokeWidth={2.4}
                className="animate-spin"
              />
              Publishing…
            </>
          ) : (
            <>
              Publish {keptCount} to Strategy Brief
              <ArrowRight style={{ width: 15, height: 15 }} strokeWidth={2.4} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

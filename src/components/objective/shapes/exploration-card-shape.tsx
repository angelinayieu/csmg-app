"use client";

// ── ExplorationCardShapeUtil ──────────────────────────────────────────
//
// The on-demand BRAINSTORM card (the diverge half of the Crucible). Forked from
// the "Explore top" button on the ambiguity-heatmap / priority-map cards. For
// one ambiguity it shows:
//   • the PRINCIPLE — the invariant that holds across every variation (the
//     intersection = a first-principle candidate),
//   • the VARIATIONS — K genuinely-different resolutions, each a swappable BLOCK
//     (click to choose; the recommended one is starred),
//   • the DECISIONS — the axes the variations disagree on (what's left to decide).
//
// Self-fetching like the crucible-card: scalar tldraw props only; the block is
// fetched from /explore-ambiguity. On mount it runs the explore (once), stamps
// the resulting objectId back into props so a reload re-fetches instead of
// re-spending. Persisted as a library_objects("decision") row (the block).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  useEditor,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { Loader2, Sparkles, Check, Star, GitBranch, AlertCircle } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { ExplorationBlock } from "@/lib/objective-canvas/crucible/crucible-types";

export const EXPLORE_COLOR = "#0EA5A4"; // teal — "exploration / divergence"

export type ExplorationCardShape = TLBaseShape<
  "exploration-card",
  {
    w: number;
    h: number;
    spaceId: string;
    /** The ambiguity title to explore. */
    headline: string;
    /** The question to resolve (optional). */
    question: string;
    /** Heatmap zone / priority slug it forked from (display + provenance). */
    source: string;
    /** library_objects.id once explored — empty until the first run. */
    objectId: string;
    color: string;
  }
>;

export class ExplorationCardShapeUtil extends BaseBoxShapeUtil<ExplorationCardShape> {
  static override type = "exploration-card" as const;
  static override props: RecordProps<ExplorationCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    headline: T.string,
    question: T.string,
    source: T.string,
    objectId: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  getDefaultProps(): ExplorationCardShape["props"] {
    return {
      w: 380,
      h: 440,
      spaceId: "",
      headline: "",
      question: "",
      source: "",
      objectId: "",
      color: EXPLORE_COLOR,
    };
  }

  component(shape: ExplorationCardShape) {
    return <ExplorationCardRenderer shape={shape} />;
  }

  indicator(shape: ExplorationCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function ExplorationCardRenderer({ shape }: { shape: ExplorationCardShape }) {
  const editor = useEditor();
  const { w, h, spaceId, headline, question, source, objectId, color } = shape.props;
  const [block, setBlock] = useState<ExplorationBlock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const startedRef = useRef(false);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await fetch(`/api/objective/${spaceId}/explore-ambiguity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      return (await r.json()) as { objectId: string | null; block: ExplorationBlock | null };
    },
    [spaceId],
  );

  // Mount: explore (first time) or re-fetch the persisted block (reload).
  useEffect(() => {
    if (!spaceId || !headline || startedRef.current) return;
    startedRef.current = true;
    let alive = true;
    (async () => {
      try {
        if (objectId) {
          const j = await post({ action: "get", objectId });
          if (alive && j.block) setBlock(j.block);
          else if (alive) await runExplore(alive);
        } else {
          await runExplore(alive);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Exploration failed");
      }
    })();

    async function runExplore(isAlive: boolean) {
      const j = await post({ action: "explore", headline, question, source });
      if (!isAlive) return;
      if (j.block) setBlock(j.block);
      // Stamp the objectId so a reload re-fetches instead of re-spending.
      if (j.objectId && j.objectId !== objectId) {
        editor.updateShape<ExplorationCardShape>({
          id: shape.id,
          type: "exploration-card",
          props: { objectId: j.objectId },
        });
      }
    }

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, headline]);

  const swap = useCallback(
    async (index: number) => {
      const id = shape.props.objectId;
      if (!id || swapping || index === block?.activeIndex) return;
      setSwapping(true);
      // Optimistic.
      setBlock((b) => (b ? { ...b, activeIndex: index } : b));
      try {
        const j = await post({ action: "swap", objectId: id, activeIndex: index });
        if (j.block) setBlock(j.block);
      } catch {
        /* keep optimistic */
      } finally {
        setSwapping(false);
      }
    },
    [shape.props.objectId, swapping, block?.activeIndex, post],
  );

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onPointerDown={stopEventPropagation}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          background:
            "linear-gradient(165deg, rgba(255,255,255,0.99) 0%, rgba(244,251,251,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 20px 50px -20px ${color}55, 0 8px 22px -12px rgba(11,18,40,0.16)`,
          fontFamily: appleVibe.font.stack,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(15,23,42,0.06)",
          }}
        >
          <GitBranch style={{ width: 15, height: 15, color, marginTop: 1, flexShrink: 0 }} strokeWidth={2.4} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color }}>
              Exploring
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: appleVibe.text.primary, lineHeight: 1.25, marginTop: 1 }}>
              {headline}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          onWheelCapture={(e) => e.stopPropagation()}
          style={{ flex: 1, overflowY: "auto", padding: "10px 14px 12px", minHeight: 0 }}
        >
          {!block && !error && (
            <div style={hintRow}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Diverging into
              variations…
            </div>
          )}
          {error && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#DC2626" }}>
              <AlertCircle style={{ width: 13, height: 13 }} /> {error}
            </div>
          )}

          {block && (
            <>
              {question && <div style={questionRow}>{question}</div>}

              {/* Principle — the intersection (first-principle candidate). */}
              {block.principle && (
                <div style={principleBox(color)}>
                  <div style={principleLabel(color)}>True either way</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: appleVibe.text.primary }}>
                    {block.principle}
                  </div>
                </div>
              )}

              {/* Variations — swappable blocks. */}
              <div style={sectionLabel}>Variations · tap to choose</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 5 }}>
                {block.variations.map((v, i) => {
                  const active = i === block.activeIndex;
                  const recommended = i === block.recommendedIndex;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onPointerDown={stopEventPropagation}
                      onClick={() => swap(i)}
                      style={variationRow(active, color)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {active ? (
                          <Check style={{ width: 12, height: 12, color, flexShrink: 0 }} strokeWidth={3} />
                        ) : (
                          <span style={dot} />
                        )}
                        <span style={{ fontSize: 12, fontWeight: 700, color: appleVibe.text.primary }}>
                          {v.label}
                        </span>
                        {recommended && (
                          <span style={recoChip(color)}>
                            <Star style={{ width: 8, height: 8 }} fill="currentColor" strokeWidth={0} /> pick
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.secondary, marginTop: 2 }}>
                        {v.value}
                      </div>
                      {v.implication && (
                        <div style={{ fontSize: 10.5, lineHeight: 1.4, color: appleVibe.text.tertiary, marginTop: 2 }}>
                          → {v.implication}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Decisions — the differences (what's left to decide). */}
              {block.decisions.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={sectionLabel}>Still to decide</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 5 }}>
                    {block.decisions.map((d, i) => (
                      <div key={i} style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 650, color: appleVibe.text.primary }}>{d.axis}:</span>{" "}
                        <span style={{ color: appleVibe.text.tertiary }}>{d.options.join("  ·  ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

// ── styles ──
const hintRow = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12.5,
  color: appleVibe.text.tertiary,
  padding: "8px 2px",
} as const;
const questionRow = {
  fontSize: 11.5,
  lineHeight: 1.45,
  color: appleVibe.text.tertiary,
  marginBottom: 8,
} as const;
function principleBox(color: string) {
  return {
    background: `${color}0F`,
    border: `1px solid ${color}33`,
    borderRadius: 12,
    padding: "9px 11px",
    marginBottom: 12,
  } as const;
}
function principleLabel(color: string) {
  return {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color,
    marginBottom: 3,
  } as const;
}
const sectionLabel = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: appleVibe.text.tertiary,
} as const;
function variationRow(active: boolean, color: string) {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    textAlign: "left",
    width: "100%",
    padding: "8px 10px",
    borderRadius: 11,
    border: active ? `1.5px solid ${color}` : "1px solid rgba(15,23,42,0.10)",
    background: active ? `${color}0C` : "#FFFFFF",
    cursor: "pointer",
    fontFamily: appleVibe.font.stack,
  } as const;
}
const dot = {
  width: 12,
  height: 12,
  borderRadius: 999,
  border: "1.5px solid rgba(15,23,42,0.25)",
  flexShrink: 0,
  display: "inline-block",
} as const;
function recoChip(color: string) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    marginLeft: "auto",
    fontSize: 8.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color,
    background: `${color}18`,
    padding: "1px 6px",
    borderRadius: 999,
  } as const;
}

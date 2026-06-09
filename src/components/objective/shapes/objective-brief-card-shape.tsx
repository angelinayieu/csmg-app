"use client";

// ── ObjectiveBriefCardShapeUtil ───────────────────────────────────────
//
// The composed objective brief — the "final product" of intake. Reads the
// blocks the Crucible + exploration slice persist and renders the objective as
// ~6 typed SLOTS:
//   Intent · First principles · Optimization points · Constraints ·
//   Open decisions (SWAPPABLE in place) · Variables
//
// Additive building-block view: block-backed slots render their blocks; if no
// blocks exist yet it falls back to the bare objective (prose). Each block row
// click → OPEN_CARD_DETAIL for the underlying library_object. A decision slot's
// variations are swappable here (reuses /explore-ambiguity swap). Self-fetches
// /brief; scalar tldraw props only.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { Loader2, FileText, RefreshCw, Check, Anchor, Target, Ban, GitBranch, Sigma } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { OPEN_CARD_DETAIL_EVENT } from "@/components/objective/canvas-interactions/object-detail-drawer";
import type { ObjectiveBrief } from "@/lib/objective-canvas/crucible/crucible-types";

export const BRIEF_COLOR = "#4F46E5"; // indigo — "composed / synthesis"

export type ObjectiveBriefCardShape = TLBaseShape<
  "objective-brief-card",
  {
    w: number;
    h: number;
    spaceId: string;
    color: string;
  }
>;

export class ObjectiveBriefCardShapeUtil extends BaseBoxShapeUtil<ObjectiveBriefCardShape> {
  static override type = "objective-brief-card" as const;
  static override props: RecordProps<ObjectiveBriefCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  getDefaultProps(): ObjectiveBriefCardShape["props"] {
    return { w: 420, h: 540, spaceId: "", color: BRIEF_COLOR };
  }

  component(shape: ObjectiveBriefCardShape) {
    return <ObjectiveBriefRenderer shape={shape} />;
  }

  indicator(shape: ObjectiveBriefCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function openObject(objectId: string | null) {
  if (!objectId) return;
  window.dispatchEvent(
    new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail: { objectId } }),
  );
}

function ObjectiveBriefRenderer({ shape }: { shape: ObjectiveBriefCardShape }) {
  const { w, h, spaceId, color } = shape.props;
  const [brief, setBrief] = useState<ObjectiveBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const swapBusy = useRef(false);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/objective/${spaceId}/brief`, { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { brief?: ObjectiveBrief };
        if (j.brief) setBrief(j.brief);
      }
    } catch {
      /* leave prior */
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Swap a decision block's chosen variation in place (reuses explore-ambiguity).
  const swapDecision = useCallback(
    async (objectId: string | null, index: number) => {
      if (!objectId || swapBusy.current) return;
      swapBusy.current = true;
      // Optimistic.
      setBrief((b) =>
        b
          ? {
              ...b,
              decisions: b.decisions.map((d) =>
                d.objectId === objectId ? { ...d, activeIndex: index } : d,
              ),
            }
          : b,
      );
      try {
        await fetch(`/api/objective/${spaceId}/explore-ambiguity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "swap", objectId, activeIndex: index }),
        });
      } catch {
        /* keep optimistic */
      } finally {
        swapBusy.current = false;
      }
    },
    [spaceId],
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
            "linear-gradient(165deg, rgba(255,255,255,0.99) 0%, rgba(247,247,253,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 22px 54px -20px ${color}55, 0 8px 22px -12px rgba(11,18,40,0.16)`,
          fontFamily: appleVibe.font.stack,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px 10px",
            borderBottom: "1px solid rgba(15,23,42,0.06)",
          }}
        >
          <FileText style={{ width: 15, height: 15, color }} strokeWidth={2.4} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: appleVibe.text.primary }}>
            Objective brief
          </span>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={() => load()}
            title="Refresh from the latest blocks"
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: appleVibe.text.tertiary,
            }}
          >
            {loading ? (
              <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
            ) : (
              <RefreshCw style={{ width: 13, height: 13 }} strokeWidth={2.2} />
            )}
          </button>
        </div>

        {/* Body */}
        <div
          onWheelCapture={(e) => e.stopPropagation()}
          style={{ flex: 1, overflowY: "auto", padding: "10px 14px 14px", minHeight: 0 }}
        >
          {!brief && loading && (
            <div style={hintRow}>
              <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Composing…
            </div>
          )}

          {brief && (
            <>
              {/* Intent */}
              <Slot icon={<Target style={iconStyle(color)} />} label="Intent" color={color}>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: appleVibe.text.primary }}>
                  {brief.objective || "(objective not set yet)"}
                </div>
                <div style={{ fontSize: 11, color: appleVibe.text.tertiary, marginTop: 2 }}>
                  {brief.title}
                </div>
              </Slot>

              {!brief.hasBlocks && (
                <div style={{ ...hintRow, marginTop: 8 }}>
                  Run the Crucible + Explore to fill the brief with blocks.
                </div>
              )}

              {/* First principles — the bedrock */}
              {brief.firstPrinciples.length > 0 && (
                <Slot icon={<Anchor style={iconStyle("#7C3AED")} />} label="First principles" color="#7C3AED">
                  {brief.firstPrinciples.map((fp) => (
                    <Row key={fp.objectId ?? fp.label} onClick={() => openObject(fp.objectId)}>
                      <span style={rowTitle}>{fp.statement || fp.label}</span>
                      {fp.score > 0 && <span style={scorePill("#7C3AED")}>{fp.score}</span>}
                    </Row>
                  ))}
                </Slot>
              )}

              {/* Optimization points — the levers */}
              {brief.optimizationPoints.length > 0 && (
                <Slot icon={<Sigma style={iconStyle("#F59E0B")} />} label="Optimization points" color="#F59E0B">
                  {brief.optimizationPoints.map((lp) => (
                    <Row key={lp.objectId ?? lp.label} onClick={() => openObject(lp.objectId)}>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={rowTitle}>{lp.label}</span>
                        {lp.meadowsLevel && (
                          <span style={metaText}> · {lp.meadowsLevel}</span>
                        )}
                      </span>
                      {lp.score > 0 && <span style={scorePill("#F59E0B")}>{lp.score}</span>}
                    </Row>
                  ))}
                </Slot>
              )}

              {/* Sub-objectives — coined branches (Phase 4) */}
              {brief.subObjectives.length > 0 && (
                <Slot icon={<Target style={iconStyle("#0EA5E9")} />} label="Sub-objectives" color="#0EA5E9">
                  {brief.subObjectives.map((so) => (
                    <Row key={so.objectId ?? so.title} onClick={() => openObject(so.objectId)}>
                      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                        <span style={rowTitle}>{so.title}</span>
                        {so.rationale && <span style={metaText}>{so.rationale}</span>}
                      </span>
                    </Row>
                  ))}
                </Slot>
              )}

              {/* Seed features — concrete builds to expand (Phase 4) */}
              {brief.features.length > 0 && (
                <Slot label="Seed features" color="#2563EB">
                  {brief.features.map((f) => (
                    <Row key={f.objectId ?? f.title} onClick={() => openObject(f.objectId)}>
                      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                        <span style={rowTitle}>{f.title}</span>
                        {f.description && <span style={metaText}>{f.description}</span>}
                      </span>
                      {f.score > 0 && <span style={scorePill("#2563EB")}>{f.score}</span>}
                    </Row>
                  ))}
                </Slot>
              )}

              {/* Open decisions — swappable blocks */}
              {brief.decisions.length > 0 && (
                <Slot icon={<GitBranch style={iconStyle("#0EA5A4")} />} label="Open decisions" color="#0EA5A4">
                  {brief.decisions.map((d) => {
                    const active = d.variations[d.activeIndex] ?? d.variations[0];
                    return (
                      <div key={d.objectId ?? d.headline} style={{ marginBottom: 8 }}>
                        <button
                          type="button"
                          onPointerDown={stopEventPropagation}
                          onClick={() => openObject(d.objectId)}
                          style={{ ...rowBtn, marginBottom: 4 }}
                        >
                          <span style={rowTitle}>{d.headline}</span>
                        </button>
                        {d.principle && (
                          <div style={{ fontSize: 10.5, color: "#0EA5A4", fontStyle: "italic", marginBottom: 4 }}>
                            ⌖ {d.principle}
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {d.variations.map((v, i) => {
                            const on = i === d.activeIndex;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onPointerDown={stopEventPropagation}
                                onClick={() => swapDecision(d.objectId, i)}
                                title={v.value}
                                style={variationChip(on)}
                              >
                                {on && <Check style={{ width: 9, height: 9 }} strokeWidth={3} />}
                                {v.label}
                              </button>
                            );
                          })}
                        </div>
                        {active && (
                          <div style={{ fontSize: 11, color: appleVibe.text.secondary, marginTop: 3, lineHeight: 1.4 }}>
                            {active.value}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Slot>
              )}

              {/* Constraints */}
              {brief.constraints.length > 0 && (
                <Slot icon={<Ban style={iconStyle("#E11D48")} />} label="Constraints" color="#E11D48">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {brief.constraints.map((c) => (
                      <button
                        key={c.objectId ?? c.label}
                        type="button"
                        onPointerDown={stopEventPropagation}
                        onClick={() => openObject(c.objectId)}
                        title={c.why || c.label}
                        style={constraintChip(c.kind)}
                      >
                        {c.label}
                        <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 9 }}>{c.kind}</span>
                      </button>
                    ))}
                  </div>
                </Slot>
              )}

              {/* Variables */}
              {brief.variables.length > 0 && (
                <Slot label="Variables" color={appleVibe.text.tertiary}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {brief.variables.map((v) => (
                      <button
                        key={v.objectId ?? v.label}
                        type="button"
                        onPointerDown={stopEventPropagation}
                        onClick={() => openObject(v.objectId)}
                        title={v.note || v.label}
                        style={varChip}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </Slot>
              )}
            </>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

// ── small presentational helpers ──
function Slot({
  icon,
  label,
  color,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color }}>
          {label}
        </span>
      </div>
      {children}
    </section>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onPointerDown={stopEventPropagation} onClick={onClick} style={rowBtn}>
      {children}
    </button>
  );
}

const iconStyle = (c: string) => ({ width: 12, height: 12, color: c }) as const;
const hintRow = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: appleVibe.text.tertiary,
  padding: "6px 2px",
} as const;
const rowBtn = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: 9,
  border: "1px solid rgba(15,23,42,0.07)",
  background: "#FFFFFF",
  cursor: "pointer",
  marginBottom: 4,
  fontFamily: appleVibe.font.stack,
} as const;
const rowTitle = { fontSize: 12, fontWeight: 600, color: appleVibe.text.primary, lineHeight: 1.35 } as const;
const metaText = { fontSize: 10.5, color: appleVibe.text.tertiary } as const;
function scorePill(c: string) {
  return {
    marginLeft: "auto",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
    color: c,
    background: `${c}18`,
    padding: "1px 7px",
    borderRadius: 999,
    fontVariantNumeric: "tabular-nums",
  } as const;
}
function variationChip(on: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 10.5,
    fontWeight: 650,
    padding: "3px 9px",
    borderRadius: 999,
    border: on ? "1.5px solid #0EA5A4" : "1px solid rgba(15,23,42,0.12)",
    background: on ? "#0EA5A40C" : "#FFFFFF",
    color: on ? "#0E7C7B" : appleVibe.text.secondary,
    cursor: "pointer",
    fontFamily: appleVibe.font.stack,
  } as const;
}
function constraintChip(kind: "hard" | "soft") {
  const c = kind === "hard" ? "#E11D48" : "#94A3B8";
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 10.5,
    fontWeight: 650,
    padding: "3px 9px",
    borderRadius: 999,
    border: `1px solid ${c}44`,
    background: `${c}10`,
    color: c,
    cursor: "pointer",
    fontFamily: appleVibe.font.stack,
  } as const;
}
const varChip = {
  fontSize: 10.5,
  fontWeight: 600,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(15,23,42,0.03)",
  color: appleVibe.text.secondary,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
} as const;

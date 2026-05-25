"use client";

// ── Seed Card shape ────────────────────────────────────────────────
//
// Phase C — surfaces typed clarifier answers on the canvas at mount.
// Quiet modes (brain_probe / brainstorm_speed) skip the pipeline, so
// MCQ answers would otherwise die in `synthesis_data.user_assertions`
// with no reader. This shape is the reader.
//
// Spawn site: src/components/canvas/interaxis-canvas.tsx — a first-
// mount useEffect that reads `space.synthesis_data.user_assertions`
// and creates one card per typed assertion, arranged in a left rail.
//
// Per-kind visuals are kept restrained: each card carries a one-word
// kind label, the user's answer (the headline), and the question that
// generated it as a subdued caption. A footer chip exposes the
// "promote to entity" action — turns the card into a real KG node
// with `metadata.provenance = "user_asserted"` so downstream expand
// calls can pick it up as a seed.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useState } from "react";
import {
  Compass,
  Sliders,
  Target,
  Square,
  Activity,
  Shield,
  Sparkles,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import type { SeedCardShape } from "./types";

export const SEED_CARD_DEFAULT_W = 220;
export const SEED_CARD_DEFAULT_H = 132;

// Per-kind visual identity. Kept compact: tone, icon, single-word
// label. All six kinds use distinct hues so a left-rail grid of mixed
// kinds reads as visually segmented at a glance.
const KIND_VISUALS: Record<
  SeedCardShape["props"]["kind"],
  {
    accent: string;
    bg: string;
    ring: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
  }
> = {
  angle: {
    accent: "#7C3AED", // violet-600 — exploration
    bg: "rgba(124,58,237,0.06)",
    ring: "rgba(124,58,237,0.22)",
    Icon: Compass,
    label: "Angle",
  },
  axis: {
    accent: "#0EA5E9", // sky-500 — variation
    bg: "rgba(14,165,233,0.06)",
    ring: "rgba(14,165,233,0.22)",
    Icon: Sliders,
    label: "Axis",
  },
  metric: {
    accent: "#10B981", // emerald-600 — targets
    bg: "rgba(16,185,129,0.06)",
    ring: "rgba(16,185,129,0.22)",
    Icon: Target,
    label: "Metric",
  },
  boundary: {
    accent: "#F59E0B", // amber-500 — scope
    bg: "rgba(245,158,11,0.06)",
    ring: "rgba(245,158,11,0.22)",
    Icon: Square,
    label: "Boundary",
  },
  state: {
    accent: "#EC4899", // pink-500 — observability
    bg: "rgba(236,72,153,0.06)",
    ring: "rgba(236,72,153,0.22)",
    Icon: Activity,
    label: "State",
  },
  constraint: {
    accent: "#64748B", // slate-500 — bounds
    bg: "rgba(100,116,139,0.06)",
    ring: "rgba(100,116,139,0.20)",
    Icon: Shield,
    label: "Constraint",
  },
};

export class SeedCardShapeUtil extends BaseBoxShapeUtil<SeedCardShape> {
  static override type = "seed-card" as const;
  static override props: RecordProps<SeedCardShape> = {
    w: T.number,
    h: T.number,
    slot: T.string,
    kind: T.literalEnum(
      "angle",
      "axis",
      "boundary",
      "metric",
      "state",
      "constraint",
    ),
    question: T.string,
    value: T.string,
    answeredAt: T.string,
    // T.any matches the nullable pattern used by mechanism-card-shape's
    // rationale/cyclePattern. tldraw's T.string would narrow to non-null
    // and reject a freshly-spawned card with no promoted entity yet.
    promotedEntityId: T.any,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => true;

  override onResize = (
    shape: SeedCardShape,
    info: TLResizeInfo<SeedCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): SeedCardShape["props"] {
    return {
      w: SEED_CARD_DEFAULT_W,
      h: SEED_CARD_DEFAULT_H,
      slot: "constraint",
      kind: "constraint",
      question: "",
      value: "",
      answeredAt: new Date().toISOString(),
      promotedEntityId: null,
    };
  }

  component(shape: SeedCardShape) {
    return <SeedCardView shape={shape} />;
  }

  indicator(shape: SeedCardShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />
    );
  }
}

function SeedCardView({ shape }: { shape: SeedCardShape }) {
  const { w, h, kind, question, value, promotedEntityId } = shape.props;
  const visuals = KIND_VISUALS[kind] ?? KIND_VISUALS.constraint;
  const Icon = visuals.Icon;
  const promoted = !!promotedEntityId;
  const [promoting, setPromoting] = useState(false);

  // Promote → entity. Reads spaceId off the shape's meta (set by the
  // spawner) so the util stays stateless. Soft-fails — UI just stays
  // un-promoted on error and the user can retry; no toast plumbing
  // here (shape utils shouldn't depend on the app toast layer).
  const handlePromote = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (promoted || promoting) return;
    const spaceId = (shape.meta as { spaceId?: string } | undefined)?.spaceId;
    if (!spaceId) return;
    setPromoting(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/promote-seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          shapeId: shape.id,
          slot: shape.props.slot,
          kind: shape.props.kind,
          question: shape.props.question,
          value: shape.props.value,
        }),
      });
      if (!res.ok) throw new Error(`promote failed (${res.status})`);
      const data = (await res.json()) as { entityId?: string };
      // Dispatch a synthetic event the canvas can listen on to update
      // the shape's promotedEntityId — keeps the shape util ignorant
      // of the editor instance.
      if (data?.entityId) {
        window.dispatchEvent(
          new CustomEvent("seed-card:promoted", {
            detail: { shapeId: shape.id, entityId: data.entityId },
          }),
        );
      }
    } catch {
      // soft-fail; user can retry
    } finally {
      setPromoting(false);
    }
  };

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        background: "white",
        border: `1.5px solid ${visuals.ring}`,
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "0 1px 3px rgba(11,13,18,0.04)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
        overflow: "hidden",
      }}
    >
      {/* Header row — kind icon + label + promoted indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            background: visuals.bg,
            color: visuals.accent,
            flexShrink: 0,
          }}
        >
          <Icon size={13} />
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: visuals.accent,
            flex: 1,
            minWidth: 0,
          }}
        >
          {visuals.label}
        </span>
        {promoted && (
          <span
            title="Promoted to entity"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 8.5,
              fontWeight: 600,
              color: "#10B981",
              flexShrink: 0,
            }}
          >
            <CheckCircle2 size={10} />
            pinned
          </span>
        )}
      </div>

      {/* The user's answer — headline */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#0B0D12",
          letterSpacing: "-0.01em",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        title={value}
      >
        {value}
      </div>

      {/* The question that produced it — caption */}
      {question && (
        <div
          style={{
            fontSize: 10.5,
            color: "rgba(11,13,18,0.50)",
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
          }}
          title={question}
        >
          {question}
        </div>
      )}

      {/* Footer — promote-to-entity CTA. Disabled once already promoted. */}
      <button
        type="button"
        onClick={handlePromote}
        onPointerDown={stopEventPropagation}
        disabled={promoted || promoting}
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          height: 26,
          borderRadius: 7,
          border: `1px solid ${promoted ? "rgba(16,185,129,0.30)" : visuals.ring}`,
          background: promoted ? "rgba(16,185,129,0.06)" : visuals.bg,
          color: promoted ? "#10B981" : visuals.accent,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.02em",
          cursor: promoted || promoting ? "default" : "pointer",
          opacity: promoted || promoting ? 0.85 : 1,
          transition: "background 120ms ease",
        }}
      >
        {promoting ? (
          <>
            <Loader2 size={11} className="animate-spin" />
            Promoting…
          </>
        ) : promoted ? (
          <>
            <CheckCircle2 size={11} />
            On graph
          </>
        ) : (
          <>
            <Sparkles size={11} />
            Promote to entity
          </>
        )}
      </button>
    </HTMLContainer>
  );
}

"use client";

import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VariantVM } from "../strategy-view-model";

interface VariantCardProps {
  variant: VariantVM;
  active: boolean;
  onClick: () => void;
}

/**
 * Custom layer-stack icon — three offset rounded squares with
 * descending opacity, the foremost filled in the layer's accent color.
 * Mirrors the canvas strategy-hero-card layer chip so users recognize
 * "this is the same concept" across the two surfaces. No emoji, no
 * Lucide; pure inline geometric SVG.
 */
function LayerStackIcon({ color }: { color: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <rect
        x="1.4"
        y="1.4"
        width="6.4"
        height="6.4"
        rx="1.6"
        ry="1.6"
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.38"
      />
      <rect
        x="3"
        y="3"
        width="6.4"
        height="6.4"
        rx="1.6"
        ry="1.6"
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.7"
      />
      <rect
        x="4.6"
        y="4.6"
        width="6.4"
        height="6.4"
        rx="1.6"
        ry="1.6"
        fill={color}
        stroke={color}
        strokeWidth="1.2"
        fillOpacity="0.92"
      />
    </svg>
  );
}

export function VariantCard({ variant, active, onClick }: VariantCardProps) {
  const lf = variant.layerFocus;
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative text-left rounded-[10px] cursor-pointer transition-all",
        active
          ? "px-[15.5px] py-[13.5px]"
          : "px-4 py-3.5 hover:bg-gray-50",
      )}
      style={
        active
          ? {
              background: "#fff",
              border: "1.5px solid var(--accent-600)",
              boxShadow: "0 4px 12px rgba(var(--accent-rgb), 0.12)",
              overflow: "hidden",
            }
          : {
              background: "#fff",
              border: "1px solid rgba(11,13,18,0.08)",
              overflow: "hidden",
            }
      }
    >
      {/* E3 — layer-stratified accent stripe on the left edge. Mirrors
          the strategy-hero card's accent stripe so the same variant
          reads the same way on both surfaces. Only renders when this
          variant is layer-stratified; comprehensive variants get the
          standard "top ranked" accent above instead. Gradient fades
          from layer color (top) through 50% (middle) to transparent
          (bottom) — reads as light emanating from the top-left rather
          than a flat color block. */}
      {lf && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0"
          style={{
            width: 3,
            background: `linear-gradient(180deg, ${lf.color} 0%, color-mix(in srgb, ${lf.color} 55%, transparent) 55%, transparent 100%)`,
            pointerEvents: "none",
          }}
        />
      )}

      {active && (
        <span
          className="absolute -top-px left-0 right-0 rounded-t-[10px]"
          style={{ height: 3, background: "var(--accent-600)" }}
        />
      )}

      {variant.crown && (
        <span
          className="absolute -top-2 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8.5px] font-bold uppercase text-white"
          style={{
            background: "var(--accent-600)",
            letterSpacing: "0.12em",
          }}
        >
          <Crown className="w-2 h-2" />
          Top ranked
        </span>
      )}

      <div
        className="font-mono mb-1"
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(11,13,18,0.48)",
        }}
      >
        Variant {String.fromCharCode(64 + variant.rank)} · #{variant.rank}
      </div>
      <div
        className="font-bold mb-1"
        style={{
          fontSize: 13,
          color: "#0B0D12",
          letterSpacing: "-0.015em",
          lineHeight: 1.3,
        }}
      >
        {variant.title}
      </div>
      <p
        className="mb-2.5"
        style={{
          fontSize: 11,
          color: "rgba(11,13,18,0.74)",
          lineHeight: 1.45,
        }}
      >
        {variant.approach}
      </p>

      {/* E3 — Layer focus chip. visionOS aesthetic: glass surface, soft
          tinted glow from the layer color, custom layer-stack SVG icon,
          rounded pill. Renders inline ABOVE the metrics row so the
          chip reads as "this variant emphasizes ____" before the user
          parses Impact / Risk / ROI. For comprehensive variants
          (layerFocus === null), a muted neutral chip renders saying
          "All layers" so the row stays visually balanced across the
          variant grid — the column never collapses, just changes
          character. */}
      <div className="mb-2.5">
        {lf ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full"
            title={
              lf.rationale && lf.rationale.length > 0
                ? `Layer focus: ${lf.label}. ${lf.rationale}`
                : `Variant emphasizes the ${lf.label} layer.`
            }
            style={{
              padding: "3px 9px 3px 7px",
              background: `linear-gradient(135deg, rgba(255,255,255,0.82) 0%, color-mix(in srgb, ${lf.color} 7%, rgba(255,255,255,0.82)) 100%)`,
              backdropFilter: "blur(14px) saturate(160%)",
              WebkitBackdropFilter: "blur(14px) saturate(160%)",
              border: `1px solid color-mix(in srgb, ${lf.color} 30%, transparent)`,
              boxShadow: `0 1px 0 rgba(255,255,255,0.6) inset, 0 0 0 1px rgba(255,255,255,0.42) inset, 0 4px 12px -8px ${lf.color}`,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: `color-mix(in srgb, ${lf.color} 80%, #0b0d12)`,
              lineHeight: 1,
            }}
          >
            <LayerStackIcon color={lf.color} />
            <span>{lf.label}</span>
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 rounded-full"
            title="Comprehensive variant — draws from all layers of the domain ontology rather than emphasizing a single one."
            style={{
              padding: "3px 9px 3px 7px",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.78) 0%, rgba(11,13,18,0.025) 100%)",
              backdropFilter: "blur(14px) saturate(160%)",
              WebkitBackdropFilter: "blur(14px) saturate(160%)",
              border: "1px solid rgba(11,13,18,0.10)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.6) inset, 0 0 0 1px rgba(255,255,255,0.42) inset",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "rgba(11,13,18,0.55)",
              lineHeight: 1,
            }}
          >
            {/* Neutral icon variant — three rounded squares all in muted
                gray + lower opacity, signaling "draws from many layers,
                not one." */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 13 13"
              fill="none"
              aria-hidden
              style={{ flexShrink: 0 }}
            >
              <rect
                x="1.4"
                y="1.4"
                width="6.4"
                height="6.4"
                rx="1.6"
                fill="none"
                stroke="rgba(11,13,18,0.45)"
                strokeWidth="1.2"
                opacity="0.42"
              />
              <rect
                x="3"
                y="3"
                width="6.4"
                height="6.4"
                rx="1.6"
                fill="none"
                stroke="rgba(11,13,18,0.45)"
                strokeWidth="1.2"
                opacity="0.62"
              />
              <rect
                x="4.6"
                y="4.6"
                width="6.4"
                height="6.4"
                rx="1.6"
                fill="rgba(11,13,18,0.45)"
                stroke="rgba(11,13,18,0.45)"
                strokeWidth="1.2"
                fillOpacity="0.55"
              />
            </svg>
            <span>All layers</span>
          </span>
        )}
      </div>

      <div
        className="grid grid-cols-3 gap-2 pt-2"
        style={{ borderTop: "1px solid rgba(11,13,18,0.08)" }}
      >
        {[
          { l: "Impact", v: variant.impact.display, up: variant.impact.numeric > 0 },
          { l: "Risk", v: variant.risk.display },
          { l: "ROI", v: variant.roi.display },
        ].map((m) => (
          <div key={m.l} className="text-left">
            <div
              className="font-mono mb-0.5"
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(11,13,18,0.48)",
              }}
            >
              {m.l}
            </div>
            <div
              className="tabular-nums"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: m.up ? "#047857" : "#0B0D12",
                letterSpacing: "-0.02em",
              }}
            >
              {m.v}
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}

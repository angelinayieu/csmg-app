"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import type { Entity, Edge } from "@/types";

export interface LabReagentBayProps {
  focal: Entity;
  subunits: Entity[];
  upstreamEdges: Array<{ edge: Edge; partner: Entity }>;
  downstreamEdges: Array<{ edge: Edge; partner: Entity }>;
  hoveredSubunitId: string | null;
  onHoverSubunit: (id: string | null) => void;
  /**
   * Phase 17: if provided, each subunit row becomes a navigation link to
   * the next-lower-scale lab. Returns null for subunits that have no
   * drill target (e.g. stub/synthetic entities).
   */
  subunitDrillHref?: (entity: Entity) => string | null;
  /** Same for bond partners (upstream + downstream). */
  bondDrillHref?: (entity: Entity) => string | null;
  /**
   * Phase 21: per-subunit dials. When provided:
   *   - rows show a small "TUNE" badge (slider icon) users click to point
   *     the control panel at that subunit's parameters
   *   - the currently-tuned subunit gets an amber accent
   *   - null = the focal is the active tuning target
   */
  selectedSubunitId?: string | null;
  onSelectSubunit?: (id: string | null) => void;
  /**
   * Phase 28: slot rendered in the Internal Subunits section's empty
   * state. When not provided, a plain text hint is shown. NodeLab uses
   * this slot to inject the Build Connections CTA.
   */
  subunitsEmptyAction?: ReactNode;
  /**
   * Phase 28: slot rendered in the Internal Subunits section header.
   * Typically a compact "Probe" chip to decompose for more subunits.
   */
  subunitsSectionAction?: ReactNode;
}

const CATEGORY_COLOR: Record<string, string> = {
  concrete: "#4ade80",
  abstract: "#a78bfa",
  process: "#fbbf24",
  relational: "#22d3ee",
  epistemic: "#f472b6",
  fault: "#ef4444",
};

function subunitColor(entity: Entity): string {
  const cat = (entity.entity_category as string) ?? "concrete";
  return CATEGORY_COLOR[cat] ?? "#4ade80";
}

function subunitSymbol(entity: Entity): string {
  // Two-char mnemonic from entity name. Greek if pure initial, else ASCII.
  const words = entity.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLowerCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function weight(entity: Entity): number {
  return Math.round(((entity.confidence as number | null) ?? 0.7) * 100);
}

export function LabReagentBay({
  focal,
  subunits,
  upstreamEdges,
  downstreamEdges,
  hoveredSubunitId,
  onHoverSubunit,
  subunitDrillHref,
  bondDrillHref,
  selectedSubunitId,
  onSelectSubunit,
  subunitsEmptyAction,
  subunitsSectionAction,
}: LabReagentBayProps) {
  const layerLabel = focal.layer ?? "thread";
  const totalSubunitWeight = useMemo(
    () => subunits.reduce((s, u) => s + weight(u), 0),
    [subunits],
  );

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-[var(--lab-panel-bg)]">
      {/* Bay header */}
      <div className="border-b border-[var(--lab-border)] px-4 py-3">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
          Reagent Bay
        </div>
        <div className="text-[14px] font-bold leading-tight text-[var(--lab-text)]">
          Components & Bonds
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Internal Subunits ── */}
        <Section
          title="◉ Internal Subunits"
          count={subunits.length}
          action={subunitsSectionAction}
        >
          {subunits.length === 0 ? (
            subunitsEmptyAction ?? <EmptyHint>No decomposed subunits yet.</EmptyHint>
          ) : (
            subunits.map((s) => {
              const color = subunitColor(s);
              const isHover = hoveredSubunitId === s.id;
              const isTuning = selectedSubunitId === s.id;
              const href = subunitDrillHref?.(s) ?? null;
              const accentColor = isTuning ? "#fbbf24" : color;
              const rowStyle = {
                background: isHover || isTuning ? "#1a222e" : "#141b26",
                borderColor: isTuning
                  ? "#fbbf24"
                  : isHover
                    ? color
                    : "rgba(148,163,184,0.08)",
                boxShadow: isTuning
                  ? `inset 3px 0 0 #fbbf24, inset 0 0 0 1px #fbbf2466`
                  : isHover
                    ? `inset 3px 0 0 ${color}, inset 0 0 0 1px ${color}55`
                    : `inset 2px 0 0 ${color}99`,
              } as const;
              const rowClassName =
                "group relative mb-1 flex w-full items-center gap-2 overflow-hidden rounded-[3px] border px-2 py-2 text-left transition-all";
              const rowContent = (
                <>
                  <div
                    className="w-[26px] text-center font-mono text-[12px] font-bold tracking-tighter"
                    style={{ color: accentColor }}
                  >
                    {subunitSymbol(s)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] font-medium text-[var(--lab-text)]">
                      {s.name}
                    </div>
                    <div className="mt-0.5 flex gap-1.5 text-[9px] text-[var(--lab-text-dim)]">
                      <span className="tracking-wide">{(s.entity_category as string) ?? "concept"}</span>
                      <span>·</span>
                      <span className="tracking-wide">{s.layer ?? "thread"}</span>
                      {isTuning && (
                        <>
                          <span>·</span>
                          <span className="font-semibold tracking-wider text-[var(--lab-warn)]">TUNING</span>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Phase 21: TUNE badge. stopPropagation so click doesn't
                      trigger the row's drill navigation. */}
                  {onSelectSubunit && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectSubunit(isTuning ? null : s.id);
                      }}
                      title={
                        isTuning
                          ? "Stop tuning — return control panel to focal"
                          : `Tune ${s.name} — point control panel at this subunit`
                      }
                      className="flex h-5 w-5 items-center justify-center rounded-[2px] border border-transparent transition-colors hover:border-[var(--lab-warn)] hover:bg-[var(--lab-warn-tint)]"
                      style={{
                        color: isTuning ? "#fbbf24" : "#475569",
                      }}
                    >
                      <SlidersHorizontal className="h-2.5 w-2.5" />
                    </button>
                  )}
                  <div className="font-mono text-[10px] font-semibold tabular-nums text-[var(--lab-text-mid)]">
                    {weight(s)}
                  </div>
                  {href && (
                    <ChevronRight
                      className="h-3 w-3 text-[var(--lab-text-faint)] transition-colors group-hover:text-[var(--lab-text)]"
                      aria-hidden
                    />
                  )}
                </>
              );

              if (href) {
                return (
                  <Link
                    key={s.id}
                    href={href}
                    onMouseEnter={() => onHoverSubunit(s.id)}
                    onMouseLeave={() => onHoverSubunit(null)}
                    className={rowClassName}
                    style={rowStyle}
                    title={`Open ${s.name} in its own lab`}
                  >
                    {rowContent}
                  </Link>
                );
              }
              return (
                <button
                  key={s.id}
                  onMouseEnter={() => onHoverSubunit(s.id)}
                  onMouseLeave={() => onHoverSubunit(null)}
                  className={rowClassName}
                  style={rowStyle}
                >
                  {rowContent}
                </button>
              );
            })
          )}
          {totalSubunitWeight > 0 && (
            <div className="mt-2 flex items-center gap-2 px-1 text-[9px] text-[var(--lab-text-dim)]">
              <span>∑ weight</span>
              <span className="flex-1 border-t border-dashed border-[var(--lab-border-strong)]" />
              <span className="font-mono font-semibold text-[var(--lab-text-mid)]">{totalSubunitWeight}</span>
            </div>
          )}
        </Section>

        {/* ── Upstream Bonds ── */}
        <Section title="↑ Upstream Bonds" count={upstreamEdges.length}>
          {upstreamEdges.length === 0 && <EmptyHint>No upstream connections.</EmptyHint>}
          {upstreamEdges.map(({ edge, partner }) => (
            <BondRow
              key={edge.id}
              direction="up"
              partner={partner}
              edge={edge}
              href={bondDrillHref?.(partner) ?? null}
            />
          ))}
        </Section>

        {/* ── Downstream Bonds ── */}
        <Section title="↓ Downstream Bonds" count={downstreamEdges.length}>
          {downstreamEdges.length === 0 && <EmptyHint>No downstream connections.</EmptyHint>}
          {downstreamEdges.map(({ edge, partner }) => (
            <BondRow
              key={edge.id}
              direction="dn"
              partner={partner}
              edge={edge}
              href={bondDrillHref?.(partner) ?? null}
            />
          ))}
        </Section>

        {/* ── Context ── */}
        <Section title="⟐ Context">
          <ContextRow label="Layer" value={layerLabel} accent="#22d3ee" />
          <ContextRow
            label="Category"
            value={(focal.entity_category as string) ?? "concept"}
            accent="#22d3ee"
          />
          <ContextRow
            label="Importance"
            value={focal.importance ?? "moderate"}
            accent="#22d3ee"
          />
          {focal.description && (
            <div className="mt-2 rounded-sm border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2 text-[10.5px] leading-relaxed text-[var(--lab-text-mid)]">
              {focal.description}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
          {title}
        </div>
        <div className="flex items-center gap-1.5">
          {action}
          {count !== undefined && (
            <div className="rounded-sm border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--lab-text-faint)]">
              {count}
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-2 text-[10px] italic text-[var(--lab-text-faint)]">{children}</div>
  );
}

function BondRow({
  direction,
  partner,
  edge,
  href,
}: {
  direction: "up" | "dn";
  partner: Entity;
  edge: Edge;
  href: string | null;
}) {
  const arrowColor = direction === "up" ? "#22d3ee" : "#fbbf24";
  const strength = ((edge.strength as number | null) ?? 0.5).toFixed(2);
  const className =
    "flex items-center gap-2 border-b border-[var(--lab-border)] px-1 py-1.5 transition-colors hover:bg-[var(--lab-panel-raised)]";
  const content = (
    <>
      <div
        className="w-[14px] text-center font-mono text-[11px] font-bold"
        style={{ color: arrowColor }}
      >
        {direction === "up" ? "↑" : "↓"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--lab-text)]">{partner.name}</div>
        <div className="truncate text-[9px] text-[var(--lab-text-dim)]">
          {edge.relationship_type} · {edge.dimension}
        </div>
      </div>
      <div className="font-mono text-[10px] font-semibold tabular-nums text-[var(--lab-text-mid)]">
        {strength}
      </div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className} title={`Open ${partner.name} in its own lab`}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

function ContextRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[10px]">
      <div className="w-[22px] text-center font-mono font-bold" style={{ color: accent }}>
        φ
      </div>
      <div className="flex-1 text-[var(--lab-text-mid)]">{label}</div>
      <div className="text-[var(--lab-text)]">{value}</div>
    </div>
  );
}

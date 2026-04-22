"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, X, Zap, BookmarkCheck, BookmarkPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import { useCanvasCombination } from "../canvas/hooks/use-canvas-combination";
import { useReactionLookup, useSaveReaction } from "../canvas/hooks/use-reactions";

export interface LabChamberReactProps {
  spaceId: string;
  focal: Entity;
  subunits: Entity[];
  upstreamPartners: Entity[];
  downstreamPartners: Entity[];
  /** Entity UUIDs currently in the tray. Controlled by NodeLab. */
  tray: string[];
  onTrayChange: (ids: string[]) => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  concrete: "#4ade80",
  abstract: "#a78bfa",
  process: "#fbbf24",
  relational: "#22d3ee",
  epistemic: "#f472b6",
  fault: "#ef4444",
};

function colorOf(e: Entity): string {
  const cat = (e.entity_category as string) ?? "concrete";
  return CATEGORY_COLOR[cat] ?? "#4ade80";
}

function symbolOf(e: Entity | undefined): string {
  if (!e) return "?";
  const words = e.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLowerCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const MAX_SLOTS = 4;

export function LabChamberReact({
  spaceId,
  focal,
  subunits,
  upstreamPartners,
  downstreamPartners,
  tray,
  onTrayChange,
}: LabChamberReactProps) {
  const entitiesByUuid = useMemo(() => {
    const m = new Map<string, Entity>();
    m.set(focal.id, focal);
    for (const e of subunits) m.set(e.id, e);
    for (const e of upstreamPartners) m.set(e.id, e);
    for (const e of downstreamPartners) m.set(e.id, e);
    return m;
  }, [focal, subunits, upstreamPartners, downstreamPartners]);

  const palette = useMemo<Entity[]>(() => {
    // Order matters for the palette UI: subunits first, then focal, then
    // neighbours. De-dupe by UUID.
    const seen = new Set<string>();
    const out: Entity[] = [];
    const push = (e: Entity | undefined) => {
      if (!e || seen.has(e.id)) return;
      seen.add(e.id);
      out.push(e);
    };
    for (const e of subunits) push(e);
    push(focal);
    for (const e of upstreamPartners) push(e);
    for (const e of downstreamPartners) push(e);
    return out;
  }, [focal, subunits, upstreamPartners, downstreamPartners]);

  const toggleReactant = useCallback(
    (id: string) => {
      if (tray.includes(id)) {
        onTrayChange(tray.filter((x) => x !== id));
      } else if (tray.length < MAX_SLOTS) {
        onTrayChange([...tray, id]);
      } else {
        // Replace oldest
        onTrayChange([...tray.slice(1), id]);
      }
    },
    [tray, onTrayChange],
  );

  // ── Combination interpretation (shared with canvas) ──
  const { result: combination, loading: combLoading, error: combError } =
    useCanvasCombination({ spaceId, entityIds: tray });

  // ── Saved-reaction lookup + save ──
  const { reaction: saved } = useReactionLookup({
    spaceId,
    entityIds: tray,
    enabled: tray.length >= 2,
  });
  const { save: saveReaction, saving } = useSaveReaction();
  const [recentlySavedKey, setRecentlySavedKey] = useState<string | null>(null);
  const slotKey = tray.slice().sort().join("|");
  const isSaved = !!saved || recentlySavedKey === slotKey;

  const onSave = useCallback(async () => {
    if (!combination || tray.length < 2) return;
    const r = await saveReaction({
      spaceId,
      name: combination.title,
      reactionType: combination.novelty,
      entityIds: tray,
      probability: 0.7,
      mechanism: combination.mechanism,
      implication: combination.implication,
      probes: combination.probes,
      sourceTag: "llm",
      provenance: {
        source_endpoint: "/api/canvas/combination",
        source_ui: "lab_react_mode",
        focal_entity_id: focal.id,
        saved_at: new Date().toISOString(),
      },
    });
    if (r) setRecentlySavedKey(slotKey);
  }, [combination, tray, saveReaction, spaceId, focal.id, slotKey]);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at center, rgba(74,222,128,0.04), transparent 60%), #02050a",
      }}
    >
      {/* HUD — top-left */}
      <div className="pointer-events-none absolute left-5 top-5 text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 flex gap-2.5">
          <span>CHAMBER</span>
          <b className="font-medium text-[var(--lab-text)]">REACTOR-01</b>
        </div>
        <div className="mb-1 flex gap-2.5">
          <span>FIELD</span>
          <b className="font-medium text-[var(--lab-text)]">REACT</b>
        </div>
        <div className="flex gap-2.5">
          <span>SLOTS</span>
          <b className="font-medium text-[var(--lab-text)]">
            {tray.length}/{MAX_SLOTS}
          </b>
        </div>
      </div>

      {/* ── Palette (left floating panel) ── */}
      <div className="absolute left-5 top-24 bottom-[180px] w-[200px] overflow-y-auto rounded-[3px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)]/90 p-2 backdrop-blur-sm">
        <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[var(--lab-text-dim)]">
          Palette
        </div>
        {palette.length === 0 && (
          <div className="px-1 text-[10px] italic text-[var(--lab-text-faint)]">
            No reactants available.
          </div>
        )}
        {palette.map((e) => {
          const picked = tray.includes(e.id);
          const color = colorOf(e);
          const isFocal = e.id === focal.id;
          return (
            <button
              key={e.id}
              onClick={() => toggleReactant(e.id)}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-[2px] border px-2 py-1.5 text-left transition-all",
                picked
                  ? "bg-[#1a222e]"
                  : "bg-[var(--lab-panel-raised)] hover:bg-[var(--lab-panel-raised)]",
              )}
              style={{
                borderColor: picked ? color : "rgba(148,163,184,0.08)",
                boxShadow: picked ? `inset 3px 0 0 ${color}` : `inset 2px 0 0 ${color}80`,
              }}
            >
              <div
                className="w-[24px] text-center font-mono text-[12px] font-bold"
                style={{ color }}
              >
                {symbolOf(e)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10.5px] font-medium text-[var(--lab-text)]">
                  {e.name}
                </div>
                <div className="mt-0.5 text-[8.5px] text-[var(--lab-text-dim)]">
                  {isFocal
                    ? "focal"
                    : subunits.includes(e)
                      ? "subunit"
                      : upstreamPartners.includes(e)
                        ? "upstream"
                        : "downstream"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Reactor tray — center ── */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pb-24">
        <div className="mb-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--lab-text-dim)]">
          Reactor Tray
        </div>

        <div className="flex items-center gap-3 rounded-[4px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-inset)]/85 p-3 shadow-[0_0_40px_rgba(74,222,128,0.06)] backdrop-blur-md">
          <div className="flex gap-1.5">
            {Array.from({ length: MAX_SLOTS }).map((_, i) => {
              const id = tray[i];
              const e = id ? entitiesByUuid.get(id) : undefined;
              const color = e ? colorOf(e) : undefined;
              return (
                <div
                  key={i}
                  className="relative grid h-[58px] w-[58px] place-items-center rounded-[2px] border font-mono text-[10px] transition-colors"
                  style={{
                    background: e ? "#1a222e" : "#06090e",
                    borderColor: e
                      ? (color ?? "rgba(148,163,184,0.14)")
                      : "rgba(148,163,184,0.14)",
                    borderStyle: e ? "solid" : "dashed",
                    color: e && color ? color : "#475569",
                  }}
                >
                  {e ? (
                    <>
                      <span
                        className="text-[17px] font-bold"
                        style={{ color: color ?? "#e8edf4" }}
                      >
                        {symbolOf(e)}
                      </span>
                      <button
                        onClick={() => toggleReactant(e.id)}
                        className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-[var(--lab-border-strong)] bg-[var(--lab-panel-inset)] text-[9px] text-[var(--lab-text-mid)] hover:text-[var(--lab-text)]"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </>
                  ) : (
                    <span className="text-[var(--lab-text-faint)]">empty</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-1 font-mono text-[20px] font-bold text-[var(--lab-accent)]">⟶</div>

          <div className="min-w-[200px] max-w-[280px] border-l border-[var(--lab-border-strong)] px-3">
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[var(--lab-text-dim)]">
              Predicted Product
            </div>
            {combError && (
              <div className="mt-1 text-[10px] text-[var(--lab-danger)]">{combError}</div>
            )}
            {tray.length < 2 && (
              <div className="mt-1 text-[11px] text-[var(--lab-text-faint)]">Add 2+ reagents</div>
            )}
            {tray.length >= 2 && combLoading && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--lab-text-mid)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Interpreting…
              </div>
            )}
            {combination && !combLoading && (
              <>
                <div className="mt-0.5 text-[14px] font-bold leading-tight text-[var(--lab-accent)]">
                  {combination.title}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[9.5px]">
                  <NoveltyPill kind={combination.novelty} />
                  <span className="text-[var(--lab-text-dim)]">
                    {Math.round(0.7 * 100)}% · est.
                  </span>
                </div>
                {combination.implication && (
                  <div className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-[var(--lab-text-mid)]">
                    {combination.implication}
                  </div>
                )}
                <button
                  onClick={onSave}
                  disabled={saving || isSaved}
                  className={cn(
                    "mt-2 flex w-full items-center justify-center gap-1.5 rounded-[2px] py-1.5 text-[10px] font-semibold transition-colors",
                    isSaved
                      ? "bg-[#166534]/30 text-[var(--lab-accent)]"
                      : saving
                        ? "bg-[var(--lab-panel-raised)] text-[var(--lab-text-dim)]"
                        : "bg-[#e8edf4] text-[#06090e] hover:bg-white",
                  )}
                  title={
                    isSaved
                      ? "Saved — visible in the Reaction Network footer"
                      : "Persist this interpretation as a named Reaction"
                  }
                >
                  {saving ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : isSaved ? (
                    <BookmarkCheck className="h-2.5 w-2.5" />
                  ) : (
                    <BookmarkPlus className="h-2.5 w-2.5" />
                  )}
                  {isSaved ? "Saved as Reaction" : saving ? "Saving…" : "Save as Reaction"}
                </button>
              </>
            )}
          </div>
        </div>

        {tray.length > 0 && (
          <button
            onClick={() => onTrayChange([])}
            className="mt-3 flex items-center gap-1 rounded-full border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-2 py-0.5 text-[9px] font-semibold text-[var(--lab-text-mid)] hover:text-[var(--lab-text)]"
            title="Clear the tray"
          >
            <Zap className="h-2.5 w-2.5 rotate-180" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function NoveltyPill({ kind }: { kind: "emergent" | "reinforcing" | "tension" | "trivial" }) {
  const acc =
    kind === "emergent"
      ? "#10b981"
      : kind === "reinforcing"
        ? "#3b82f6"
        : kind === "tension"
          ? "#ef4444"
          : "#64748b";
  return (
    <span
      className="inline-flex items-center rounded-[1px] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest"
      style={{ background: `${acc}22`, color: acc }}
    >
      {kind}
    </span>
  );
}

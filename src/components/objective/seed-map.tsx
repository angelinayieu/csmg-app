"use client";

// ── SeedMap ──
//
// "Peek the engine." Expands the objective seed into its sandboxed reasoning
// graph (the §5 Map tab). Reads seed.internal.reasoningGraph and renders it via
// the PillMap (keyword pills, apex+N pruning, lens toggle). The reasoning lives
// here, on demand — never dumped on the board. Opened from the objective card.

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Loader2, Network } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { PillMap, type Lens } from "@/components/objective/crucible/pill-map";
import type { PillEdge, PillNode } from "@/lib/objective-canvas/crucible/crucible-strength";
import { onOpenSeedMap } from "@/lib/objective-canvas/seed/seed-map-signal";
import { rankConnections, type RankedConnection } from "@/lib/objective-canvas/seed/rank-connections";

interface SeedNodeLite { id: string; label: string; keyword?: string; type: string; score?: number }
interface SeedEdgeLite { source: string; target: string; relation?: string }
interface SeedLite {
  status?: string;
  external?: { deliverable?: string } | null;
  internal?: { reasoningGraph?: { nodes?: SeedNodeLite[]; edges?: SeedEdgeLite[] } };
}

export function SeedMapMount({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenSeedMap((id) => { if (id === spaceId) setOpen(true); }), [spaceId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return <SeedMapPanel spaceId={spaceId} onClose={() => setOpen(false)} />;
}

function SeedMapPanel({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const [seed, setSeed] = useState<SeedLite | null>(null);
  const [stage, setStage] = useState<{ status?: string; round?: number } | null>(null);
  const [lens, setLens] = useState<Lens>("concept");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/objective/${spaceId}/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get" }),
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as { seed?: SeedLite | null };
        return j.seed ?? null;
      }
    } catch {
      /* soft */
    }
    return null;
  }, [spaceId]);

  // Keep polling until the seed is READY (not just until the skeleton lands) so
  // the map densifies skeleton → real reasoning graph in place. Also pull the
  // Crucible stage so the "densifying" strip mirrors the card's progress.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      tries += 1;
      const s = await load();
      if (alive && s) setSeed(s);
      if (alive && s?.status !== "ready") {
        try {
          const cr = await fetch(`/api/objective/${spaceId}/crucible`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "state" }),
            cache: "no-store",
          });
          if (cr.ok && alive) {
            const cj = (await cr.json()) as { state?: { status?: string; round?: number } | null };
            if (cj.state) setStage({ status: cj.state.status, round: cj.state.round });
          }
        } catch {
          /* soft */
        }
      }
      if (alive && s?.status !== "ready" && tries < 40) timer = setTimeout(tick, 4000);
    }
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [load, spaceId]);

  const graph = seed?.internal?.reasoningGraph;
  const building = !!seed && seed.status !== "ready" && seed.status !== "error";
  const buildLabel =
    stage?.status === "converged"
      ? "Distilling the deliverable…"
      : stage?.status === "awaiting_user"
        ? "Densifying as you answer in chat…"
        : stage?.status === "working"
          ? `Mapping the levers${stage.round ? ` · round ${stage.round}` : ""}…`
          : "Sketching the first concepts…";
  const nodes: PillNode[] = (graph?.nodes ?? []).map((n) => ({ id: n.id, label: n.label, keyword: n.keyword, type: n.type, score: n.score }));
  const edges: PillEdge[] = (graph?.edges ?? []).map((e) => ({ source: e.source, target: e.target, relation: e.relation }));
  const sel = nodes.find((n) => n.id === selected) ?? null;
  const topConnections = useMemo(() => rankConnections(graph, 4), [graph]);

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={headerRow}>
          <Network style={{ width: 15, height: 15, color: "#7C3AED" }} strokeWidth={2.2} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: appleVibe.text.primary }}>Reasoning ground</span>
          <span style={{ fontSize: 11.5, color: appleVibe.text.tertiary }}>the engine behind the move — peek only</span>
          <div style={{ display: "flex", background: "rgba(15,23,42,0.05)", borderRadius: 999, padding: 2, marginLeft: 12 }}>
            {(["concept", "structure", "cause"] as Lens[]).map((l) => (
              <button key={l} type="button" onClick={() => setLens(l)} style={segBtn(lens === l)}>
                {l === "concept" ? "Concept" : l === "structure" ? "Structure" : "Cause"}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} style={{ marginLeft: "auto", ...iconBtn }} title="Close (Esc)">
            <X style={{ width: 16, height: 16 }} strokeWidth={2.2} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {nodes.length === 0 ? (
            <div style={center}>
              <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />
              <span style={{ marginTop: 8 }}>
                {building || !seed ? buildLabel : "No reasoning yet — answer a few questions in chat first."}
              </span>
            </div>
          ) : (
            <>
              <PillMap nodes={nodes} edges={edges} budget={7} lens={lens} selectedId={selected} onSelect={setSelected} />
              {/* Still building → tell the user this map is a sketch that will
                  densify, so the early (skeleton) nodes don't read as the final. */}
              {building && (
                <div style={densifyPill}>
                  <Loader2 className="animate-spin" style={{ width: 11, height: 11, color: "#7C3AED" }} strokeWidth={2.6} />
                  <span>{buildLabel}</span>
                  <span style={{ opacity: 0.6 }}>· {nodes.length} so far</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Top connections — the ranked cross-lane bridges (the highest-value
            insight usually lives in an edge, not a node). Click → highlight its
            endpoints in the map. This is the "surface the most important
            connections from a complex graph" payoff. */}
        {nodes.length > 0 && topConnections.length > 0 && (
          <div style={connStrip}>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "#7C3AED", flexShrink: 0 }}>
              ⚡ Top connections
            </span>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", flex: 1 }}>
              {topConnections.map((c: RankedConnection) => {
                const active = selected === c.source || selected === c.target;
                return (
                  <button
                    key={`${c.source}-${c.target}`}
                    type="button"
                    onClick={() => setSelected(active ? null : c.source)}
                    title={c.why}
                    style={connChip(active, c.bridgesTypes)}
                  >
                    <span style={{ fontWeight: 700 }}>{c.sourceKeyword}</span>
                    <span style={{ opacity: 0.5 }}>↔</span>
                    <span style={{ fontWeight: 700 }}>{c.targetKeyword}</span>
                    <span style={{ marginLeft: 4, fontSize: 9.5, fontWeight: 800, color: "#7C3AED", fontVariantNumeric: "tabular-nums" }}>{c.score}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* selected detail */}
        {sel && (
          <div style={detailRow}>
            <span style={typeChip(sel.type)}>{sel.type.replace(/_/g, " ")}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: appleVibe.text.primary }}>{sel.label}</span>
            {typeof sel.score === "number" && sel.score > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "#B45309", fontVariantNumeric: "tabular-nums" }}>{sel.score}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TYPE_COLOR: Record<string, string> = { objective: "#0F172A", leverage_point: "#F59E0B", first_principle: "#7C3AED", variable: "#0D9488", constraint: "#E11D48", sub_objective: "#0EA5E9", feature: "#2563EB", concept: "#64748B" };

const backdrop = { position: "fixed", inset: 0, zIndex: 120, background: "rgba(11,18,40,0.28)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 } as const;
const panel = { width: "min(1040px, 94vw)", height: "min(720px, 88vh)", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 20, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 40px 90px -30px rgba(11,18,40,0.45)", overflow: "hidden", fontFamily: appleVibe.font.stack } as const;
const headerRow = { display: "flex", alignItems: "center", gap: 9, padding: "12px 16px", borderBottom: "1px solid rgba(15,23,42,0.06)", flexWrap: "wrap" } as const;
const iconBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: appleVibe.text.tertiary } as const;
function segBtn(active: boolean) { return { fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: "none", cursor: "pointer", background: active ? "#fff" : "transparent", color: active ? "#0F172A" : "#64748B", boxShadow: active ? "0 1px 3px rgba(11,18,40,0.12)" : "none" } as const; }
const center = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: appleVibe.text.tertiary, fontSize: 12.5 } as const;
const densifyPill = { position: "absolute", top: 12, left: 12, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 650, color: appleVibe.text.secondary, background: "rgba(255,255,255,0.82)", backdropFilter: "blur(6px)", border: "1px solid rgba(124,58,237,0.18)", boxShadow: "0 4px 14px -6px rgba(11,18,40,0.25)" } as const;
const connStrip = { display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderTop: "1px solid rgba(124,58,237,0.12)", background: "rgba(124,58,237,0.03)" } as const;
function connChip(active: boolean, bridges: boolean) {
  return {
    display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
    fontSize: 11, color: appleVibe.text.secondary,
    padding: "4px 9px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "rgba(124,58,237,0.55)" : bridges ? "rgba(124,58,237,0.22)" : "rgba(15,23,42,0.10)"}`,
    background: active ? "rgba(124,58,237,0.10)" : "#fff",
    whiteSpace: "nowrap", fontFamily: appleVibe.font.stack,
  } as const;
}
const detailRow = { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: "1px solid rgba(15,23,42,0.06)", background: "rgba(15,23,42,0.02)" } as const;
function typeChip(type: string) { const c = TYPE_COLOR[type] ?? "#64748B"; return { fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: c, background: `${c}14`, padding: "3px 8px", borderRadius: 999 } as const; }

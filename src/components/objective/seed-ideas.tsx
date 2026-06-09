"use client";

// ── SeedIdeas ──
//
// The ranked idea FIELD. Where the rest of the seed decomposes the problem, this
// surfaces the generative layer: the candidate concepts the engine generated +
// scored, ranked by the objective's value axes — the #1 pick WITH the field
// behind it (and why it beat #2/#3). Answers "find my best idea" properly:
// a defended choice, not a single asserted move. Forks any idea on demand.

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Scale, GitFork } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { onOpenSeedIdeas } from "@/lib/objective-canvas/seed/seed-ideas-signal";

// Must match deploy-oc-cards.ts / whiteboard-base's listener (defined locally to
// avoid pulling the tldraw-heavy deploy module into this panel).
const DECOMPOSE_INTO_CARDS_EVENT = "objective-board:decompose-into-cards";

type Origin = "extracted" | "recombination" | "analogical" | "constraint";
interface Scores { income: number; traction: number; virality: number; moat: number; whyNow: number }
interface Idea { slug: string; title: string; summary: string; origin: Origin; scores: Scores; composite: number; rationale: string; rank: number }
interface IdeaField { axes: string[]; weights: Scores; ideas: Idea[]; topPick: string; whyTopWon: string; generatedCount: number }
interface SeedLite { status?: string; internal?: { ideas?: IdeaField | null } }

export function SeedIdeasMount({ spaceId }: { spaceId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenSeedIdeas((id) => { if (id === spaceId) setOpen(true); }), [spaceId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return <SeedIdeasPanel spaceId={spaceId} onClose={() => setOpen(false)} />;
}

function SeedIdeasPanel({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const [field, setField] = useState<IdeaField | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchSeed = useCallback(async (action: "get" | "ideas") => {
    const r = await fetch(`/api/objective/${spaceId}/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { seed?: SeedLite | null };
    return j.seed?.internal?.ideas ?? null;
  }, [spaceId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const f = await fetchSeed("get");
      if (alive) { setField(f); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [fetchSeed]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const f = await fetchSeed("ideas");
      setField(f);
    } finally {
      setGenerating(false);
    }
  }, [fetchSeed]);

  const fork = (idea: Idea) => {
    window.dispatchEvent(
      new CustomEvent(DECOMPOSE_INTO_CARDS_EVENT, {
        detail: { objective: `${idea.title} — ${idea.summary}` },
      }),
    );
    onClose();
  };

  const ideas = field?.ideas ?? [];
  const hasField = ideas.length > 0;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={headerRow}>
          <Scale style={{ width: 15, height: 15, color: "#B45309" }} strokeWidth={2.2} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: appleVibe.text.primary }}>Idea field</span>
          <span style={{ fontSize: 11.5, color: appleVibe.text.tertiary }}>ranked by income × traction × virality + moat + why-now</span>
          {hasField && (
            <span style={{ fontSize: 10.5, color: appleVibe.text.faint, marginLeft: 8 }}>
              {field!.generatedCount} explored · {ideas.length} ranked
            </span>
          )}
          <button type="button" onClick={onClose} style={{ marginLeft: "auto", ...iconBtn }} title="Close (Esc)">
            <X style={{ width: 16, height: 16 }} strokeWidth={2.2} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px 18px" }}>
          {loading ? (
            <div style={center}><Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /><span style={{ marginTop: 8 }}>Loading…</span></div>
          ) : !hasField ? (
            <div style={center}>
              {generating ? (
                <>
                  <Loader2 className="animate-spin" style={{ width: 18, height: 18, color: "#B45309" }} />
                  <span style={{ marginTop: 10, maxWidth: 320, textAlign: "center", lineHeight: 1.5 }}>
                    Generating a wide field of concepts, scoring each on your value axes, and ranking… (this takes a moment)
                  </span>
                </>
              ) : (
                <>
                  <span style={{ maxWidth: 360, textAlign: "center", lineHeight: 1.5, color: appleVibe.text.secondary }}>
                    Generate a field of distinct candidate ideas — extracted from your notes, recombined from your variables, transferred from analogous wins, and constraint-driven — then score &amp; rank them.
                  </span>
                  <button type="button" onClick={generate} style={genBtn}>⚖ Generate &amp; rank the field</button>
                </>
              )}
            </div>
          ) : (
            <>
              {field!.whyTopWon && (
                <div style={whyBox}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#047857" }}>Why #1 wins</span>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: appleVibe.text.primary, marginTop: 3 }}>{field!.whyTopWon}</div>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {ideas.map((idea) => (
                  <div key={idea.slug} style={row(idea.rank === 1)}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: idea.rank === 1 ? "#B45309" : appleVibe.text.tertiary, fontVariantNumeric: "tabular-nums", minWidth: 18 }}>#{idea.rank}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: appleVibe.text.primary, flex: 1 }}>{idea.title}</span>
                      <span style={originChip(idea.origin)}>{idea.origin}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#B45309", fontVariantNumeric: "tabular-nums" }}>{idea.composite}</span>
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.45, color: appleVibe.text.secondary, marginTop: 3, marginLeft: 27 }}>{idea.summary}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 7, marginLeft: 27, flexWrap: "wrap", alignItems: "center" }}>
                      {AXES.map((ax) => (
                        <AxisBar key={ax.key} label={ax.short} value={idea.scores[ax.key]} />
                      ))}
                    </div>
                    {idea.rationale && <div style={{ fontSize: 10.5, color: appleVibe.text.faint, marginTop: 6, marginLeft: 27, fontStyle: "italic" }}>{idea.rationale}</div>}
                    <button type="button" onClick={() => fork(idea)} style={forkBtn} title="Fork this idea into Feature / Variable cards on the board">
                      <GitFork style={{ width: 11, height: 11 }} strokeWidth={2.4} /> Fork this idea
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 9.5, color: appleVibe.text.faint }}>
                <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>weights</span>
                {AXES.map((ax) => <span key={ax.key}>{ax.short} {Math.round((field!.weights[ax.key] ?? 0) * 100)}%</span>)}
                <button type="button" onClick={generate} disabled={generating} style={{ marginLeft: "auto", ...regenBtn, opacity: generating ? 0.5 : 1 }}>
                  {generating ? <Loader2 className="animate-spin" style={{ width: 11, height: 11 }} /> : "↻"} Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const AXES: { key: keyof Scores; short: string }[] = [
  { key: "income", short: "Inc" },
  { key: "traction", short: "Trac" },
  { key: "virality", short: "Viral" },
  { key: "moat", short: "Moat" },
  { key: "whyNow", short: "Now" },
];

function AxisBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} title={`${label}: ${value}`}>
      <span style={{ fontSize: 8.5, fontWeight: 700, color: appleVibe.text.faint, width: 26 }}>{label}</span>
      <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(15,23,42,0.08)", overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", borderRadius: 999, background: value >= 66 ? "#10B981" : value >= 33 ? "#F59E0B" : "#94A3B8" }} />
      </div>
      <span style={{ fontSize: 8.5, fontWeight: 700, color: appleVibe.text.tertiary, width: 16, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

const ORIGIN_COLOR: Record<Origin, string> = { extracted: "#64748B", recombination: "#7C3AED", analogical: "#0EA5E9", constraint: "#E11D48" };

const backdrop = { position: "fixed", inset: 0, zIndex: 120, background: "rgba(11,18,40,0.28)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 } as const;
const panel = { width: "min(720px, 94vw)", height: "min(760px, 90vh)", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 20, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 40px 90px -30px rgba(11,18,40,0.45)", overflow: "hidden", fontFamily: appleVibe.font.stack } as const;
const headerRow = { display: "flex", alignItems: "center", gap: 9, padding: "12px 16px", borderBottom: "1px solid rgba(15,23,42,0.06)", flexWrap: "wrap" } as const;
const iconBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: appleVibe.text.tertiary } as const;
const center = { minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: appleVibe.text.tertiary, fontSize: 12.5 } as const;
const genBtn = { marginTop: 16, padding: "10px 18px", borderRadius: 999, border: "1px solid rgba(180,83,9,0.30)", background: "rgba(245,158,11,0.10)", color: "#B45309", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: appleVibe.font.stack } as const;
const whyBox = { marginBottom: 12, padding: "9px 12px", borderRadius: 12, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.22)" } as const;
function row(top: boolean) {
  return {
    padding: "10px 12px", borderRadius: 13,
    background: top ? "rgba(245,158,11,0.05)" : "rgba(15,23,42,0.015)",
    border: `1px solid ${top ? "rgba(245,158,11,0.28)" : "rgba(15,23,42,0.07)"}`,
  } as const;
}
function originChip(o: Origin) {
  const c = ORIGIN_COLOR[o];
  return { fontSize: 8.5, fontWeight: 800, letterSpacing: "0.03em", textTransform: "uppercase", color: c, background: `${c}14`, padding: "2px 7px", borderRadius: 999, flexShrink: 0 } as const;
}
const forkBtn = { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, marginLeft: 27, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10.5, fontWeight: 700, color: "#2563EB", fontFamily: appleVibe.font.stack } as const;
const regenBtn = { display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer", fontSize: 10, fontWeight: 700, color: "#B45309", fontFamily: appleVibe.font.stack } as const;

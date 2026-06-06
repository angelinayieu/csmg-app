"use client";

// ── Goal & alignment sidebar (dedicated, left edge) ───────────────
//
// The "where am I aiming + what matters" rail. A left-edge launcher opens a
// panel with two parts:
//   • Ultimate goal — the space's distilled objective (title + expandable
//     description), fetched server-side with the ranking.
//   • Live ranking — every board node scored by the alignment ranker
//     (/api/spaces/[id]/rank-nodes): convergent (commits toward the goal) vs
//     divergent (opens away), sorted by importance × alignment × quality.
//     Click a row → focus that card on the board.
//
// Mirrors the right-edge Library launcher (symmetric chrome). Self-contained;
// reads `editor` to enumerate nodes + focus, never mutates the board.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor, TLShapeId } from "tldraw";
import {
  Compass,
  X,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { shapeToScanTarget } from "./shape-node-adapter";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  openResolutionStudio,
  REFRESH_SHARPENING_EVENT,
  AI_AUTORESOLVE_STARTED_EVENT,
  AI_AUTORESOLVE_ENDED_EVENT,
  type AiAutoResolveStartedDetail,
  type AiAutoResolveEndedDetail,
} from "@/components/objective/board-bus";

interface RankedNode {
  id: string;
  direction: "convergent" | "divergent";
  score: number;
  reason: string;
}
interface RankData {
  goal: { title: string; description: string };
  ranked: RankedNode[];
}

// ── Clarity & priorities (intake/sharpening salience, surfaced here) ──
// The sharpening artifact's salience map + resolutions, read cheaply (GET,
// no LLM) so the rail can show how well-defined the objective IS (not just how
// the board aligns) and what to resolve next. Updates live: re-fetched on open,
// on manual refresh, and whenever a resolution lands (REFRESH_SHARPENING_EVENT)
// so the clarity meter climbs + open questions check off in place.
interface MicroQ {
  id: string;
  q: string;
  uncertainty: number;
  resolved_at?: string;
  /** Cards/glossary/ai that TOUCH (not necessarily resolve) this micro — drives
   *  the amber "being addressed" dot between open (empty) and resolved (green). */
  addressed_by?: { kind: string; ref: string; at: string }[];
  candidate_readings?: string[];
}
interface SalienceAnn {
  phrase: string;
  kind: string;
  leverage: number;
  uncertainty: number;
  why?: string;
  candidate_readings?: string[];
  priority?: number;
  /** Decomposition emitted by the depth pass (step 1 of micro-uncertainty).
   *  Absent on legacy artifacts — treated as one implicit micro = the macro. */
  micro_questions?: MicroQ[];
  /** Stamped by the emergent (Tier-1) board-aware re-scan when the model
   *  surfaces a concept the original intake didn't see. Drives the rail's
   *  "new" pulse. */
  emerged_at?: string;
}
// One past auto-resolver commit — sourced from artifact.resolutions[] filtered
// to source==="ai". Drives the "AI activity" strip: recent decisions with a
// ⚠ on the ones the model itself flagged needs_review. Click → reopen Studio
// focused on that concept so the user can override.
interface AiActivityItem {
  concept_slug: string;
  phrase: string;
  kind: string;
  answer_text: string;
  resolved_at: string;
  confidence?: number;
  needs_review?: boolean;
}
interface ClarityData {
  title: string;
  sharpenedPrompt: string;
  anns: SalienceAnn[];
  resolvedSlugs: Set<string>;
  aiActivity: AiActivityItem[];
}
// Mirrors the slugify in prompt-sharpening-prompt.ts + the card, so a salience
// row matches the user's resolved concept by slug.
const slugifyPhrase = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
const annPriority = (a: SalienceAnn) =>
  typeof a.priority === "number"
    ? a.priority
    : a.leverage * (0.5 + 0.5 * a.uncertainty);

async function fetchClarity(spaceId: string): Promise<ClarityData | null> {
  try {
    const res = await fetch(`/api/objective/${spaceId}/prompt-sharpening`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      artifact?: {
        distilled_title?: string;
        sharpened_prompt?: string;
        salience?: { annotations?: SalienceAnn[] };
        resolutions?: Array<{
          concept_slug?: string;
          phrase?: string;
          kind?: string;
          answer_text?: string;
          source?: string;
          resolved_at?: string;
          confidence?: number;
          needs_review?: boolean;
        }>;
      };
    };
    const a = j.artifact;
    if (!a) return null;
    const annsRaw = a.salience?.annotations;
    const anns = Array.isArray(annsRaw) ? (annsRaw as SalienceAnn[]) : [];
    const resolvedSlugs = new Set<string>();
    const aiActivity: AiActivityItem[] = [];
    for (const r of a.resolutions ?? []) {
      if (r?.concept_slug) resolvedSlugs.add(r.concept_slug);
      // AI activity strip — only AI-source commits, most recent first.
      if (r?.source === "ai" && r.concept_slug && r.resolved_at) {
        aiActivity.push({
          concept_slug: r.concept_slug,
          phrase: r.phrase ?? r.concept_slug,
          kind: r.kind ?? "concept",
          answer_text: r.answer_text ?? "",
          resolved_at: r.resolved_at,
          confidence: r.confidence,
          needs_review: r.needs_review,
        });
      }
    }
    aiActivity.sort((x, y) => (y.resolved_at > x.resolved_at ? 1 : -1));
    return {
      title: a.distilled_title ?? "",
      sharpenedPrompt: a.sharpened_prompt ?? "",
      anns,
      resolvedSlugs,
      aiActivity: aiActivity.slice(0, 5),
    };
  } catch {
    return null;
  }
}

/** A node's display label resolved from the board (the ranker only knows ids). */
function labelFor(editor: Editor, id: string): string {
  try {
    const s = editor.getShape(id as TLShapeId);
    if (!s) return "(removed)";
    const p = s.props as { title?: unknown; text?: unknown; subtitle?: unknown };
    const t =
      (typeof p.title === "string" && p.title) ||
      (typeof p.text === "string" && p.text) ||
      (typeof p.subtitle === "string" && p.subtitle) ||
      "Untitled";
    return String(t).replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
  } catch {
    return "Untitled";
  }
}

/** Enumerate current-page board cards (id + display text), de-duplicated.
 *  Shared by the ranker fetch and the Tier-0 micro-addressing fetch — both
 *  scan the same card set. Best-effort; returns [] on any enumeration error. */
function enumerateCards(editor: Editor): { id: string; text: string }[] {
  const seen = new Set<string>();
  const nodes: { id: string; text: string }[] = [];
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const t = shapeToScanTarget(s);
      if (t?.shapeId && t.text?.trim() && !seen.has(t.shapeId)) {
        seen.add(t.shapeId);
        nodes.push({ id: t.shapeId, text: t.text });
      }
    }
  } catch {
    /* enumeration is best-effort */
  }
  return nodes;
}

/** Enumerate board nodes → POST the ranker → ranked data. No setState (so the
 *  open-effect's only side effect is the fetch). Returns null on failure. */
async function fetchRanking(editor: Editor, spaceId: string): Promise<RankData | null> {
  const nodes = enumerateCards(editor);
  try {
    const res = await fetch(`/api/spaces/${spaceId}/rank-nodes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as RankData;
    return {
      goal: json.goal ?? { title: "Your objective", description: "" },
      ranked: Array.isArray(json.ranked) ? json.ranked : [],
    };
  } catch {
    return null;
  }
}

/** Tier-1 board-aware emergent re-scan: feeds the board cards + glossary to
 *  an LLM pass that ADDITIVELY surfaces concepts the original intake didn't
 *  see (annotations stamped `emerged_at`). Soft-fail; returns the new
 *  annotation list when something landed, null on skip/error. */
async function rescanEmergent(
  spaceId: string,
  editor: Editor,
): Promise<{ annotations: SalienceAnn[]; emergentCount: number } | null> {
  const cards = enumerateCards(editor).map((c) => ({
    id: c.id,
    text: c.text.slice(0, 600),
  }));
  try {
    const res = await fetch(`/api/objective/${spaceId}/sharpening-emergent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      salience?: { annotations?: SalienceAnn[] };
      emergentCount?: number;
    };
    const annotations = Array.isArray(j.salience?.annotations)
      ? (j.salience.annotations as SalienceAnn[])
      : [];
    return {
      annotations,
      emergentCount: j.emergentCount ?? 0,
    };
  } catch {
    return null;
  }
}

/** Tier-0 micro-addressing pass: send the current board cards to the server,
 *  which read-modify-writes each open micro_question's addressed_by[] when a
 *  card / pinned glossary term matches. Returns the freshly-addressed
 *  annotations so the caller can update the rail without a second GET.
 *  Soft-fail. */
async function addressMicros(
  spaceId: string,
  editor: Editor,
): Promise<{ annotations: SalienceAnn[]; deltas: number } | null> {
  const cards = enumerateCards(editor).map((c) => ({
    id: c.id,
    // Send only the first 600 chars per card — the server caps too, but trim
    // here to keep the request small when boards get dense.
    text: c.text.slice(0, 600),
  }));
  try {
    const res = await fetch(`/api/objective/${spaceId}/micro-address`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cards }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      annotations?: SalienceAnn[];
      deltas?: number;
    };
    if (!Array.isArray(j.annotations)) return null;
    return { annotations: j.annotations, deltas: j.deltas ?? 0 };
  } catch {
    return null;
  }
}

function focusNode(editor: Editor, id: string) {
  try {
    editor.select(id as TLShapeId);
    const b = editor.getShapePageBounds(id as TLShapeId);
    if (b) editor.centerOnPoint({ x: b.midX, y: b.midY }, { animation: { duration: 300 } });
  } catch {
    /* best-effort */
  }
}

/** Fired by the top-right nav bar to open this rail (the launcher's own left
 *  pill is retired — the nav bar is the single trigger). */
export const OPEN_BOARD_GOAL_EVENT = "board:open-goal";

export function GoalLauncher({ spaceId, editor }: { spaceId: string; editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RankData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [clarity, setClarity] = useState<ClarityData | null>(null);
  const [priOpen, setPriOpen] = useState(true);
  // AI activity strip state: `aiBusy` rises while an auto-resolve call is in
  // flight (pulse), `aiBusyTrigger` says where it came from (card / studio)
  // so the label can name it. Set by the AI_AUTORESOLVE_* bus events the
  // call-sites fire; the post-flight summary lands in `clarity.aiActivity`
  // once REFRESH_SHARPENING_EVENT reloads the artifact.
  const [aiBusy, setAiBusy] = useState<{
    trigger: "card" | "studio";
    conceptCount: number;
  } | null>(null);
  // Tier-1 board-aware re-scan state. `rescanBusy` = in-flight (spin the icon);
  // `rescanResult` = transient banner ("2 new questions" / "nothing new") that
  // fades after a few seconds so the user knows the call landed even when the
  // model returned nothing — silent runs feel broken.
  const [rescanBusy, setRescanBusy] = useState(false);
  const [rescanResult, setRescanResult] = useState<string | null>(null);
  // Post-AI sweep tracker (step 6): when auto-resolve commits successfully we
  // stash the timestamp here. The REFRESH_SHARPENING_EVENT handler reads this
  // and — if the commit was recent (<30s) — chains an emergent re-scan after
  // the addressing pass settles. ref (not state) so updates don't re-mount
  // the listeners. Cleared after firing so a manual refresh later doesn't
  // double-sweep.
  const recentAutoResolveRef = useRef<{ at: number; ok: boolean } | null>(
    null,
  );

  // Opened from the consolidated nav bar (top-right).
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_BOARD_GOAL_EVENT, openIt);
    return () => window.removeEventListener(OPEN_BOARD_GOAL_EVENT, openIt);
  }, []);

  // Initial load on open (setData only in the .then callback — no synchronous
  // setState in the effect body).
  useEffect(() => {
    if (!open || data) return;
    let alive = true;
    fetchRanking(editor, spaceId).then((d) => {
      // Fall back to an empty result on failure so the panel never hangs on
      // the loading state (e.g. transient auth/network error).
      if (alive) setData(d ?? { goal: { title: "Your objective", description: "" }, ranked: [] });
    });
    return () => {
      alive = false;
    };
  }, [open, data, spaceId, editor]);

  // Clarity & priorities — load on open + reload whenever a resolution lands
  // (REFRESH_SHARPENING_EVENT, fired by both the inline "Let AI decide" and the
  // Resolution Studio) so the meter + open-question list update in place. Each
  // load runs the Tier-0 micro-addressing pass (cheap deterministic match of
  // board cards / pinned glossary terms against open micros) so the per-row
  // dots reflect board work without requiring a manual gesture.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      // Fast path: show the current artifact immediately so the rail feels
      // responsive even if the addressing pass takes a moment.
      fetchClarity(spaceId).then((c) => {
        if (alive) setClarity(c);
      });
      // Then run addressing and merge its fresher annotations on top. This
      // also persists addressed_by[] deltas to the artifact so reloads keep
      // them. No-op for legacy artifacts (no micros) — route short-circuits.
      void addressMicros(spaceId, editor).then((r) => {
        if (!alive) return;
        if (r) {
          setClarity((prev) =>
            prev ? { ...prev, anns: r.annotations } : prev,
          );
        }
        // Step 6 — post-AI sweep. If an auto-resolve committed in the last
        // ~30s, chain an emergent re-scan AFTER addressing settles. Auto-
        // resolutions compress many decisions at once → each typically
        // implies further sub-questions the rail should surface. Cleared so
        // a subsequent manual refresh doesn't sweep again.
        const recent = recentAutoResolveRef.current;
        // Dedup is via ref-clear below — checking `rescanBusy` here would be
        // stale (the effect deps don't include it). A concurrent manual
        // re-scan would simply double the spin; the route is read-modify-
        // write fresh + slug-deduped, so the persistence stays consistent.
        if (recent && recent.ok && Date.now() - recent.at < 30_000) {
          recentAutoResolveRef.current = null;
          setRescanBusy(true);
          void rescanEmergent(spaceId, editor).then((er) => {
            if (!alive) return;
            setRescanBusy(false);
            if (er && er.emergentCount > 0) {
              setClarity((prev) =>
                prev ? { ...prev, anns: er.annotations } : prev,
              );
              setRescanResult(
                `${er.emergentCount} new question${er.emergentCount === 1 ? "" : "s"} from AI sweep`,
              );
              window.setTimeout(() => {
                if (alive) setRescanResult(null);
              }, 4000);
            }
            // Silent on zero — the AI sweep is a background nicety, not a
            // user-initiated gesture. A "nothing new" banner on every
            // auto-resolve would be noise.
          });
        }
      });
    };
    load();
    window.addEventListener(REFRESH_SHARPENING_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(REFRESH_SHARPENING_EVENT, load);
    };
  }, [open, spaceId, editor]);

  // AI activity strip — listen for auto-resolve in-flight pulses. The bus
  // events fire from BOTH entry points (card "Let AI decide" + Studio "Let
  // AI answer all"); the rail just reflects them. Mounted while open so a
  // closed rail isn't silently subscribed. The post-flight resolution list
  // arrives via the existing REFRESH_SHARPENING_EVENT path that feeds the
  // clarity loader — no separate fetch.
  useEffect(() => {
    if (!open) return;
    const onStart = (e: Event) => {
      const d = (e as CustomEvent<AiAutoResolveStartedDetail>).detail;
      if (!d || d.spaceId !== spaceId) return;
      setAiBusy({ trigger: d.trigger, conceptCount: d.conceptCount });
    };
    const onEnd = (e: Event) => {
      const d = (e as CustomEvent<AiAutoResolveEndedDetail>).detail;
      if (!d || d.spaceId !== spaceId) return;
      setAiBusy(null);
      // Step 6 — post-AI sweep flag. The refresh handler (fired later by
      // /apply-resolutions) reads this and chains an emergent re-scan once
      // the artifact has settled. Only on successful commits; a failed run
      // shouldn't trigger an LLM call on top.
      if (d.ok && d.resolvedCount > 0) {
        recentAutoResolveRef.current = { at: Date.now(), ok: true };
      }
    };
    window.addEventListener(AI_AUTORESOLVE_STARTED_EVENT, onStart);
    window.addEventListener(AI_AUTORESOLVE_ENDED_EVENT, onEnd);
    return () => {
      window.removeEventListener(AI_AUTORESOLVE_STARTED_EVENT, onStart);
      window.removeEventListener(AI_AUTORESOLVE_ENDED_EVENT, onEnd);
    };
  }, [open, spaceId]);

  // Live-breathe: when the user edits the board (adds a card, types into a
  // sticky), debounce 2.5s and re-run the addressing pass. The dots fill in
  // without a manual refresh. Listener is only attached while the rail is
  // open — no idle background work; no listener leak.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!alive) return;
        void addressMicros(spaceId, editor).then((r) => {
          if (!alive || !r || r.deltas === 0) return;
          setClarity((prev) =>
            prev ? { ...prev, anns: r.annotations } : prev,
          );
        });
      }, 2500);
    };
    let unlisten: (() => void) | undefined;
    try {
      // Only react to USER store changes (typing, dragging) — programmatic
      // shape additions (e.g. the ranker focusing a node) shouldn't re-trigger.
      unlisten = editor.store.listen(schedule, { source: "user", scope: "all" });
    } catch {
      /* tldraw store unavailable — fall back to event-only triggers. */
    }
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (unlisten) unlisten();
    };
  }, [open, spaceId, editor]);

  const loading = open && data === null;

  function refresh() {
    setRefreshing(true);
    void fetchClarity(spaceId).then((c) => {
      if (c) setClarity(c);
    });
    fetchRanking(editor, spaceId)
      .then((d) => {
        if (d) setData(d);
      })
      .finally(() => setRefreshing(false));
  }

  // The left-edge launcher pill is retired — the top-right nav bar opens this.
  if (!open) return null;

  const goal = data?.goal;
  // Heartbeat: prefer the FAST clarity fetch (GET, no LLM) for the headline so
  // the title shows the moment the fast sharpening pass lands — before the
  // slower board-ranking call returns.
  const goalTitle = clarity?.title || goal?.title || "";
  const goalDesc = clarity?.sharpenedPrompt || goal?.description || "";
  const ranked = data?.ranked ?? [];
  // Group by direction (header once per group) instead of repeating the label
  // on every row; each group sorted by score desc.
  const groups = (["convergent", "divergent"] as const)
    .map((dir) => ({
      dir,
      label: dir === "convergent" ? "Converging" : "Diverging",
      accent: dir === "convergent" ? "#059669" : "#D97706",
      items: ranked
        .filter((r) => r.direction === dir)
        .sort((a, b) => b.score - a.score),
    }))
    .filter((g) => g.items.length > 0);

  // Clarity rollup — micro-aware. When the depth pass emitted micro_questions
  // we count answered / total at the SUB-question level, so the meter climbs
  // incrementally as individual sub-questions resolve (not only on full-macro
  // commits). Legacy artifacts with no micros fall back to the binary count
  // (the implicit "1 micro = the macro" model).
  const anns = clarity?.anns ?? [];
  const resolvedSet = clarity?.resolvedSlugs ?? new Set<string>();
  const microStats = (a: SalienceAnn): { answered: number; total: number } => {
    const m = a.micro_questions;
    if (!m || m.length === 0) {
      const isResolved = resolvedSet.has(slugifyPhrase(a.phrase));
      return { answered: isResolved ? 1 : 0, total: 1 };
    }
    // A macro-level resolution short-circuits all micros (the user answered
    // the whole concept in the Studio). Otherwise count micro-level resolves.
    const macroResolved = resolvedSet.has(slugifyPhrase(a.phrase));
    return {
      answered: macroResolved
        ? m.length
        : m.filter((q) => q.resolved_at).length,
      total: m.length,
    };
  };
  const totals = anns.reduce(
    (acc, a) => {
      const s = microStats(a);
      acc.answered += s.answered;
      acc.total += s.total;
      return acc;
    },
    { answered: 0, total: 0 },
  );
  const clarityPct =
    totals.total > 0 ? Math.round((totals.answered / totals.total) * 100) : 0;
  // The "concepts resolved" count (macro-level) stays useful as a secondary
  // signal — readable shorthand for "how many top-level ambiguities are fully
  // closed". Shown alongside the micro count below.
  const resolvedConcepts = anns.filter((a) =>
    resolvedSet.has(slugifyPhrase(a.phrase)),
  ).length;
  const openQuestions = anns
    .filter((a) => !resolvedSet.has(slugifyPhrase(a.phrase)))
    .sort((a, b) => annPriority(b) - annPriority(a))
    .slice(0, 3);

  function openResolve() {
    if (!clarity || clarity.anns.length === 0) return;
    openResolutionStudio({
      spaceId,
      objectiveTitle: clarity.title,
      sharpenedPrompt: clarity.sharpenedPrompt,
      concepts: clarity.anns.map((a) => ({
        phrase: a.phrase,
        kind: a.kind,
        leverage: a.leverage,
        uncertainty: a.uncertainty,
        why: a.why,
        candidate_readings: a.candidate_readings,
      })),
    });
  }

  // Open a one-card Studio session focused on a single AI commit so the user
  // can override it. The Studio's deck-of-one is functionally the same as the
  // full path; we just narrow the deck.
  function openReviewFor(item: AiActivityItem) {
    if (!clarity) return;
    const ann = clarity.anns.find(
      (a) => slugifyPhrase(a.phrase) === item.concept_slug,
    );
    if (!ann) return;
    openResolutionStudio({
      spaceId,
      objectiveTitle: clarity.title,
      sharpenedPrompt: clarity.sharpenedPrompt,
      concepts: [
        {
          phrase: ann.phrase,
          kind: ann.kind,
          leverage: ann.leverage,
          uncertainty: ann.uncertainty,
          why: ann.why,
          candidate_readings: ann.candidate_readings,
        },
      ],
    });
  }

  // Manual board-aware re-scan handler. Shows the spin on the rescan icon
  // while in flight, then a transient banner ("N new questions" or "nothing
  // new from board") so the user sees the run land even on a no-op. After a
  // successful run with new rows, swap the rail's annotations in place so the
  // emergent "new" pulse appears without a full re-fetch.
  async function onRescan() {
    if (rescanBusy || !clarity) return;
    setRescanBusy(true);
    setRescanResult(null);
    const r = await rescanEmergent(spaceId, editor);
    setRescanBusy(false);
    if (!r) {
      setRescanResult("Re-scan failed");
    } else if (r.emergentCount > 0) {
      setClarity((prev) =>
        prev ? { ...prev, anns: r.annotations } : prev,
      );
      setRescanResult(
        `${r.emergentCount} new question${r.emergentCount === 1 ? "" : "s"}`,
      );
    } else {
      setRescanResult("Nothing new from the board");
    }
    // Fade the banner after ~4s — short-lived feedback, not persistent state.
    window.setTimeout(() => setRescanResult(null), 4000);
  }

  // Friendly relative timestamp for the activity rows ("2m ago", "1h ago"). The
  // strip is the LIVE feed; absolute times feel out of place. Falls back to
  // the local date for anything older than a day.
  function relTime(iso: string): string {
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return "just now";
    if (s < 90) return "1m ago";
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 5400) return "1h ago";
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return "";
    }
  }

  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={panel}>
      {/* header */}
      <div style={header}>
        <Compass style={{ width: 15, height: 15, color: appleVibe.text.secondary }} strokeWidth={2.2} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: appleVibe.text.primary }}>
          Goal &amp; alignment
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <button type="button" title="Re-rank" onClick={refresh} disabled={refreshing} style={iconBtn}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          </button>
          <button type="button" title="Close" onClick={() => setOpen(false)} style={iconBtn}>
            <X style={{ width: 15, height: 15 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* goal */}
      <div style={{ padding: "11px 12px", borderBottom: "1px solid var(--glass-border)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: appleVibe.text.faint, marginBottom: 4 }}>
          Ultimate goal
        </div>
        <div
          className={goalTitle ? undefined : "animate-pulse"}
          style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.01em", color: goalTitle ? appleVibe.text.primary : appleVibe.text.faint }}
        >
          {goalTitle || "Sharpening your objective…"}
        </div>
        {goalDesc && (
          <>
            <div
              style={{
                marginTop: 5,
                fontSize: 12,
                lineHeight: 1.45,
                color: appleVibe.text.tertiary,
                display: "-webkit-box",
                WebkitLineClamp: descOpen ? "unset" : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {goalDesc}
            </div>
            {goalDesc.length > 140 && (
              <button
                type="button"
                onClick={() => setDescOpen((o) => !o)}
                style={{ marginTop: 3, border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: appleVibe.text.secondary, fontFamily: appleVibe.font.stack }}
              >
                {descOpen ? <ChevronDown style={{ width: 12, height: 12 }} strokeWidth={2.4} /> : <ChevronRight style={{ width: 12, height: 12 }} strokeWidth={2.4} />}
                {descOpen ? "Less" : "More"}
              </button>
            )}
          </>
        )}
      </div>

      {/* clarity & priorities — objective-level intake intelligence; the live
          scoreboard for the resolve-ambiguity feedback loop. */}
      {clarity && anns.length > 0 && (
        <div style={{ padding: "11px 12px", borderBottom: "1px solid var(--glass-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" onClick={() => setPriOpen((o) => !o)} style={clarityHeaderBtn}>
              {priOpen ? (
                <ChevronDown style={{ width: 12, height: 12 }} strokeWidth={2.4} />
              ) : (
                <ChevronRight style={{ width: 12, height: 12 }} strokeWidth={2.4} />
              )}
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: appleVibe.text.faint }}>
                Clarity &amp; priorities
              </span>
            </button>
            {/* Tier-1 board-aware re-scan trigger — manually surface emergent
                ambiguities from the user's current board work. Disabled until
                an artifact + salient concepts exist (the gate the route
                enforces too). */}
            <button
              type="button"
              onClick={onRescan}
              disabled={rescanBusy || anns.length === 0}
              title="Re-scan the board for new ambiguities"
              style={{
                ...iconBtn,
                opacity: anns.length === 0 ? 0.4 : 1,
                cursor:
                  rescanBusy || anns.length === 0 ? "default" : "pointer",
              }}
            >
              <RotateCcw
                className={rescanBusy ? "animate-spin" : undefined}
                style={{ width: 12, height: 12 }}
                strokeWidth={2.2}
              />
            </button>
            <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: "#059669", fontVariantNumeric: "tabular-nums" }}>
              {clarityPct}%
            </span>
          </div>
          {/* Re-scan toast — short-lived, never persistent. Colored by outcome
              (success / no-op / fail) so a glance tells you what happened. */}
          {rescanResult && (
            <div
              style={{
                marginTop: 5,
                padding: "4px 7px",
                borderRadius: appleVibe.radius.sm,
                background:
                  rescanResult.includes("new question")
                    ? "rgba(124, 58, 237, 0.10)"
                    : rescanResult === "Re-scan failed"
                      ? "rgba(217, 119, 6, 0.10)"
                      : appleVibe.surface.chip,
                fontSize: 11,
                fontWeight: 600,
                color:
                  rescanResult.includes("new question")
                    ? "#7C3AED"
                    : rescanResult === "Re-scan failed"
                      ? "#D97706"
                      : appleVibe.text.tertiary,
              }}
            >
              {rescanResult}
            </div>
          )}

          {/* clarity meter — climbs as ambiguities get resolved */}
          <div style={{ marginTop: 8, height: 4, borderRadius: 999, background: appleVibe.surface.chip, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", borderRadius: 999, width: `${clarityPct}%`, background: "#059669", transition: "width 0.4s ease" }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: appleVibe.text.tertiary }}>
            {totals.answered} of {totals.total} sub-questions answered
            {anns.length > 0 && (
              <span style={{ color: appleVibe.text.faint }}>
                {" · "}
                {resolvedConcepts}/{anns.length} concepts
              </span>
            )}
          </div>

          {priOpen && (
            <>
              {openQuestions.length > 0 ? (
                <div style={{ marginTop: 9 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: appleVibe.text.faint, marginBottom: 5 }}>
                    Nail next
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {openQuestions.map((a, i) => {
                      const s = microStats(a);
                      const showDots = (a.micro_questions?.length ?? 0) > 0;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={openResolve}
                          title={
                            a.emerged_at
                              ? `Newly surfaced from board work · ${a.why || "Resolve this"}`
                              : a.why || "Resolve this"
                          }
                          style={openQRow}
                          onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: appleVibe.text.faint, flexShrink: 0 }}>
                            {a.kind}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, color: appleVibe.text.primary }}>
                            {a.phrase}
                          </span>
                          {a.emerged_at && (
                            <span
                              className="animate-pulse"
                              style={{
                                fontSize: 8.5,
                                fontWeight: 800,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                padding: "1px 5px",
                                borderRadius: 999,
                                background: "rgba(124, 58, 237, 0.14)",
                                color: "#7C3AED",
                                flexShrink: 0,
                              }}
                              title="Surfaced by board re-scan"
                            >
                              new
                            </span>
                          )}
                          {showDots && (
                            <span
                              style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}
                              aria-label={`${s.answered} of ${s.total} sub-questions answered`}
                            >
                              {a.micro_questions!.map((m, j) => {
                                const resolved = !!m.resolved_at;
                                const addressing =
                                  !resolved && (m.addressed_by?.length ?? 0) > 0;
                                return (
                                  <span
                                    key={m.id ?? j}
                                    title={
                                      resolved
                                        ? "resolved"
                                        : addressing
                                          ? "being addressed"
                                          : "open"
                                    }
                                    style={{
                                      width: 5,
                                      height: 5,
                                      borderRadius: 999,
                                      background: resolved
                                        ? "#059669"
                                        : addressing
                                          ? "#D97706"
                                          : appleVibe.surface.chip,
                                      border:
                                        resolved || addressing
                                          ? "none"
                                          : `1px solid ${appleVibe.text.faint}`,
                                    }}
                                  />
                                );
                              })}
                            </span>
                          )}
                          {showDots && (
                            <span style={{ fontSize: 10.5, fontWeight: 600, color: appleVibe.text.faint, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                              {s.answered}/{s.total}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 9, fontSize: 12, color: "#059669", fontWeight: 600 }}>
                  All ambiguities resolved ✓
                </div>
              )}

              {openQuestions.length > 0 && (
                <button type="button" onClick={openResolve} style={resolveCta}>
                  Resolve open questions
                  <ArrowRight style={{ width: 13, height: 13 }} strokeWidth={2.4} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ai activity — auto-resolver presence at the objective altitude.
          Renders when a call is in flight (pulse) OR when there are recent
          AI commits in the artifact. Each ⚠ row is a one-click review path. */}
      {(aiBusy || (clarity && clarity.aiActivity.length > 0)) && (
        <div style={{ padding: "10px 12px 12px", borderBottom: "1px solid var(--glass-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Sparkles
              style={{
                width: 12,
                height: 12,
                color: aiBusy ? "#7C3AED" : appleVibe.text.faint,
              }}
              className={aiBusy ? "animate-pulse" : undefined}
              strokeWidth={2.4}
            />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: appleVibe.text.faint }}>
              AI activity
            </span>
            {aiBusy && (
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#7C3AED", fontVariantNumeric: "tabular-nums" }}>
                resolving {aiBusy.conceptCount}…
              </span>
            )}
          </div>
          {clarity && clarity.aiActivity.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {clarity.aiActivity.map((item) => {
                const review = item.needs_review === true;
                const confPct =
                  typeof item.confidence === "number"
                    ? Math.round(item.confidence * 100)
                    : null;
                return (
                  <button
                    key={`${item.concept_slug}-${item.resolved_at}`}
                    type="button"
                    onClick={() => openReviewFor(item)}
                    title={
                      review
                        ? `Low-confidence AI decision — click to review`
                        : `AI decided · click to override`
                    }
                    style={aiActivityRow}
                    onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {review ? (
                      <AlertTriangle
                        style={{ width: 11, height: 11, color: "#D97706", flexShrink: 0 }}
                        strokeWidth={2.4}
                      />
                    ) : (
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 999,
                          background: "#7C3AED",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        fontWeight: 600,
                        color: appleVibe.text.primary,
                      }}
                    >
                      {item.phrase}
                    </span>
                    {confPct !== null && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: review ? "#D97706" : appleVibe.text.faint,
                          fontVariantNumeric: "tabular-nums",
                          flexShrink: 0,
                        }}
                      >
                        {confPct}%
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: appleVibe.text.faint, flexShrink: 0 }}>
                      {relTime(item.resolved_at)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ranking */}
      <div style={{ padding: "9px 12px 4px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: appleVibe.text.faint }}>
          Live ranking
        </span>
        {ranked.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: appleVibe.text.faint }}>{ranked.length}</span>}
      </div>

      <div style={scrollArea}>
        {loading ? (
          <div style={emptyRow}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Ranking the board…</div>
        ) : ranked.length === 0 ? (
          <div style={{ padding: "12px 4px", fontSize: 12.5, lineHeight: 1.4, color: appleVibe.text.tertiary }}>
            No nodes to rank yet — add cards/notes, then re-rank.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.dir} style={{ marginBottom: 6 }}>
              <div style={sectionHeader}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: g.accent, flexShrink: 0 }} />
                <span style={{ color: g.accent }}>{g.label}</span>
                <span style={{ marginLeft: "auto", fontWeight: 600, color: appleVibe.text.faint }}>{g.items.length}</span>
              </div>
              {g.items.map((r) => {
                const score = Math.round(r.score * 100);
                const name = labelFor(editor, r.id);
                const bad = name === "(removed)" || name === "Untitled";
                const primary = bad && r.reason ? r.reason : name;
                const secondary = !bad && r.reason ? r.reason : "";
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => focusNode(editor, r.id)}
                    title="Focus on the board"
                    style={rowThin}
                    onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                      <span style={{ ...scoreCell, color: g.accent }}>{score}</span>
                      <span style={nameCell}>{primary}</span>
                    </span>
                    {secondary && <span style={reasonCell}>{secondary}</span>}
                    <span style={barTrack}>
                      <span style={{ ...barFill, width: `${score}%`, background: g.accent }} />
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── styles ──
const panel: CSSProperties = {
  position: "absolute",
  // Start below the top chrome (tldraw Page menu + AI settings bar) so the
  // "Goal & alignment" header isn't hidden behind it — matches launcherPill.
  top: 64,
  bottom: 12,
  left: 12,
  width: 340,
  zIndex: 92,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.38)",
  fontFamily: appleVibe.font.stack,
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 12px 9px",
  borderBottom: "1px solid var(--glass-border)",
};
const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.tertiary,
};
const scrollArea: CSSProperties = { flex: 1, overflowY: "auto", padding: "0 12px 14px", minHeight: 0 };
const emptyRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "16px 4px", color: appleVibe.text.tertiary, fontSize: 12.5 };
const sectionHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 3px 5px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
const rowThin: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 7px",
  marginBottom: 1,
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const scoreCell: CSSProperties = {
  width: 24,
  flexShrink: 0,
  textAlign: "right",
  fontSize: 11.5,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
};
const nameCell: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12.5,
  fontWeight: 600,
  color: appleVibe.text.primary,
  letterSpacing: "-0.01em",
};
const reasonCell: CSSProperties = {
  display: "block",
  marginLeft: 33,
  marginTop: 1,
  fontSize: 11,
  lineHeight: 1.3,
  color: appleVibe.text.tertiary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const barTrack: CSSProperties = {
  display: "block",
  marginLeft: 33,
  marginTop: 4,
  height: 2,
  borderRadius: 999,
  background: appleVibe.surface.chip,
  overflow: "hidden",
};
const barFill: CSSProperties = { display: "block", height: "100%", borderRadius: 999 };
const clarityHeaderBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: appleVibe.text.faint,
  fontFamily: appleVibe.font.stack,
};
const openQRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  textAlign: "left",
  padding: "4px 6px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const aiActivityRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  textAlign: "left",
  padding: "4px 6px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const resolveCta: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  marginTop: 9,
  padding: "7px 10px",
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: "#059669",
  color: "#fff",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};

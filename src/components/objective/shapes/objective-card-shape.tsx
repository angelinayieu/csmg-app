"use client";

// ── ObjectiveCardShapeUtil ──
//
// The objective on the board — its own card type (replaces the reused
// room-card "__obj"). The chatbox card transforms into this in place on
// submit. Opening it (the "Open ↗" button, or a double-click anywhere) opens
// the objective as a NODE (the board-sourced ObjectiveNode in the object-detail
// drawer) whose contents are everything on the whiteboard. The heart favorites
// it (meta.favorited) so it appears in the left favorites sidebar.
//
// AUTO-HEIGHT: the card measures its content and grows to fit, so the FULL
// title always shows (no clamp / cropping). Width is the standard 340.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
} from "tldraw";
import { Heart, Loader2 } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  OPEN_CARD_DETAIL_EVENT,
  OBJECTIVE_MARKER,
} from "@/components/objective/canvas-interactions/object-detail-drawer";
import { reflowIntakeStack } from "@/components/objective/canvas-interactions/board-reflow";
import { openSeedChat } from "@/lib/objective-canvas/seed/seed-chat-signal";
import { openSeedMap } from "@/lib/objective-canvas/seed/seed-map-signal";
import { startSeedAutoBuild } from "@/lib/objective-canvas/seed/seed-autobuild-signal";
import { openSeedIdeas } from "@/lib/objective-canvas/seed/seed-ideas-signal";

export type ObjectiveCardShape = TLBaseShape<
  "objective-card",
  {
    w: number;
    h: number;
    spaceId: string;
    /** distilled / short title */
    title: string;
    /** the full objective text */
    objective: string;
    color: string;
  }
>;

/** Fork trigger — must match deploy-oc-cards.ts's DECOMPOSE_INTO_CARDS_EVENT.
 *  Defined locally to avoid pulling the tldraw-heavy deploy module (+ any import
 *  cycle) into the shape; whiteboard-base's listener does the actual decompose. */
const DECOMPOSE_INTO_CARDS_EVENT = "objective-board:decompose-into-cards";

/** Fork into OTHER artifact types — all reuse handlers already mounted in
 *  whiteboard-base, so the card stays decoupled (defined locally, like above):
 *   • CARD_ACTION_EVENT  → executeCardOperation (decompose+spaceId = unpack →
 *     principles+variations; make_plan → an action plan).
 *   • BUILD_UI_PLANS_EVENT → UiPlanEventBridge drops "plain UI" plan cards, each
 *     of which then leads to a real prototype (plan → prototype). */
const CARD_ACTION_EVENT = "objective-board:card-action";
const BUILD_UI_PLANS_EVENT = "objective-board:build-ui-plans";

/** A leverage point the user can fork from (mirrors SeedLeverageRef). */
interface LeverLite { slug?: string; label: string; score?: number; rationale?: string }

/** Section header in the fork popover. */
const forkHead = {
  fontSize: 8.5,
  fontWeight: 800,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: appleVibe.text.faint,
  padding: "4px 8px 3px",
} as const;

/** One row in the fork popover. */
const forkRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  padding: "6px 8px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 11,
  textAlign: "left",
  fontFamily: appleVibe.font.stack,
} as const;

/** The evaluator's headline (mirrors SeedEvaluation — local to avoid a lib
 *  import). The biggestGap is the single most useful line on the card. */
interface EvalFace {
  biggestGap?: string;
  biggestGapKind?: "stop_ship" | "two_way_door";
  call?: "go" | "refine_first";
}

/** The seed's external face (mirrors SeedExternal — kept local to avoid a
 *  lib import in the shape). */
interface SeedFace {
  deliverable: string;
  vsAlternatives: string;
  valueToSwitch: number;
  doNext: string;
  confidence: number;
}

/** Fire the open-objective event (board-sourced ObjectiveNode drawer). */
function openObjective() {
  window.dispatchEvent(
    new CustomEvent(OPEN_CARD_DETAIL_EVENT, {
      detail: { objectId: OBJECTIVE_MARKER },
    }),
  );
}

export class ObjectiveCardShapeUtil extends BaseBoxShapeUtil<ObjectiveCardShape> {
  static override type = "objective-card" as const;
  static override props: RecordProps<ObjectiveCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    title: T.string,
    objective: T.string,
    color: T.string,
  };

  // Auto-sized to its content — no manual resize (keeps the standard width +
  // a height that always fits the full title).
  override canResize = () => false;
  override canEdit = () => false;

  // Double-click anywhere on the card opens it (reliable, unlike a body click
  // which tldraw can swallow as a selection).
  override onDoubleClick = () => {
    openObjective();
  };

  getDefaultProps(): ObjectiveCardShape["props"] {
    return {
      w: 340,
      h: 168,
      spaceId: "",
      title: "Objective",
      objective: "",
      color: appleVibe.stage.objective,
    };
  }

  component(shape: ObjectiveCardShape) {
    return <ObjectiveCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: ObjectiveCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function ObjectiveCardRenderer({
  shape,
  util,
}: {
  shape: ObjectiveCardShape;
  util: ObjectiveCardShapeUtil;
}) {
  const editor = util.editor;
  const { w, h, spaceId, title, objective, color } = shape.props;
  const favorited = !!(shape.meta as { favorited?: boolean })?.favorited;
  const ref = useRef<HTMLDivElement>(null);

  // The seed's EXTERNAL face — the one deliverable. Built headlessly by
  // SeedMount; the card polls /seed and surfaces it (the reasoning stays
  // sandboxed inside the seed, peeked only on open). null while seeding.
  const [seed, setSeed] = useState<{
    status?: string;
    external?: SeedFace | null;
    internal?: { evaluation?: EvalFace | null; reasoningGraph?: { nodes?: unknown[] }; leveragePoints?: LeverLite[] };
  } | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const triggerAuto = () => { startSeedAutoBuild(spaceId); setAutoTriggered(true); };
  // Live reasoning stage (from the Crucible) — drives the on-card progress while
  // the deliverable is still being built. A pure read, safe to poll.
  const [stage, setStage] = useState<{ status?: string; round?: number } | null>(null);

  // Instant skeleton graph: fire once on mount so the Map peek + the
  // "N concepts mapped" line aren't blank while the real reasoning runs.
  const skeletonFired = useRef(false);
  useEffect(() => {
    if (!spaceId || !objective || skeletonFired.current) return;
    skeletonFired.current = true;
    void fetch(`/api/objective/${spaceId}/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skeleton", objective }),
      cache: "no-store",
    }).catch(() => {});
  }, [spaceId, objective]);

  useEffect(() => {
    if (!spaceId) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      tries += 1;
      try {
        const r = await fetch(`/api/objective/${spaceId}/seed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "get" }),
          cache: "no-store",
        });
        if (r.ok) {
          const j = (await r.json()) as { seed?: typeof seed };
          if (alive && j.seed) setSeed(j.seed);
          if (alive && j.seed?.status === "ready") return; // stop polling once distilled
          // Not ready yet — pull the Crucible stage so the card shows motion.
          const cr = await fetch(`/api/objective/${spaceId}/crucible`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "state" }),
            cache: "no-store",
          });
          if (cr.ok && alive) {
            const cj = (await cr.json()) as { state?: { status?: string; round?: number } | null };
            if (cj.state) setStage({ status: cj.state.status, round: cj.state.round });
          }
        }
      } catch {
        /* transient */
      }
      if (alive && tries < 48) timer = setTimeout(tick, 5000);
    }
    timer = setTimeout(tick, 1200);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId]);
  const ext = seed?.external ?? null;
  const evalF = seed?.internal?.evaluation ?? null;
  const graphCount = seed?.internal?.reasoningGraph?.nodes?.length ?? 0;
  const levers = [...(seed?.internal?.leveragePoints ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4);
  // Fire the on-demand fork. No `objective` → the whole objective; a lever →
  // narrow the decompose to that leverage point (handler honors both — no
  // whiteboard-base edit needed). Always tether the fork bezier to THIS card.
  const forkInto = (lever?: LeverLite) => {
    const detail: { sourceShapeId: string; objective?: string; subsystemSeed?: { phrase: string; slug?: string; why?: string } } = {
      sourceShapeId: String(shape.id),
    };
    if (lever) {
      detail.objective = lever.rationale ? `${lever.label} — ${lever.rationale}` : lever.label;
      detail.subsystemSeed = { phrase: lever.label, slug: lever.slug, why: lever.rationale };
    }
    window.dispatchEvent(new CustomEvent(DECOMPOSE_INTO_CARDS_EVENT, { detail }));
    setForkOpen(false);
  };
  // Fork into a non-feature artifact type. CARD_ACTION ops (unpack/plan) run via
  // executeCardOperation; the prototype path drops UI-plan cards that lead to a
  // real prototype. All tethered to THIS card; all handlers already mounted.
  const forkAction = (action: "decompose" | "make_plan") => {
    window.dispatchEvent(
      new CustomEvent(CARD_ACTION_EVENT, {
        detail: { action, title: objective, entityId: `obj:${String(shape.id)}`, shapeId: String(shape.id) },
      }),
    );
    setForkOpen(false);
  };
  const forkPrototypePlan = () => {
    window.dispatchEvent(
      new CustomEvent(BUILD_UI_PLANS_EVENT, {
        detail: { sourceShapeId: String(shape.id), sourceText: objective, sourceLabel: title, count: 3 },
      }),
    );
    setForkOpen(false);
  };
  // Stage label for the on-card progress (only while the deliverable isn't ready).
  const awaitingUser = stage?.status === "awaiting_user";
  const progressLabel =
    seed?.status === "error"
      ? "Couldn't build the move — try refining in chat"
      : stage?.status === "converged"
        ? "Building the deliverable…"
        : stage?.status === "working"
          ? `Mapping the levers${stage.round ? ` · round ${stage.round}` : ""}…`
          : "Sharpening the objective…";
  const seedSig = `${ext ? ext.deliverable : seed?.status ?? ""}|${evalF?.biggestGap ?? ""}|${awaitingUser ? "ask" : progressLabel}|${graphCount}`;

  // Grow (or shrink) the shape's height to fit the rendered content so the full
  // title always shows. Guard on a >1px delta so it converges (no loop).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const needed = Math.ceil(el.offsetHeight);
    if (needed > 0 && Math.abs(needed - h) > 1) {
      editor.updateShape<ObjectiveCardShape>({
        id: shape.id,
        type: "objective-card",
        props: { h: needed },
      });
      // The card just grew (or shrank). Push the sharpening card + any
      // anchored cards back below it so a long objective never overlaps the
      // sharpening intake stack. Same-layout-effect → no visible jitter.
      reflowIntakeStack(editor);
    }
    // Re-measure when the content or width changes (NOT on h → avoids a loop).
    // seedSig grows the card when the external deliverable lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, title, objective, seedSig]);

  function toggleFavorite(e: React.MouseEvent) {
    e.stopPropagation();
    editor.updateShape<ObjectiveCardShape>({
      id: shape.id,
      type: "objective-card",
      meta: { ...shape.meta, favorited: !favorited },
    });
  }

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        ref={ref}
        onClick={openObjective}
        style={{
          width: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,249,252,0.97) 100%)",
          border: `1px solid ${color}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 46px -18px ${color}55, 0 8px 22px -12px rgba(11,18,40,0.16)`,
          padding: "14px 15px 13px",
          display: "flex",
          flexDirection: "column",
          cursor: "pointer",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow + heart */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(71,85,105,0.9)",
            }}
          >
            Objective
          </span>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={toggleFavorite}
            aria-label={favorited ? "Unfavorite" : "Favorite"}
            title={favorited ? "Remove from sidebar" : "Add to sidebar"}
            style={{
              marginLeft: "auto",
              display: "inline-grid",
              placeItems: "center",
              width: 26,
              height: 26,
              borderRadius: 999,
              border: "none",
              background: favorited ? "rgba(244,63,94,0.10)" : "rgba(15,23,42,0.04)",
              cursor: "pointer",
            }}
          >
            <Heart
              style={{
                width: 14,
                height: 14,
                color: favorited ? "#F43F5E" : appleVibe.text.faint,
              }}
              fill={favorited ? "#F43F5E" : "none"}
              strokeWidth={2.2}
            />
          </button>
        </div>

        {/* Title — full, no clamp (the card auto-grows to fit it). */}
        <div
          style={{
            marginTop: 8,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.2,
            color: appleVibe.text.primary,
            overflowWrap: "anywhere",
          }}
        >
          {title || "Objective"}
        </div>

        {/* Objective text (kept to a few lines — only the title must be full). */}
        {objective && objective !== title && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {objective}
          </div>
        )}

        {/* The seed's EXTERNAL deliverable — the one high-leverage move, the
            product. The reasoning stays sandboxed inside (peek on open). */}
        {ext && ext.deliverable ? (
          <div
            onPointerDown={stopEventPropagation}
            style={{
              marginTop: 11,
              padding: "10px 11px",
              borderRadius: 13,
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.20)",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#B45309",
              }}
            >
              Highest-leverage move
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.3, color: appleVibe.text.primary }}>
              {ext.deliverable}
            </span>
            {ext.vsAlternatives && (
              <span style={{ fontSize: 11, lineHeight: 1.4, color: appleVibe.text.secondary }}>
                {ext.vsAlternatives}
              </span>
            )}
            {(ext.doNext || ext.valueToSwitch > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 1 }}>
                {ext.valueToSwitch > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: "#B45309",
                      background: "rgba(245,158,11,0.14)",
                      padding: "2px 7px",
                      borderRadius: 999,
                    }}
                    title="Value to switch vs. existing tools"
                  >
                    {ext.valueToSwitch} value
                  </span>
                )}
                {ext.doNext && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: appleVibe.text.tertiary, flex: 1, minWidth: 0 }}>
                    → {ext.doNext}
                  </span>
                )}
              </div>
            )}
            {evalF?.biggestGap && (
              <div
                onClick={(e) => { e.stopPropagation(); openSeedChat(spaceId); }}
                title="Click to answer this in chat — it's the decisive thing not yet considered"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  marginTop: 6,
                  paddingTop: 7,
                  borderTop: "1px solid rgba(0,0,0,0.06)",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 11, lineHeight: 1.3, flexShrink: 0, color: evalF.biggestGapKind === "stop_ship" ? "#DC2626" : "#B45309" }}>
                  {evalF.biggestGapKind === "stop_ship" ? "⛔" : "⚠"}
                </span>
                <span style={{ fontSize: 10.5, lineHeight: 1.4, color: appleVibe.text.secondary, flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 800, color: evalF.biggestGapKind === "stop_ship" ? "#DC2626" : "#B45309" }}>
                    Not yet considered:{" "}
                  </span>
                  {evalF.biggestGap}
                </span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              {evalF?.call && (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: "0.03em",
                    padding: "2px 7px",
                    borderRadius: 999,
                    color: evalF.call === "go" ? "#047857" : "#B45309",
                    background: evalF.call === "go" ? "rgba(16,185,129,0.13)" : "rgba(245,158,11,0.14)",
                  }}
                  title={evalF.call === "go" ? "Decisive factors covered enough to test cheaply" : "A decisive gap should be closed before building"}
                >
                  {evalF.call === "go" ? "✓ ready to test" : "refine first"}
                </span>
              )}
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => { e.stopPropagation(); openSeedChat(spaceId); }}
                style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10.5, fontWeight: 700, color: "#7C3AED", fontFamily: appleVibe.font.stack }}
              >
                Refine in chat ↗
              </button>
            </div>
          </div>
        ) : (
          objective && (
            awaitingUser && !autoTriggered ? (
              // The agent has questions — give BOTH paths: answer yourself, or
              // let the AI auto-resolve everything (best-of-N → ranked → picked).
              <div onPointerDown={stopEventPropagation} style={{ marginTop: 11, display: "flex", flexWrap: "wrap", gap: 7 }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openSeedChat(spaceId); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 11px", borderRadius: 999,
                    border: "1px solid rgba(124,58,237,0.25)", background: "rgba(124,58,237,0.06)", cursor: "pointer",
                    fontSize: 11.5, fontWeight: 700, color: "#7C3AED", fontFamily: appleVibe.font.stack,
                  }}
                  title="Answer a few questions yourself — your input is the strongest signal"
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: "#7C3AED", boxShadow: "0 0 0 3px rgba(124,58,237,0.16)" }} />
                  Answer a few questions →
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); triggerAuto(); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 999,
                    border: "1px solid rgba(16,185,129,0.30)", background: "rgba(16,185,129,0.08)", cursor: "pointer",
                    fontSize: 11.5, fontWeight: 700, color: "#047857", fontFamily: appleVibe.font.stack,
                  }}
                  title="Let the AI answer every question itself — it drafts several options per question, ranks them, and picks the best. Refine later in chat."
                >
                  ⚡ Auto-build it for me
                </button>
              </div>
            ) : (
              // Live progress — the pipeline runs; show it's moving + when.
              <div
                onPointerDown={stopEventPropagation}
                style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 6 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {seed?.status !== "error" && (
                    <Loader2 className="animate-spin" style={{ width: 12, height: 12, color: autoTriggered ? "#047857" : "#7C3AED", flexShrink: 0 }} strokeWidth={2.4} />
                  )}
                  <span style={{ fontSize: 11.5, fontWeight: 650, color: seed?.status === "error" ? "#DC2626" : appleVibe.text.secondary }}>
                    {autoTriggered && seed?.status !== "error" ? `Auto-building · ${progressLabel.replace(/…$/, "")}…` : progressLabel}
                  </span>
                  {graphCount > 0 && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: appleVibe.text.faint }}>
                      · {graphCount} concept{graphCount === 1 ? "" : "s"} mapped
                    </span>
                  )}
                </div>
                {/* indeterminate sweep bar */}
                {seed?.status !== "error" && (
                  <div style={{ position: "relative", height: 3, borderRadius: 999, background: autoTriggered ? "rgba(16,185,129,0.14)" : "rgba(124,58,237,0.12)", overflow: "hidden" }}>
                    <div className="seed-progress-sweep" style={{ position: "absolute", top: 0, bottom: 0, width: "38%", borderRadius: 999, background: `linear-gradient(90deg, ${autoTriggered ? "rgba(16,185,129,0)" : "rgba(124,58,237,0)"} 0%, ${autoTriggered ? "#10B981" : "#7C3AED"} 50%, ${autoTriggered ? "rgba(16,185,129,0)" : "rgba(124,58,237,0)"} 100%)` }} />
                  </div>
                )}
                {!autoTriggered && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openSeedChat(spaceId); }}
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10.5, fontWeight: 700, color: "#7C3AED", fontFamily: appleVibe.font.stack }}
                    >
                      Help it along in chat ↗
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); triggerAuto(); }}
                      title="Let the AI answer everything itself (best-of-N → ranked → picked)"
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10.5, fontWeight: 700, color: "#047857", fontFamily: appleVibe.font.stack }}
                    >
                      ⚡ Auto-build
                    </button>
                  </div>
                )}
              </div>
            )
          )
        )}

        {/* Footer row — open + on-demand FORK. Forking is deliberate (the
            subtraction killed the auto-decompose); the user pulls features out
            when they want them. */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => {
              e.stopPropagation();
              openObjective();
            }}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 600,
              color: appleVibe.text.faint,
              fontFamily: appleVibe.font.stack,
            }}
          >
            Press to open ↗
          </button>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={(e) => { e.stopPropagation(); setForkOpen((v) => !v); }}
              title="Fork into cards — features, principles, a plan, or a prototype"
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 700,
                color: "#2563EB",
                fontFamily: appleVibe.font.stack,
              }}
            >
              Fork into features ⑂
            </button>
            {forkOpen && (
              <div
                onPointerDown={stopEventPropagation}
                onClick={(e) => { e.stopPropagation(); setForkOpen(false); }}
                style={{ position: "fixed", inset: 0, zIndex: 29 }}
              />
            )}
            {forkOpen && (
              <div
                onPointerDown={stopEventPropagation}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  zIndex: 30,
                  width: 252,
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: 7,
                  borderRadius: 13,
                  background: "rgba(255,255,255,0.96)",
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(15,23,42,0.10)",
                  boxShadow: "0 18px 44px -16px rgba(11,18,40,0.40)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div style={forkHead}>Fork into cards</div>
                <button type="button" onClick={() => forkInto()} style={forkRow} title="Decompose the whole objective into Feature / Variable cards">
                  <span style={{ fontWeight: 700, color: "#2563EB" }}>The whole objective</span>
                  <span style={{ fontSize: 9.5, color: appleVibe.text.faint }}>features + variables</span>
                </button>
                {levers.length > 0 && (
                  <>
                    <div style={forkHead}>From a leverage point</div>
                    {levers.map((l, i) => (
                      <button key={l.slug ?? i} type="button" onClick={() => forkInto(l)} style={forkRow} title={l.rationale || `Fork from: ${l.label}`}>
                        <span style={{ fontWeight: 650, color: appleVibe.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
                        {typeof l.score === "number" && l.score > 0 && (
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: "#B45309", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{l.score}</span>
                        )}
                      </button>
                    ))}
                  </>
                )}
                <div style={{ height: 1, background: "rgba(15,23,42,0.06)", margin: "3px 4px" }} />
                <div style={forkHead}>Into other artifacts</div>
                <button type="button" onClick={() => forkAction("decompose")} style={forkRow} title="Unpack into first principles + variations (with causal links)">
                  <span style={{ fontWeight: 650, color: appleVibe.text.primary }}>Principles &amp; variations</span>
                  <span style={{ fontSize: 9.5, color: appleVibe.text.faint }}>unpack</span>
                </button>
                <button type="button" onClick={() => forkAction("make_plan")} style={forkRow} title="Turn the objective into an actionable plan">
                  <span style={{ fontWeight: 650, color: appleVibe.text.primary }}>An action plan</span>
                  <span style={{ fontSize: 9.5, color: appleVibe.text.faint }}>steps</span>
                </button>
                <button type="button" onClick={forkPrototypePlan} style={forkRow} title="Sketch UI-plan variants — each leads to a real prototype">
                  <span style={{ fontWeight: 650, color: appleVibe.text.primary }}>Prototype plans</span>
                  <span style={{ fontSize: 9.5, color: appleVibe.text.faint }}>UI → prototype</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => { e.stopPropagation(); openSeedIdeas(spaceId); }}
            title="Generate + score + rank a field of candidate ideas (income × traction × virality)"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 700,
              color: "#B45309",
              fontFamily: appleVibe.font.stack,
            }}
          >
            Rank my ideas ⚖
          </button>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={(e) => { e.stopPropagation(); openSeedMap(spaceId); }}
            title="Peek the reasoning engine behind the move (sandboxed)"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 700,
              color: appleVibe.text.tertiary,
              fontFamily: appleVibe.font.stack,
            }}
          >
            Reasoning map ⋯
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

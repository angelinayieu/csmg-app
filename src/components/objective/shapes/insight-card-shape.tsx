"use client";

// ── InsightCardShapeUtil ──
//
// The AI's contribution to the board: a "Connect" (relationship between
// two cards) or "Synthesize" (insight across 3+ cards) result. It lands
// as a PROPOSAL — dashed, with Keep / Dismiss — so the human always
// curates. Nothing the AI says is forced onto the board.
//
// Self-contained (no app context, no external event bus): the card owns
// its own accept/reject. Accepting flips status to "accepted" and
// solidifies its linked arrows; dismissing deletes the card AND the
// arrows that tether it to its sources (tagged via meta.proposalFor).
// This keeps the focused objective board free of the heavy canvas
// chrome the main InteraxisCanvas uses for the same lifecycle.

import { useLayoutEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { Check, X, Globe, HelpCircle } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  openResolutionStudio,
  refreshSharpening,
} from "@/components/objective/board-bus";
import { OPEN_CARD_DETAIL_EVENT } from "@/components/objective/canvas-interactions/object-detail-drawer";
import { slugifyConcept } from "@/lib/objective-canvas/normalize-annotations";
import {
  runAiResolve,
  type ResolveConcept,
} from "@/lib/objective-canvas/run-ai-resolve";
import { runDeepResolve } from "@/lib/objective-canvas/run-deep-resolve";
import { shapeToScanTarget } from "@/components/objective/canvas-interactions/shape-node-adapter";
import { Spark } from "@/components/objective/icons/spark";

/** A web source backing a Deep Synthesize node. */
export type InsightCitation = { title: string; url: string };

export type InsightCardShape = TLBaseShape<
  "insight-card",
  {
    w: number;
    h: number;
    /** proposed → ghost with Keep/Dismiss; accepted → solid, persisted. */
    status: "proposed" | "accepted";
    /** connect = relationship between 2; synthesize = insight across N. */
    kind: "connect" | "synthesize";
    /** single = standalone Connect/Synthesize result; hub + branch = the
     *  nodes of a Deep Synthesize map (hub carries the cascade Keep/Dismiss
     *  for the whole cluster, tagged via meta.mapId). */
    role: "single" | "hub" | "branch";
    headline: string;
    body: string;
    color: string;
    /** tldraw ids of the source cards this insight links to. */
    sourceIds: string[];
    /** web sources backing this node (Deep Synthesize); empty otherwise. */
    citations: InsightCitation[];
    /** Slug of the intake optimization factor this card advances. "general"
     *  means the model couldn't tie it to a specific factor → renders as a
     *  low-confidence chip. Empty string on legacy / Connect cards (the
     *  chip simply hides). */
    factorSlug: string;
    /** Display label for the factor chip ("Onboarding friction", "Retention",
     *  …). Stored alongside the slug so the chip renders without re-reading
     *  prompt_sharpening. Empty string hides the chip. */
    factorLabel: string;
    /** library_objects.id this card is backed by. Set on Deep Synthesize
     *  output (the route promotes hub+branches into the object layer); empty
     *  on legacy Connect/Synthesize cards. When set, a non-modifier click
     *  opens the object-detail drawer (full body + metadata + back-links),
     *  the same surface oc-cards use. */
    objectId: string;
    /** v2 — Focus-card micro-objective this card serves (PRIMARY trace-back).
     *  Slug from the focus card's micros[]. When present, the micro chip
     *  REPLACES the factor chip as the eyebrow tag — micros are the local
     *  rubric, factors are the global weighting (and ladder under the micro
     *  via `laddersToFactorSlugs`). Empty on legacy + v1-frame synth output. */
    microSlug: string;
    /** v2 — Display label for the micro chip ("Signal density", …). Empty
     *  hides the chip → falls through to the factor chip if present. */
    microLabel: string;
    /** v2 — Factor slugs the micro ladders into (zero or more). Render as a
     *  small ghost subchip below the micro chip, "→ time-to-value". Empty
     *  array hides the subchip entirely. */
    laddersToFactorSlugs: string[];
    /** v2 — Display labels parallel to laddersToFactorSlugs. */
    laddersToFactorLabels: string[];
    /** v2 — The mechanism the cross-link rests on, ≤ 12 words. Italic line
     *  ABOVE the body. Lets the user read "what's the rule" separate from
     *  "what's the so-what". Empty hides the line. */
    principle: string;
    /** v2 — 0..1 model confidence the link is real for the focus card.
     *  Low (< 0.55) renders the card at reduced opacity so the user can
     *  visually skim the high-confidence ones first. -1 = unset (legacy). */
    confidence: number;
    /** v2 — tldraw shape id of the focus card the synth was framed around.
     *  Lets a click on the card's "Focus: …" eyebrow chip jump back to the
     *  source. Empty on v1-frame output. */
    focusCardId: string;
  }
>;

// Props migration — `role` + `citations` were added after insight-card
// shapes were already persisted in canvases.snapshot. Without this, tldraw
// validation rejects older shapes on load. Defaults keep legacy Connect/
// Synthesize cards behaving exactly as before.
const Versions = createShapePropsMigrationIds("insight-card", {
  addRoleAndCitations: 1,
  addFactorTraceback: 2,
  addObjectId: 3,
  addMicroTraceback: 4,
});

export const insightCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.addRoleAndCitations,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.role === undefined) p.role = "single";
        if (p.citations === undefined) p.citations = [];
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.role;
        delete p.citations;
      },
    },
    {
      id: Versions.addFactorTraceback,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.factorSlug === undefined) p.factorSlug = "";
        if (p.factorLabel === undefined) p.factorLabel = "";
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.factorSlug;
        delete p.factorLabel;
      },
    },
    {
      id: Versions.addObjectId,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.objectId === undefined) p.objectId = "";
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.objectId;
      },
    },
    {
      // v2 frame — micro-objectives + principle + confidence + focus-card
      // back-link. Defaults keep v1-frame and legacy cards rendering
      // identically (microLabel = "" hides the chip; confidence -1 means
      // unset = no opacity treatment; arrays default to []).
      id: Versions.addMicroTraceback,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.microSlug === undefined) p.microSlug = "";
        if (p.microLabel === undefined) p.microLabel = "";
        if (p.laddersToFactorSlugs === undefined) p.laddersToFactorSlugs = [];
        if (p.laddersToFactorLabels === undefined) p.laddersToFactorLabels = [];
        if (p.principle === undefined) p.principle = "";
        if (p.confidence === undefined) p.confidence = -1;
        if (p.focusCardId === undefined) p.focusCardId = "";
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.microSlug;
        delete p.microLabel;
        delete p.laddersToFactorSlugs;
        delete p.laddersToFactorLabels;
        delete p.principle;
        delete p.confidence;
        delete p.focusCardId;
      },
    },
  ],
});

export class InsightCardShapeUtil extends BaseBoxShapeUtil<InsightCardShape> {
  static override type = "insight-card" as const;
  static override props: RecordProps<InsightCardShape> = {
    w: T.number,
    h: T.number,
    status: T.literalEnum("proposed", "accepted"),
    kind: T.literalEnum("connect", "synthesize"),
    role: T.literalEnum("single", "hub", "branch"),
    headline: T.string,
    body: T.string,
    color: T.string,
    sourceIds: T.arrayOf(T.string),
    citations: T.arrayOf(T.object({ title: T.string, url: T.string })),
    factorSlug: T.string,
    factorLabel: T.string,
    objectId: T.string,
    microSlug: T.string,
    microLabel: T.string,
    laddersToFactorSlugs: T.arrayOf(T.string),
    laddersToFactorLabels: T.arrayOf(T.string),
    principle: T.string,
    confidence: T.number,
    focusCardId: T.string,
  };

  static override migrations = insightCardMigrations;

  // Auto-sized to content (full headline always shows) — no manual resize.
  override canResize = () => false;
  override canEdit = () => false;

  // Non-modifier click → open the object-detail drawer (full body + metadata
  // + back-link graph). Mirrors oc-card's onClick: modifier-clicks fall
  // through so multi-select still works for re-converging / re-synthesizing.
  // Only fires when this card is backed by a library_objects row (Deep
  // Synthesize output); legacy Connect cards have no objectId, so click is
  // a no-op — the Keep/Dismiss buttons inside the card remain the affordance.
  override onClick = (shape: InsightCardShape) => {
    const i = this.editor.inputs;
    if (i.shiftKey || i.ctrlKey || i.altKey || i.metaKey) return;
    if (!shape.props.objectId) return;
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(OPEN_CARD_DETAIL_EVENT, {
        detail: {
          objectId: shape.props.objectId,
          shapeId: shape.id,
          name: shape.props.headline,
        },
      }),
    );
  };

  getDefaultProps(): InsightCardShape["props"] {
    return {
      w: 252,
      h: 168,
      status: "proposed",
      kind: "connect",
      role: "single",
      headline: "",
      body: "",
      color: "#475569",
      sourceIds: [],
      citations: [],
      factorSlug: "",
      factorLabel: "",
      objectId: "",
      microSlug: "",
      microLabel: "",
      laddersToFactorSlugs: [],
      laddersToFactorLabels: [],
      principle: "",
      confidence: -1,
      focusCardId: "",
    };
  }

  component(shape: InsightCardShape) {
    return <InsightCardRenderer shape={shape} util={this} />;
  }

  indicator(shape: InsightCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

/** Human-readable source label for a citation chip (bare host, no www.). */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return (url || "source").slice(0, 28);
  }
}

function InsightCardRenderer({
  shape,
  util,
}: {
  shape: InsightCardShape;
  util: InsightCardShapeUtil;
}) {
  const {
    status,
    kind,
    role,
    headline,
    body,
    color,
    citations,
    factorSlug,
    factorLabel,
    microSlug,
    microLabel,
    laddersToFactorLabels,
    principle,
    confidence,
  } = shape.props;
  // v2 chip routing:
  //   - microLabel present → primary chip is the MICRO (local rubric); the
  //     ladder factors render as a tiny ghost subchip ("→ Retention").
  //   - microLabel absent → fall back to the v1 factor chip (single-tier),
  //     preserving the parallel session's render for v1-frame output.
  // Low confidence (< 0.55, but only when set: confidence > -1) fades the
  // whole card so a quick scan separates load-bearing from speculative.
  const hasMicro = !!microLabel;
  const showLowConfidence = confidence >= 0 && confidence < 0.55;
  const primaryChipLabel = hasMicro ? microLabel : factorLabel;
  const primaryChipIsLowConfidence = hasMicro
    ? microSlug === ""
    : factorSlug === "general";
  const editor = util.editor;
  const proposed = status === "proposed";
  const isHub = role === "hub";
  const isBranch = role === "branch";
  const ref = useRef<HTMLDivElement>(null);

  // Auto-grow the card to fit the full headline + body (no cropping). Guard on
  // a >1px delta so it converges; re-measures on content/width (not on h).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const needed = Math.ceil(el.offsetHeight);
    if (needed > 0 && Math.abs(needed - shape.props.h) > 1) {
      editor.updateShape<InsightCardShape>({
        id: shape.id,
        type: "insight-card",
        props: { h: needed },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape.props.w, headline, body, citations.length, proposed]);

  /** Arrows tethering THIS insight to its sources (single-card lifecycle). */
  function linkedArrowIds(): TLShapeId[] {
    return editor
      .getCurrentPageShapes()
      .filter(
        (s) =>
          s.type === "arrow" &&
          (s.meta as { proposalFor?: string })?.proposalFor === shape.id,
      )
      .map((s) => s.id);
  }

  /** Every node + arrow belonging to this Deep Synthesize map — the hub
   *  curates the whole cluster as one decision (tagged via meta.mapId, and
   *  the hub is tagged with its own id so it's included). */
  function mapMemberShapes(): TLShape[] {
    const members = editor
      .getCurrentPageShapes()
      .filter((s) => (s.meta as { mapId?: string })?.mapId === shape.id);
    return members.some((s) => s.id === shape.id)
      ? members
      : [...members, shape as TLShape];
  }

  function keep(e: React.MouseEvent) {
    e.stopPropagation();
    if (isHub) {
      // Accept the entire map: every node → accepted, every arrow → solid.
      editor.updateShapes(
        mapMemberShapes().map((s) =>
          s.type === "arrow"
            ? {
                id: s.id,
                type: "arrow",
                props: { dash: "solid", color: "grey" },
              }
            : { id: s.id, type: "insight-card", props: { status: "accepted" } },
        ),
      );
      return;
    }
    editor.updateShape<InsightCardShape>({
      id: shape.id,
      type: "insight-card",
      props: { status: "accepted" },
    });
    // Solidify the tethers so an accepted insight reads as "real".
    for (const id of linkedArrowIds()) {
      editor.updateShape({
        id,
        type: "arrow",
        props: { dash: "solid", color: "grey" },
      });
    }
  }

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    if (isHub) {
      editor.deleteShapes(mapMemberShapes().map((s) => s.id));
      return;
    }
    editor.deleteShapes([shape.id, ...linkedArrowIds()]);
  }

  // ── Ambiguity-fork resolve (closes the fork → answer → glossary loop) ──
  // A forked ambiguity card (meta.ambiguityFork) is `accepted`, so it carries
  // no Keep/Dismiss. Instead it gets a Resolve action that opens the existing
  // Resolution Studio scoped to THIS ambiguity — the answer then flows the
  // proven studio → resolutions → apply-resolutions → pinned-glossary path.
  const forkMeta = shape.meta as { ambiguityFork?: boolean; spaceId?: string };
  const isFork = !!forkMeta.ambiguityFork;
  const [busy, setBusy] = useState<null | "one" | "all">(null);

  function resolveFork(e: React.MouseEvent) {
    e.stopPropagation();
    const sid = forkMeta.spaceId;
    if (!sid) return;
    openResolutionStudio({
      spaceId: sid,
      concepts: [
        {
          phrase: headline,
          kind: "concept",
          // forked because it matters AND is unclear — seed the studio high.
          leverage: 0.7,
          uncertainty: 0.7,
          why: body,
          candidate_readings: [],
          concept_slug: slugifyConcept(headline),
        },
      ],
    });
  }

  // This forked ambiguity as a resolve concept (mirrors resolveFork's seed).
  const thisConcept: ResolveConcept = {
    phrase: headline,
    kind: "concept",
    leverage: 0.7,
    uncertainty: 0.7,
    why: body,
    candidate_readings: [],
    concept_slug: slugifyConcept(headline),
  };

  // Headless AI resolve → re-frame → decompose into Feature/Variable cards.
  // Reuses the shared orchestrator (auto-resolve → resolutions → apply) + the
  // existing decompose event — the proven pipeline, scoped here to one or all
  // ambiguities. Recursive diverge/converge depth is a later enhancement.
  // Apply a resolve result: refresh the card + (only if the planner says so)
  // decompose into Feature/Variable cards. Shared by both resolve paths.
  // Only sprays cards when the planner flags it (a goal/pain/lever); a pure
  // term/definition resolves into a glossary meaning, no card spray (picky board).
  function postResolve(
    sid: string,
    res: { sharpenedPrompt?: string; shouldDecompose?: boolean } | null,
  ) {
    refreshSharpening(sid);
    if (res?.shouldDecompose) {
      window.dispatchEvent(
        new CustomEvent("objective-board:decompose-into-cards", {
          detail: res.sharpenedPrompt
            ? { objective: res.sharpenedPrompt }
            : undefined,
        }),
      );
    }
  }

  // Board cards for the board-aware emergent self-question pass.
  function boardCardsForEmergent(): { id: string; text: string }[] {
    try {
      const out: { id: string; text: string }[] = [];
      for (const s of editor.getCurrentPageShapes()) {
        const t = shapeToScanTarget(s);
        if (t?.shapeId && t.text?.trim()) out.push({ id: t.shapeId, text: t.text });
      }
      return out;
    } catch {
      return [];
    }
  }

  // "Resolve all" — one broad pass over the given concepts.
  async function finishResolve(sid: string, concepts: ResolveConcept[]) {
    postResolve(sid, await runAiResolve(sid, concepts));
  }

  // "AI resolve" (this one) — the BOUNDED recursive agent: resolve → let new
  // sub-questions emerge → resolve those → … (hard round cap), mapping this
  // branch's full landscape rather than stopping after a single pass.
  function aiResolveOne(e: React.MouseEvent) {
    e.stopPropagation();
    const sid = forkMeta.spaceId;
    if (!sid || busy) return;
    setBusy("one");
    void (async () => {
      const res = await runDeepResolve(sid, [thisConcept], boardCardsForEmergent());
      postResolve(sid, res);
    })().finally(() => setBusy(null));
  }

  async function aiResolveAll(e: React.MouseEvent) {
    e.stopPropagation();
    const sid = forkMeta.spaceId;
    if (!sid || busy) return;
    setBusy("all");
    // Pull every salient ambiguity so "Resolve all" covers the whole map; fall
    // back to just this one if the fetch fails.
    let concepts: ResolveConcept[] = [thisConcept];
    try {
      const r = await fetch(`/api/objective/${sid}/prompt-sharpening`, {
        cache: "no-store",
      });
      if (r.ok) {
        const j = (await r.json()) as {
          artifact?: {
            salience?: {
              annotations?: Array<{
                phrase?: string;
                kind?: string;
                why?: string;
                candidate_readings?: string[];
                concept_slug?: string;
              }>;
            };
          };
        };
        const anns = j.artifact?.salience?.annotations;
        if (Array.isArray(anns) && anns.length) {
          concepts = anns
            .filter((a) => typeof a.phrase === "string" && a.phrase.trim())
            .map((a) => ({
              phrase: a.phrase as string,
              kind: a.kind || "concept",
              why: a.why,
              candidate_readings: a.candidate_readings || [],
              concept_slug: a.concept_slug,
            }));
        }
      }
    } catch {
      /* fall back to the single concept */
    }
    await finishResolve(sid, concepts).finally(() => setBusy(null));
  }

  const quietAction: React.CSSProperties = {
    border: "none",
    background: "transparent",
    cursor: busy ? "default" : "pointer",
    padding: 0,
    fontSize: 11.5,
    fontWeight: 600,
    color: appleVibe.text.secondary,
    fontFamily: appleVibe.font.stack,
    opacity: busy ? 0.5 : 1,
  };

  const eyebrow = isHub
    ? "Synthesis map"
    : isBranch
      ? "Cross-link"
      : kind === "connect"
        ? "Connection"
        : "Synthesis";

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      <div
        ref={ref}
        style={{
          position: "relative",
          width: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(249,247,255,0.97) 100%)",
          border: proposed
            ? `1.5px dashed ${color}80`
            : `1px solid ${color}40`,
          boxShadow: proposed
            ? `0 1px 2px rgba(11,18,40,0.04), 0 14px 38px -16px ${color}40`
            : `0 1px 2px rgba(11,18,40,0.05), 0 18px 48px -16px ${color}55, 0 8px 22px -10px rgba(11,18,40,0.16)`,
          padding: "14px 15px 12px",
          display: "flex",
          flexDirection: "column",
          // v2: low-confidence branches fade so a quick scan separates
          // load-bearing links from speculative ones. Stacks with the
          // proposed-state opacity (multiplicative-ish via min).
          opacity: showLowConfidence
            ? proposed
              ? 0.7
              : 0.75
            : proposed
              ? 0.97
              : 1,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* Eyebrow — the AI provenance tag + (when present) the optimization-
            factor chip. The chip is the trace-back to the seed objective: it
            tells the user which intake-defined factor this insight advances,
            so a synth card never reads as a free-floating generality. A
            "general" slug means the model couldn't pin it down — render at
            reduced opacity so low-confidence reads as such at a glance. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Sparkle style={{ width: 12, height: 12, color }} strokeWidth={2.4} />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color,
            }}
          >
            {eyebrow}
          </span>
          {/* v2: PRIMARY chip = micro label (focus-card local rubric) when
              present, else falls back to the v1 factor label. The micro chip
              reads as "Signal density" — instantly tied to the focus card —
              instead of an abstract intake factor like "Retention". */}
          {primaryChipLabel && (
            <span
              title={
                hasMicro
                  ? `Addresses micro-objective: ${primaryChipLabel}`
                  : primaryChipIsLowConfidence
                    ? "No specific intake factor — low confidence"
                    : `Addresses factor: ${primaryChipLabel}`
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "1px 6px",
                borderRadius: 999,
                border: `1px solid ${color}30`,
                background: `${color}10`,
                color: appleVibe.text.secondary,
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.01em",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                opacity: primaryChipIsLowConfidence ? 0.55 : 1,
              }}
            >
              {primaryChipLabel}
            </span>
          )}
          {proposed && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: appleVibe.text.tertiary,
              }}
            >
              Proposed
            </span>
          )}
        </div>

        {/* v2: ghost ladder subchip — "→ Retention · Time-to-value". Tells
            the user which global optimization factors the focus-card micro
            ladders into, without consuming a full chip row. Only shown when
            the primary chip IS a micro (the v1 single-tier factor chip
            already IS the global factor). */}
        {hasMicro && laddersToFactorLabels.length > 0 && (
          <div
            style={{
              marginTop: 4,
              marginLeft: 17, // align under the eyebrow text, past the sparkle
              fontSize: 9.5,
              fontWeight: 500,
              color: appleVibe.text.tertiary,
              letterSpacing: "0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={`Ladders to: ${laddersToFactorLabels.join(", ")}`}
          >
            → {laddersToFactorLabels.slice(0, 3).join(" · ")}
          </div>
        )}

        {/* Headline — the relationship / insight, lead element. */}
        <div
          style={{
            marginTop: 10,
            fontSize: kind === "connect" ? 17 : 15.5,
            fontWeight: 650,
            lineHeight: 1.2,
            color: appleVibe.text.primary,
            overflowWrap: "anywhere",
          }}
        >
          {headline}
        </div>

        {/* v2: principle — the mechanism the cross-link rests on, ≤ 12
            words. Italic line above the body so the user reads "what's the
            rule" separate from "what's the so-what". Only on v2-frame
            output; v1 + legacy + Connect cards leave it empty. */}
        {principle && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              fontWeight: 500,
              fontStyle: "italic",
              lineHeight: 1.35,
              color: appleVibe.text.tertiary,
              overflowWrap: "anywhere",
            }}
          >
            {principle}
          </div>
        )}

        {/* Body — the "why" / the "so what". No clamp: the card auto-grows
            (useLayoutEffect above) so the full thought is always readable;
            silent mid-sentence truncation was the biggest "what does this
            even say" complaint on Deep Synthesize output. */}
        {body && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 450,
              lineHeight: 1.42,
              color: appleVibe.text.secondary,
              overflowWrap: "anywhere",
            }}
          >
            {body}
          </div>
        )}

        {/* Citation chips — the web sources backing a Deep Synthesize node.
            Clickable; the source stays attached to the claim it supports. */}
        {citations.length > 0 && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexWrap: "wrap",
              gap: 5,
            }}
          >
            {citations.slice(0, 3).map((c, i) => (
              <button
                key={i}
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={(e) => {
                  e.stopPropagation();
                  if (c.url)
                    window.open(c.url, "_blank", "noopener,noreferrer");
                }}
                title={c.title || c.url}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: "100%",
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: `1px solid ${color}30`,
                  background: `${color}0F`,
                  color: appleVibe.text.secondary,
                  fontSize: 10,
                  fontWeight: 550,
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                <Globe
                  style={{ width: 10, height: 10, color, flexShrink: 0 }}
                  strokeWidth={2.2}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {domainOf(c.url)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Footer: Keep / Dismiss while proposed; branches are curated via
            the hub, so they carry no buttons of their own. */}
        {proposed && !isBranch && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 7,
            }}
          >
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={keep}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: color,
                color: "white",
                fontSize: 11.5,
                fontWeight: 600,
                boxShadow: `0 4px 12px -3px ${color}88`,
              }}
            >
              <Check style={{ width: 12, height: 12 }} strokeWidth={3} />
              {isHub ? "Keep all" : "Keep"}
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={dismiss}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid rgba(15,23,42,0.12)",
                cursor: "pointer",
                background: "rgba(255,255,255,0.6)",
                color: "rgba(15,23,42,0.55)",
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              <X style={{ width: 12, height: 12 }} strokeWidth={2.6} />
              Dismiss
            </button>
          </div>
        )}

        {/* Forked ambiguity → Resolve: opens the studio scoped to THIS one,
            turning a visual-only fork into the entry point for capturing taste. */}
        {isFork && forkMeta.spaceId && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {/* The 3-mode resolve choice: AI resolve (this one, headless) ·
                Resolve all (every ambiguity) · Answer (the Studio). */}
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={aiResolveOne}
              disabled={!!busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 13px",
                borderRadius: 999,
                border: "none",
                cursor: busy ? "default" : "pointer",
                background: color,
                color: "white",
                fontSize: 11.5,
                fontWeight: 600,
                boxShadow: `0 4px 12px -3px ${color}88`,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Spark style={{ width: 12, height: 12 }} strokeWidth={2.6} />
              {busy === "one" ? "Resolving…" : "AI resolve"}
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={aiResolveAll}
              disabled={!!busy}
              style={quietAction}
            >
              {busy === "all" ? "Resolving all…" : "Resolve all"}
            </button>
            <button
              type="button"
              onPointerDown={stopEventPropagation}
              onClick={resolveFork}
              disabled={!!busy}
              style={quietAction}
            >
              Answer
            </button>
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

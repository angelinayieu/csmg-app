"use client";

// ── ResolvePillShapeUtil ───────────────────────────────────────────────
//
// The MERGED "AI resolve" action, lifted OFF the sharpening card into its own
// persistent on-board pill that sits BELOW the ambiguity heatmap + priority map
// — the convergence point of the two-way fork. Both forked cards wire a REAL
// flow-connector down into this pill (a downward "root" that merges), so there
// is ONE resolve action for the whole ambiguity set, not a per-card duplicate
// (the two cards are two views of the SAME salience).
//
// Pressing it runs the DEEP resolver (runDeepResolve): resolve → self-question
// the board for newly-exposed ambiguities → chase the high-leverage ones →
// repeat (bounded). It refreshes the goal rail per round so the exploration is
// visible as it happens, then fires the decomposition. Reuses the headless
// orchestration + the existing routes — no fork.

import { useCallback, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLShapeId,
  type Editor,
} from "tldraw";
import { Sparkles, Loader2, Check } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  runDeepResolve,
  type DeepResolveResult,
} from "@/lib/objective-canvas/run-deep-resolve";
import type { ResolveConcept } from "@/lib/objective-canvas/run-ai-resolve";
import { shapeToScanTarget } from "@/components/objective/canvas-interactions/shape-node-adapter";
import {
  refreshSharpening,
  emitAiAutoResolveStarted,
  emitAiAutoResolveEnded,
} from "@/components/objective/board-bus";
import { DECOMPOSE_INTO_CARDS_EVENT } from "@/components/objective/canvas-interactions/deploy-oc-cards";
import { SHARPEN_COLOR, ZONE_LABEL } from "./prompt-sharpening-card-shape";

const PILL_W = 220;
const PILL_H = 64;

// Guard so a single press can't kick off two concurrent deep-resolves — and so
// the "running" look survives a tldraw cull/remount during the long run.
const inFlight = new Set<string>();

interface SalienceItem {
  phrase: string;
  kind: string;
  leverage: number;
  uncertainty: number;
  why?: string;
  candidate_readings?: string[];
}

export type ResolvePillShape = TLBaseShape<
  "resolve-pill",
  {
    w: number;
    h: number;
    spaceId: string;
    /** Comma-joined ids of the heatmap + priority cards that feed this pill —
     *  for connector wiring + reading the live salience to resolve. */
    sourceIds: string;
    color: string;
  }
>;

export class ResolvePillShapeUtil extends BaseBoxShapeUtil<ResolvePillShape> {
  static override type = "resolve-pill" as const;
  static override props: RecordProps<ResolvePillShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    sourceIds: T.string,
    color: T.string,
  };

  override canResize = () => false;
  override canEdit = () => false;

  getDefaultProps(): ResolvePillShape["props"] {
    return { w: PILL_W, h: PILL_H, spaceId: "", sourceIds: "", color: SHARPEN_COLOR };
  }

  component(shape: ResolvePillShape) {
    return <ResolvePillRenderer shape={shape} util={this} />;
  }

  indicator(shape: ResolvePillShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={shape.props.h / 2}
        ry={shape.props.h / 2}
      />
    );
  }
}

/** Coarse concepts from the ambiguity heatmap — so the pill can resolve the
 *  moment the heatmap is out, BEFORE the priority map's richer salience lands. */
function heatmapToItems(json: string): SalienceItem[] {
  let h: Record<
    string,
    { severity?: string; ambiguity?: string; question_to_resolve?: string }
  > = {};
  try {
    const v = JSON.parse(json || "{}");
    if (v && typeof v === "object") h = v;
  } catch {
    return [];
  }
  const sevU: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.4 };
  return Object.entries(h)
    .filter(([, z]) => z && (z.ambiguity || z.question_to_resolve))
    .map(([key, z]) => ({
      phrase: (z.ambiguity || ZONE_LABEL[key] || key).trim(),
      kind: "concept",
      leverage: 0.7,
      uncertainty: sevU[(z.severity as string) ?? "low"] ?? 0.5,
      why: z.question_to_resolve || "",
      candidate_readings: [],
    }));
}

/** The live ambiguities to resolve. Prefer the priority-map card's salience
 *  (richer — candidate readings + micro-questions); fall back to the heatmap
 *  zones so the pill works while the priority map is still generating. */
function readSalience(editor: Editor, sourceIds: string): SalienceItem[] {
  const ids = sourceIds.split(",").filter(Boolean);
  for (const id of ids) {
    const s = editor.getShape(id as TLShapeId);
    if (s?.type === "priority-map-card") {
      try {
        const v = JSON.parse(
          (s.props as { salienceJson?: string }).salienceJson || "[]",
        );
        if (Array.isArray(v) && v.length) return v as SalienceItem[];
      } catch {
        /* fall through to heatmap */
      }
    }
  }
  for (const id of ids) {
    const s = editor.getShape(id as TLShapeId);
    if (s?.type === "ambiguity-heatmap-card") {
      const items = heatmapToItems(
        (s.props as { heatmapJson?: string }).heatmapJson || "{}",
      );
      if (items.length) return items;
    }
  }
  return [];
}

/** Snapshot the board's content cards (id + text) for the emergent self-question
 *  pass — "what new ambiguities did the current board expose?". */
function enumerateBoardCards(editor: Editor): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  try {
    for (const s of editor.getCurrentPageShapes()) {
      const t = shapeToScanTarget(s);
      if (t?.shapeId && t.text?.trim() && !seen.has(t.shapeId)) {
        seen.add(t.shapeId);
        out.push({ id: t.shapeId, text: t.text });
      }
    }
  } catch {
    /* best-effort */
  }
  return out;
}

function ResolvePillRenderer({
  shape,
  util,
}: {
  shape: ResolvePillShape;
  util: ResolvePillShapeUtil;
}) {
  const editor = util.editor;
  const { spaceId, sourceIds } = shape.props;
  const [phase, setPhase] = useState<"idle" | "running" | "done">(
    inFlight.has(spaceId) ? "running" : "idle",
  );
  const [progress, setProgress] = useState("");
  const [hovered, setHovered] = useState(false);

  const onResolve = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!spaceId || inFlight.has(spaceId)) return;
      const salience = readSalience(editor, sourceIds);
      if (!salience.length) return;
      const concepts: ResolveConcept[] = salience.map((s) => ({
        phrase: s.phrase,
        kind: s.kind,
        why: s.why,
        leverage: s.leverage,
        uncertainty: s.uncertainty,
        candidate_readings: s.candidate_readings || [],
      }));
      const boardCards = enumerateBoardCards(editor);

      inFlight.add(spaceId);
      setPhase("running");
      setProgress("Reading the board…");
      emitAiAutoResolveStarted({
        spaceId,
        trigger: "card",
        conceptCount: concepts.length,
      });

      let res: DeepResolveResult | null = null;
      try {
        res = await runDeepResolve(spaceId, concepts, boardCards, {
          onRound: ({ round, fresh }) => {
            // Repaint the rail each round so the agent's work is visible live.
            refreshSharpening(spaceId);
            setProgress(
              fresh > 0
                ? `Round ${round} · ${fresh} new question${fresh === 1 ? "" : "s"}`
                : `Round ${round} · converging…`,
            );
          },
        });
      } catch {
        /* soft-fail — show idle again below */
      }

      emitAiAutoResolveEnded({
        spaceId,
        trigger: "card",
        resolvedCount: res ? concepts.length : 0,
        reviewCount: 0,
        ok: !!res,
      });
      refreshSharpening(spaceId);
      if (res?.shouldDecompose) {
        window.dispatchEvent(
          new CustomEvent(DECOMPOSE_INTO_CARDS_EVENT, {
            detail: res.sharpenedPrompt
              ? { objective: res.sharpenedPrompt }
              : undefined,
          }),
        );
      }

      inFlight.delete(spaceId);
      if (res) {
        setPhase("done");
        setProgress(`Explored ${res.rounds} round${res.rounds === 1 ? "" : "s"}`);
        window.setTimeout(() => setPhase("idle"), 3400);
      } else {
        setPhase("idle");
        setProgress("");
      }
    },
    [editor, spaceId, sourceIds],
  );

  const running = phase === "running";
  const done = phase === "done";
  const bg = done
    ? "linear-gradient(135deg, #10B981 0%, #059669 100%)"
    : "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)";
  const glow = done ? "rgba(16,185,129,0.5)" : "rgba(99,102,241,0.5)";
  const lift = hovered && !running ? 1 : 0;

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <style>{`@keyframes rp-breathe{0%,100%{box-shadow:0 6px 18px -6px ${glow},0 2px 6px rgba(11,18,40,0.16)}50%{box-shadow:0 12px 30px -6px ${glow},0 2px 6px rgba(11,18,40,0.16)}}`}</style>
      <button
        type="button"
        onPointerDown={stopEventPropagation}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onResolve}
        disabled={running}
        title="Resolve every ambiguity — runs the deep resolver, then decomposes"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          padding: "0 22px",
          height: 46,
          borderRadius: 999,
          border: "none",
          background: bg,
          color: "#FFFFFF",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          cursor: running ? "default" : "pointer",
          transform: `translateY(${-lift}px)`,
          transition: "transform 140ms ease, box-shadow 140ms ease",
          boxShadow: running
            ? `0 6px 18px -6px ${glow}, 0 2px 6px rgba(11,18,40,0.16)`
            : `0 ${8 + lift * 4}px ${24 + lift * 6}px -6px ${glow}, 0 2px 6px rgba(11,18,40,0.16)`,
          animation: running || done ? "none" : "rp-breathe 3.4s ease-in-out infinite",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {running ? (
          <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" strokeWidth={2.6} />
        ) : done ? (
          <Check style={{ width: 16, height: 16 }} strokeWidth={3} />
        ) : (
          <Sparkles style={{ width: 16, height: 16 }} strokeWidth={2.5} />
        )}
        {running ? "Resolving…" : done ? "Resolved" : "AI resolve"}
      </button>
      {(running || done) && progress ? (
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 500,
            color: appleVibe.text.tertiary,
            maxWidth: shape.props.w - 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {progress}
        </div>
      ) : null}
    </HTMLContainer>
  );
}

"use client";

// ── Preflight: SYSTEMS decompose layout ─────────────────────────────
//
// The remake of the decompose output. SAME Feature/Variable oc-cards, but
// instead of "features in a left column, variables in a right column, joined
// by undirected crossing dashes", they're laid out as a swimlane × causal-
// layer dependency graph (see layout-systems-graph):
//
//   • subsystems = horizontal swimlanes (structure)
//   • causal depth = left→right columns (dependency flow)
//   • directed arrows = produces / drives / contributes (with arrowheads)
//   • the Objective = the right-most sink everything converges on
//
// Minimal, clean, direct. Public route, no auth/data — SAFE TO DELETE.

import {
  Tldraw,
  type Editor,
  createShapeId,
  toRichText,
  type TLShapeId,
  type TLArrowShape,
  type TLShapePartial,
} from "tldraw";
import "tldraw/tldraw.css";
import { useCallback } from "react";
import {
  OcCardShapeUtil,
  type OcCardShape,
  type OcCardKind,
} from "@/components/objective/shapes/oc-card-shape";
import {
  ObjectiveCardShapeUtil,
  type ObjectiveCardShape,
} from "@/components/objective/shapes/objective-card-shape";
import { layoutSystemsGraph } from "@/lib/objective-canvas/layout-systems-graph";

const UTILS = [OcCardShapeUtil, ObjectiveCardShapeUtil];

const CARD_W = 248;
const CARD_H = 176;
const OBJ_W = 300;
const OBJ_H = 168;

// ── Sample decompose output (the AI-debate app from the user's screenshot),
//    enriched with the two things the old output lacked: a SUBSYSTEM per card
//    and a DIRECTION per link. ──
interface SampleCard {
  id: string;
  kind: OcCardKind;
  name: string;
  body: string;
  subsystem: string;
}

const CARDS: SampleCard[] = [
  // Debate core
  {
    id: "f1",
    kind: "feature",
    name: "AI Debate Interface",
    body: "Structured, real-time debates with an AI across a wide range of topics, with live feedback.",
    subsystem: "Debate core",
  },
  {
    id: "f2",
    kind: "feature",
    name: "Debate Matchmaking",
    body: "Pairs users by interest and skill for human-to-human debates.",
    subsystem: "Debate core",
  },
  {
    id: "v1",
    kind: "variable",
    name: "Debate Skill Level",
    body: "A user's proficiency in argumentation, rebuttal, and critical thinking.",
    subsystem: "Debate core",
  },
  {
    id: "v2",
    kind: "variable",
    name: "Topic Coverage",
    body: "The range of subjects and issues the app supports for debates.",
    subsystem: "Debate core",
  },
  // Growth & insight
  {
    id: "f4",
    kind: "feature",
    name: "Knowledge Resource Library",
    body: "Curated articles, papers, and videos to help users prepare for debates.",
    subsystem: "Growth & insight",
  },
  {
    id: "f3",
    kind: "feature",
    name: "Progress Tracking Dashboard",
    body: "Shows skill growth over time, highlighting strengths and gaps.",
    subsystem: "Growth & insight",
  },
  {
    id: "v3",
    kind: "variable",
    name: "User Engagement",
    body: "How actively users participate in debates and other app features.",
    subsystem: "Growth & insight",
  },
  // Collaboration
  {
    id: "f5",
    kind: "feature",
    name: "Collaborative Project Platform",
    body: "Lets users form teams and work on projects addressing complex issues.",
    subsystem: "Collaboration",
  },
  {
    id: "v4",
    kind: "variable",
    name: "Project Collaboration Rate",
    body: "The frequency and success of users teaming up within the app.",
    subsystem: "Collaboration",
  },
];

// Directed dependencies between cards (from → drives/feeds → to).
const LINKS: { from: string; to: string }[] = [
  { from: "f1", to: "v1" }, // AI Debate Interface drives Skill Level
  { from: "f2", to: "v2" }, // Matchmaking drives Topic Coverage
  { from: "f4", to: "v2" }, // Knowledge Library drives Topic Coverage
  { from: "v1", to: "f3" }, // Dashboard reads Skill Level
  { from: "f3", to: "v3" }, // Dashboard drives Engagement
  { from: "v1", to: "v3" }, // Skill Level feeds Engagement
  { from: "v2", to: "v3" }, // Topic Coverage feeds Engagement
  { from: "f5", to: "v4" }, // Platform drives Collaboration Rate
  { from: "v4", to: "v3" }, // Collaboration Rate feeds Engagement
];

// Variables that contribute to the objective (the sink).
const OBJ_FROM = ["v3", "v4"];

const OBJECTIVE = {
  title: "AI debate & collaboration app",
  text: "Help people sharpen reasoning through AI + peer debate, and channel it into real collaborative projects.",
};

function build(editor: Editor) {
  // Idempotent — React StrictMode + HMR can fire onMount twice on the same
  // editor; bail if the board is already populated so shapes don't double.
  if (editor.getCurrentPageShapes().length > 0) return;

  const layout = layoutSystemsGraph(
    CARDS.map((c) => ({ id: c.id, subsystem: c.subsystem })),
    LINKS,
    { cardW: CARD_W, cardH: CARD_H, startX: 0, startY: 0 },
  );

  const shapeIdByCard = new Map<string, TLShapeId>();

  // ── Swimlane labels — quiet, top-left of each lane (no boxes; whitespace
  //    + a soft label keep it minimal while making the grouping legible). ──
  for (const lane of layout.lanes) {
    editor.createShape({
      id: createShapeId(),
      type: "text",
      x: -8,
      y: lane.top - 34,
      props: {
        richText: toRichText(lane.subsystem),
        size: "s",
        color: "grey",
        font: "sans",
        textAlign: "start",
        autoSize: true,
        scale: 1,
      },
      meta: { sysLaneLabel: true },
    });
  }

  // ── Feature / Variable oc-cards at their swimlane × layer position. ──
  for (const c of CARDS) {
    const p = layout.pos.get(c.id);
    if (!p) continue;
    const id = createShapeId();
    shapeIdByCard.set(c.id, id);
    editor.createShape<OcCardShape>({
      id,
      type: "oc-card",
      x: p.x,
      y: p.y,
      props: {
        w: CARD_W,
        h: CARD_H,
        kind: c.kind,
        name: c.name,
        body: c.body,
        objectId: "",
        metaCount: 0,
      },
    });
  }

  // ── Objective sink — right-most, vertically centered across all lanes. ──
  const objId = createShapeId();
  editor.createShape<ObjectiveCardShape>({
    id: objId,
    type: "objective-card",
    x: layout.sinkX,
    y: layout.centerY - OBJ_H / 2,
    props: {
      w: OBJ_W,
      h: OBJ_H,
      spaceId: "",
      title: OBJECTIVE.title,
      objective: OBJECTIVE.text,
      color: "#7C3AED",
    },
  });

  // ── Directed arrows — clean, solid, small arrowhead; bound source-right →
  //    target-left so direction reads as the left→right flow. ──
  const wire = (fromId: TLShapeId, toId: TLShapeId) => {
    const arrowId = createShapeId();
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        size: "s",
        dash: "solid",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        bend: 0,
      },
      meta: { sysLink: true },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 1, y: 0.5 },
          isExact: false,
          isPrecise: true,
        },
        meta: {},
      },
      {
        fromId: arrowId,
        toId: toId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0, y: 0.5 },
          isExact: false,
          isPrecise: true,
        },
        meta: {},
      },
    ]);
  };

  for (const l of LINKS) {
    const a = shapeIdByCard.get(l.from);
    const b = shapeIdByCard.get(l.to);
    if (a && b) wire(a, b);
  }
  for (const f of OBJ_FROM) {
    const a = shapeIdByCard.get(f);
    if (a) wire(a, objId);
  }

  editor.zoomToFit({ animation: { duration: 0 } });
}

export default function SystemsDecomposePreviewPage() {
  const handleMount = useCallback((editor: Editor) => {
    // Direct call (not rAF — a backgrounded preview tab pauses rAF). Defer one
    // macrotask so the camera is sized before zoomToFit.
    (window as unknown as { __ed?: Editor }).__ed = editor;
    setTimeout(() => {
      try {
        build(editor);
        console.log(
          "[systems-decompose-preview] built shapes:",
          editor.getCurrentPageShapes().length,
        );
      } catch (err) {
        console.error("[systems-decompose-preview] build failed", err);
      }
    }, 0);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw shapeUtils={UTILS} onMount={handleMount} />
    </div>
  );
}

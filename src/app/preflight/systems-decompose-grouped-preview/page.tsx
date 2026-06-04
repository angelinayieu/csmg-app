"use client";

// ── Preflight: GROUPED decomposition ────────────────────────────────
//
// The "view the whole decomposition as ONE artifact" version. Same systems
// graph (feature/variable oc-cards + directed arrows from the pure preview),
// but wrapped in a minimal SysFrame group, with a SINGLE connector from the
// frame → the objective card (instead of one line per sink card). This is the
// aesthetic to approve before wiring Group/Ungroup into the live decompose.
//
// Public route, no auth/data — SAFE TO DELETE.

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
import {
  SysFrameShapeUtil,
  type SysFrameShape,
} from "@/components/objective/shapes/sys-frame-shape";
import { layoutSystemsGraph } from "@/lib/objective-canvas/layout-systems-graph";

const UTILS = [OcCardShapeUtil, ObjectiveCardShapeUtil, SysFrameShapeUtil];

const CARD_W = 248;
const CARD_H = 176;
const OBJ_W = 300;
const OBJ_H = 168;
const PAD = 38; // frame padding around the cards
const TOP_PAD = 60; // extra top room for the label tab
const OBJ_GAP = 130; // gap between frame and objective
const ACCENT = "#7C3AED";

interface SampleCard {
  id: string;
  kind: OcCardKind;
  name: string;
  body: string;
  subsystem: string;
}

const CARDS: SampleCard[] = [
  { id: "f1", kind: "feature", name: "AI Debate Interface", body: "Structured, real-time debates with an AI across a wide range of topics.", subsystem: "Debate core" },
  { id: "f2", kind: "feature", name: "Debate Matchmaking", body: "Pairs users by interest and skill for human-to-human debates.", subsystem: "Debate core" },
  { id: "v1", kind: "variable", name: "Debate Skill Level", body: "A user's proficiency in argumentation, rebuttal, and critical thinking.", subsystem: "Debate core" },
  { id: "v2", kind: "variable", name: "Topic Coverage", body: "The range of subjects and issues the app supports for debates.", subsystem: "Debate core" },
  { id: "f4", kind: "feature", name: "Knowledge Resource Library", body: "Curated articles, papers, and videos to help users prepare.", subsystem: "Growth & insight" },
  { id: "f3", kind: "feature", name: "Progress Tracking Dashboard", body: "Shows skill growth over time, highlighting strengths and gaps.", subsystem: "Growth & insight" },
  { id: "v3", kind: "variable", name: "User Engagement", body: "How actively users participate in debates and other features.", subsystem: "Growth & insight" },
  { id: "f5", kind: "feature", name: "Collaborative Project Platform", body: "Lets users form teams and work on projects addressing complex issues.", subsystem: "Collaboration" },
  { id: "v4", kind: "variable", name: "Project Collaboration Rate", body: "The frequency and success of users teaming up within the app.", subsystem: "Collaboration" },
];

// Inter-card dependencies only (the objective connection is now ONE frame→obj
// link, not per-card).
const LINKS: { from: string; to: string }[] = [
  { from: "f1", to: "v1" },
  { from: "f2", to: "v2" },
  { from: "f4", to: "v2" },
  { from: "v1", to: "f3" },
  { from: "f3", to: "v3" },
  { from: "v1", to: "v3" },
  { from: "v2", to: "v3" },
  { from: "f5", to: "v4" },
  { from: "v4", to: "v3" },
];

const OBJECTIVE = {
  title: "AI debate & collaboration app",
  text: "Help people sharpen reasoning through AI + peer debate, and channel it into real collaborative projects.",
};

function bindArrow(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
  opts: { thick?: boolean } = {},
) {
  const arrowId = createShapeId();
  const arrow: TLShapePartial<TLArrowShape> = {
    id: arrowId,
    type: "arrow",
    props: {
      color: "grey",
      size: opts.thick ? "m" : "s",
      dash: "solid",
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
      bend: 0,
    },
  };
  editor.createShapes([arrow]);
  editor.createBindings([
    { fromId: arrowId, toId: fromId, type: "arrow", props: { terminal: "start", normalizedAnchor: { x: 1, y: 0.5 }, isExact: false, isPrecise: true }, meta: {} },
    { fromId: arrowId, toId: toId, type: "arrow", props: { terminal: "end", normalizedAnchor: { x: 0, y: 0.5 }, isExact: false, isPrecise: true }, meta: {} },
  ]);
}

function build(editor: Editor) {
  if (editor.getCurrentPageShapes().length > 0) return;

  const layout = layoutSystemsGraph(
    CARDS.map((c) => ({ id: c.id, subsystem: c.subsystem })),
    LINKS,
    { cardW: CARD_W, cardH: CARD_H, startX: 0, startY: 0 },
  );

  // Card bounding box (positions are relative to 0,0).
  let maxX = 0;
  let maxY = 0;
  for (const c of CARDS) {
    const p = layout.pos.get(c.id);
    if (!p) continue;
    maxX = Math.max(maxX, p.x + CARD_W);
    maxY = Math.max(maxY, p.y + CARD_H);
  }

  const frameW = maxX + PAD * 2;
  const frameH = maxY + TOP_PAD + PAD;

  // ── Frame FIRST so it sits behind the cards. ──
  const frameId = createShapeId();
  editor.createShape<SysFrameShape>({
    id: frameId,
    type: "sys-frame",
    x: 0,
    y: 0,
    props: { w: frameW, h: frameH, label: OBJECTIVE.title, accent: ACCENT },
  });

  // ── Swimlane labels + cards, offset inside the frame. ──
  for (const lane of layout.lanes) {
    editor.createShape({
      id: createShapeId(),
      type: "text",
      x: PAD,
      y: TOP_PAD + lane.top - 30,
      props: {
        richText: toRichText(lane.subsystem),
        size: "s",
        color: "grey",
        font: "sans",
        textAlign: "start",
        autoSize: true,
        scale: 1,
      },
    });
  }

  const idByCard = new Map<string, TLShapeId>();
  for (const c of CARDS) {
    const p = layout.pos.get(c.id);
    if (!p) continue;
    const id = createShapeId();
    idByCard.set(c.id, id);
    editor.createShape<OcCardShape>({
      id,
      type: "oc-card",
      x: PAD + p.x,
      y: TOP_PAD + p.y,
      props: { w: CARD_W, h: CARD_H, kind: c.kind, name: c.name, body: c.body, objectId: "", metaCount: 0 },
    });
  }

  for (const l of LINKS) {
    const a = idByCard.get(l.from);
    const b = idByCard.get(l.to);
    if (a && b) bindArrow(editor, a, b);
  }

  // ── Objective card OUTSIDE the frame, to the right; ONE connector. ──
  const objId = createShapeId();
  editor.createShape<ObjectiveCardShape>({
    id: objId,
    type: "objective-card",
    x: frameW + OBJ_GAP,
    y: frameH / 2 - OBJ_H / 2,
    props: { w: OBJ_W, h: OBJ_H, spaceId: "", title: OBJECTIVE.title, objective: OBJECTIVE.text, color: ACCENT },
  });
  bindArrow(editor, frameId, objId, { thick: true });

  editor.zoomToFit({ animation: { duration: 0 } });
}

export default function SystemsDecomposeGroupedPreviewPage() {
  const handleMount = useCallback((editor: Editor) => {
    (window as unknown as { __ed?: Editor }).__ed = editor;
    setTimeout(() => {
      try {
        build(editor);
      } catch (err) {
        console.error("[systems-decompose-grouped-preview] build failed", err);
      }
    }, 0);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw shapeUtils={UTILS} onMount={handleMount} />
    </div>
  );
}

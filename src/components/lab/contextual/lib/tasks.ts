// ── Tasks ─────────────────────────────────────────────────────────
//
// 8 task definitions verbatim from the reference. Each carries a
// demand K and loadFactor that the prediction model uses to compute
// effective capacity vs success probability.

import type { Task } from "./types";

export const TASKS: Task[] = [
  {
    id: "digit_span",
    name: "Digit Span",
    contentType: "verbal",
    op: "maintenance",
    demand: 4.0,
    loadFactor: 1.0,
    desc: "Verbal recall of digit sequences.",
  },
  {
    id: "n_back",
    name: "N-Back (verbal)",
    contentType: "verbal",
    op: "updating",
    demand: 4.2,
    loadFactor: 1.3,
    desc: "Continuous updating against prior items.",
  },
  {
    id: "corsi",
    name: "Corsi Block Span",
    contentType: "visuospatial",
    op: "maintenance",
    demand: 3.8,
    loadFactor: 1.0,
    desc: "Visuospatial location sequence recall.",
  },
  {
    id: "mental_rot",
    name: "Mental Rotation",
    contentType: "visuospatial",
    op: "manipulation",
    demand: 4.1,
    loadFactor: 1.4,
    desc: "Active spatial manipulation.",
  },
  {
    id: "reading_span",
    name: "Reading Span",
    contentType: "verbal",
    op: "dual",
    demand: 4.0,
    loadFactor: 1.5,
    desc: "Complex span: processing + storage.",
  },
  {
    id: "handoff",
    name: "Medical Handoff",
    contentType: "verbal",
    op: "dual",
    demand: 4.5,
    loadFactor: 1.4,
    desc: "Multi-patient sign-out with interruptions.",
    domainBoost: "medical",
  },
  {
    id: "chess_pos",
    name: "Chess Position",
    contentType: "visuospatial",
    op: "maintenance",
    demand: 4.0,
    loadFactor: 1.0,
    desc: "Recall of piece positions on a board.",
    domainBoost: "chess",
  },
  {
    id: "driving",
    name: "Driving Task",
    contentType: "visuospatial",
    op: "dual",
    demand: 3.5,
    loadFactor: 1.2,
    desc: "Dynamic scene monitoring + dual demands.",
  },
];

export function getTask(id: string): Task | null {
  return TASKS.find((t) => t.id === id) ?? null;
}

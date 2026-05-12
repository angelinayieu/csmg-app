// ── Focus Mode auto-mark heuristic ──
//
// Stage 1 of Focus Mode asks "what did you actually decide?" — the
// auto-marker classifies every node on the board into one of three
// buckets before the user reviews. The heuristic is intentionally
// conservative: when in doubt, lean toward "kept" so the user
// overrides downward (excludes) rather than upward (adds back).
//
// Signal strength (strongest → weakest):
//   1. kind === 'plan'        — explicit synthesis artifact (always kept)
//   2. children.length > 0    — user expanded on this thread
//   3. kind === 'core'        — the seed (always kept)
//   4. kind === 'ranking'     — user-promoted summary node (always kept)
//   5. kind === 'variation' with no children — pure scratch, exploratory
//   6. kind === 'user'        — legacy spoken transcript (excluded)
//   7. everything else        — default kept
//
// The auto-mark output is a starting point; user overrides win.

import type { ClientNode, NodeKind } from "./types";

export type FocusBucket = "plan" | "expanded" | "exploratory" | "unclear";

export interface FocusMarking {
  bucket: FocusBucket;
  // Whether this node is "in" the converged set by default. User
  // overrides win via FocusOverrides map.
  defaultKept: boolean;
  // Reason for the classification, surfaced as a hover hint in the UI.
  why: string;
  // For "plan" bucket only — how many other nodes this plan was
  // synthesized over (i.e., its children count plus a hint of richness
  // even when absorbed nodes aren't tracked structurally).
  absorbsCount?: number;
}

export type FocusOverrides = Map<string, "keep" | "exclude">;

// Compute per-node classifications. Returns a Map keyed by node id.
// Caller wraps with overrides to get the effective kept set.
export function autoMarkBoard(
  nodes: ClientNode[],
): Map<string, FocusMarking> {
  const out = new Map<string, FocusMarking>();
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parent) {
      childCount.set(n.parent, (childCount.get(n.parent) ?? 0) + 1);
    }
  }

  for (const n of nodes) {
    const children = childCount.get(n.id) ?? 0;

    if (n.kind === "plan") {
      out.set(n.id, {
        bucket: "plan",
        defaultKept: true,
        why: "User synthesized this — explicit converged artifact",
        absorbsCount: children,
      });
      continue;
    }

    if (n.kind === "core") {
      out.set(n.id, {
        bucket: "expanded",
        defaultKept: true,
        why: "Board seed",
      });
      continue;
    }

    if (n.kind === "ranking") {
      out.set(n.id, {
        bucket: "expanded",
        defaultKept: true,
        why: "User-promoted ranking summary",
      });
      continue;
    }

    if (n.kind === "user") {
      // Legacy transcript nodes — never count toward decided content
      out.set(n.id, {
        bucket: "exploratory",
        defaultKept: false,
        why: "Legacy transcript node",
      });
      continue;
    }

    if (n.kind === "variation" && children === 0) {
      out.set(n.id, {
        bucket: "exploratory",
        defaultKept: false,
        why: "Variation with no follow-on — likely scratch",
      });
      continue;
    }

    if (children > 0) {
      out.set(n.id, {
        bucket: "expanded",
        defaultKept: true,
        why: `Expanded thread (${children} ${children === 1 ? "child" : "children"})`,
      });
      continue;
    }

    // Catch-all: branches, insights, questions, actions without
    // children. Lean kept by default (user can override).
    out.set(n.id, {
      bucket: "unclear",
      defaultKept: true,
      why: `${labelForKind(n.kind)} — kept by default`,
    });
  }

  return out;
}

function labelForKind(kind: NodeKind): string {
  switch (kind) {
    case "branch":
      return "Branch";
    case "insight":
      return "Insight";
    case "question":
      return "Question";
    case "action":
      return "Action";
    case "variation":
      return "Variation";
    default:
      return "Node";
  }
}

// Effective kept set = auto-marked defaults overridden by user's
// keep/exclude toggles. Used to compute canvas dimming + downstream
// extract calls.
export function computeKeptIds(
  marks: Map<string, FocusMarking>,
  overrides: FocusOverrides,
): Set<string> {
  const out = new Set<string>();
  for (const [id, mark] of marks) {
    const override = overrides.get(id);
    if (override === "keep") {
      out.add(id);
    } else if (override === "exclude") {
      // explicitly excluded — skip
    } else if (mark.defaultKept) {
      out.add(id);
    }
  }
  return out;
}

// Three-section bucketing for Stage 1 rendering. Returns nodes
// already grouped by the bucket they belong to (post auto-mark, pre
// override), with plan nodes ordered most-recent-first.
export function groupForStage1(
  nodes: ClientNode[],
  marks: Map<string, FocusMarking>,
): {
  plans: Array<{ node: ClientNode; mark: FocusMarking }>;
  expanded: Array<{ node: ClientNode; mark: FocusMarking }>;
  exploratory: Array<{ node: ClientNode; mark: FocusMarking }>;
  unclear: Array<{ node: ClientNode; mark: FocusMarking }>;
} {
  const plans: Array<{ node: ClientNode; mark: FocusMarking }> = [];
  const expanded: Array<{ node: ClientNode; mark: FocusMarking }> = [];
  const exploratory: Array<{ node: ClientNode; mark: FocusMarking }> = [];
  const unclear: Array<{ node: ClientNode; mark: FocusMarking }> = [];

  for (const n of nodes) {
    const mark = marks.get(n.id);
    if (!mark) continue;
    switch (mark.bucket) {
      case "plan":
        plans.push({ node: n, mark });
        break;
      case "expanded":
        expanded.push({ node: n, mark });
        break;
      case "exploratory":
        exploratory.push({ node: n, mark });
        break;
      case "unclear":
        unclear.push({ node: n, mark });
        break;
    }
  }

  // We don't track absolute creation order in ClientNode, so the
  // existing array order (load order from DB) approximates recency.
  // Plans rendered last-first so the most recent synthesis sits up top.
  plans.reverse();

  return { plans, expanded, exploratory, unclear };
}

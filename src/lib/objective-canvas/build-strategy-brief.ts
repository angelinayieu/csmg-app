// ── Build Strategy Brief ───────────────────────────────────────────
//
// Pure compose function: takes a CrossRoomState (everything the
// objective canvas has produced) + an optional cached
// CrossRoomAnalysisState (themes, recommendations, open findings)
// and shapes them into a StrategyBrief — the read-out the user
// walks away with.
//
// No LLM. Everything here is derivation over structured state that
// already exists. The optional polish endpoint (separate route)
// adds a 2-3 sentence executive summary on top.

import type { CrossRoomState } from "./analyses/types";
import type {
  AnalysisCategory,
  AnalysisSeverity,
  CrossRoomAnalysisState,
} from "./analyses/types";
import type { OperationalConstraints } from "./constraints";
import type { ItemVariation } from "./expand-item-detail";

/** A theme distilled across rooms (from distill_concepts findings). */
export interface BriefTheme {
  name: string;
  description: string;
  why_it_recurs: string;
  evidence: string[];
  room_ids: string[];
  /** Set when the user already promoted this theme to a sub-objective. */
  spawned_sub_objective_id: string | null;
}

/** A single composed design in a room. */
export interface BriefComposedDesign {
  item_id: string;
  item_name: string;
  item_layer: "pain" | "features" | "outcomes" | "objective";
  description: string;
  integration_points: string[];
  conflicts_resolved: string[];
  conflicts_open: string[];
}

/** An elected variation surfaced in the brief. */
export interface BriefElectedVariation {
  item_id: string;
  item_name: string;
  variation_id: string;
  variation_name: string;
  variation_kind: ItemVariation["kind"];
  tradeoff: string;
}

/** A prototype brief planned for a variation × open question. */
export interface BriefExperiment {
  item_id: string;
  item_name: string;
  variation_id: string;
  open_question: string;
  hypothesis: string;
  signal_to_watch: string;
  kill_criteria: string;
  build_estimate: string;
  artifact_type: string;
  learning_target: string;
}

/** L1 — A cluster of expansion-tree nodes hanging off one parent
 *  surface in the room, surfaced in the brief so the user's L3+
 *  cognitive work shows up in the read-out. Grouped by attach point
 *  so the brief reads "Streak-based variation → mechanism story /
 *  data model / edge cases" rather than a flat list of node titles. */
export interface BriefExpansionHighlight {
  /** Which item the expansion lives on. */
  item_id: string;
  item_name: string;
  /** Display label for the attach surface — variation name,
   *  open-question text, conflict text, etc. */
  parent_title: string;
  /** Catalog of attach kinds we surface. We skip "expansion_node"
   *  (recursive children) since they're already represented under
   *  their L3 parent in the same list. */
  attach_kind:
    | "variation"
    | "open_question"
    | "conflict_open"
    | "planning_risk"
    | "integration_point";
  /** The kept / null-disposition L3+ nodes under this attach.
   *  Excludes "parked" — the user explicitly hid those. */
  nodes: Array<{
    title: string;
    node_type: string;
    depth: number;
    /** Optional first-line excerpt for prose-heavy node types
     *  (mechanism_story, alternative_framings, etc). Empty when
     *  the body is structured (arrays of objects) rather than prose. */
    excerpt: string;
  }>;
}

/** One sub-objective room as it appears in the brief. */
export interface BriefRoom {
  id: string;
  title: string;
  description: string | null;
  top_negative_outcome: string | null;
  composed_designs: BriefComposedDesign[];
  elected_variations: BriefElectedVariation[];
  experiments: BriefExperiment[];
  /** L1 — expansion-tree highlights per item in this room.
   *  Empty when the user hasn't drilled into any variation. */
  expansion_highlights: BriefExpansionHighlight[];
  /** Number of items in the room — used in the section subtitle so
   *  the user sees the breadth at a glance ("4 frictions · 3 mechanisms"). */
  lane_counts: {
    pain: number;
    features: number;
    outcomes: number;
  };
}

/** Single recommended-next-move (latest priority finding). */
export interface BriefNextMove {
  action: string;
  rationale: string;
  next_steps: string[];
  estimated_effort: string;
  what_youll_learn: string;
  affected_room_ids: string[];
}

/** A surfaced open finding worth attending to in the brief. */
export interface BriefOpenItem {
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  title: string;
  summary: string;
  room_ids: string[];
}

export interface StrategyBrief {
  objective_text: string;
  space_id: string;
  generated_at: string;
  constraints: OperationalConstraints | null;
  /** Top-level counts for the title-block caption. */
  totals: {
    rooms: number;
    items: number;
    elected_variations: number;
    composed_designs: number;
    experiments_planned: number;
    open_conflicts: number;
    /** L1 — count of L3+ expansion nodes the user has KEPT (non-parked)
     *  across all rooms. Surfaced in the caption so the brief signals
     *  "this objective has 12 deep cards under it" — depth visibility. */
    expansion_nodes: number;
  };
  /** Optional — present only when the user ran the polish endpoint.
   *  Plain prose, max ~3 sentences. */
  ai_tldr: string | null;
  /** Cross-room themes (from distill_concepts findings). */
  themes: BriefTheme[];
  rooms: BriefRoom[];
  next_move: BriefNextMove | null;
  /** Findings (non-dismissed, severity ≥ medium, excludes theme +
   *  priority categories since those drive their own sections). */
  open_items: BriefOpenItem[];
}

export interface BuildStrategyBriefArgs {
  state: CrossRoomState;
  analysis: CrossRoomAnalysisState | null;
  /** Cached polish prose if previously generated. */
  cachedTldr?: string | null;
}

export function buildStrategyBrief(
  args: BuildStrategyBriefArgs,
): StrategyBrief {
  const { state, analysis, cachedTldr } = args;
  const findings = analysis?.findings ?? [];

  // ── Per-room aggregation ──────────────────────────────────────
  const briefRooms: BriefRoom[] = state.rooms.map((room) => {
    const items = state.items.filter((i) => i.room_id === room.id);

    const composed_designs: BriefComposedDesign[] = items
      .map((it) => {
        const cd = it.expanded_detail?.composed_design;
        if (!cd || !cd.description) return null;
        return {
          item_id: it.id,
          item_name: it.name,
          item_layer: it.layer,
          description: cd.description,
          integration_points: cd.integration_points ?? [],
          conflicts_resolved: cd.conflicts_resolved ?? [],
          conflicts_open: cd.conflicts_open ?? [],
        } satisfies BriefComposedDesign;
      })
      .filter((c): c is BriefComposedDesign => c !== null);

    const elected_variations: BriefElectedVariation[] = items.flatMap((it) => {
      const vs = it.expanded_detail?.variations ?? [];
      const electedIds = new Set(it.elected_variation_ids);
      return vs
        .filter((v) => electedIds.has(v.id))
        .map((v) => ({
          item_id: it.id,
          item_name: it.name,
          variation_id: v.id,
          variation_name: v.name,
          variation_kind: v.kind,
          tradeoff: v.tradeoff,
        }));
    });

    const experiments: BriefExperiment[] = items.flatMap((it) => {
      const briefs = it.expanded_detail?.prototype_briefs ?? [];
      return briefs.map((b) => ({
        item_id: it.id,
        item_name: it.name,
        variation_id: b.variation_id,
        open_question: b.open_question,
        hypothesis: b.hypothesis,
        signal_to_watch: b.signal_to_watch,
        kill_criteria: b.kill_criteria,
        build_estimate: b.build_estimate,
        artifact_type: b.artifact_type,
        learning_target: b.learning_target,
      }));
    });

    // L1 — Expansion highlights per item. Group L3+ nodes by their
    // attach surface (variation / open question / conflict / etc.) so
    // the brief reads "Streak-based → mechanism story + data model +
    // edge cases" rather than a flat list. Skip "parked" disposition
    // (user explicitly hid) and "expansion_node" attach (recursive
    // children, already represented under their L3 parent).
    const expansion_highlights: BriefExpansionHighlight[] =
      items.flatMap((it) => {
        const tree = it.expanded_detail?.expansion_tree ?? [];
        if (tree.length === 0) return [];

        // Build a parent_title lookup so each attach group renders
        // with a human label (variation name, etc.) — not the raw
        // attach_ref slug.
        const variationName = (variationId: string): string | null => {
          const v = (it.expanded_detail?.variations ?? []).find(
            (vv) => vv.id === variationId,
          );
          return v?.name ?? null;
        };

        // Group nodes by (attach_point, attach_ref) tuple.
        type GroupKey = string;
        const groups = new Map<
          GroupKey,
          {
            attach_point: string;
            attach_ref: string;
            nodes: typeof tree;
          }
        >();
        for (const n of tree) {
          if (n.attach_point === "expansion_node") continue; // recursive child
          if (n.disposition === "parked") continue;
          const key = `${n.attach_point}::${n.attach_ref}`;
          const g = groups.get(key) ?? {
            attach_point: n.attach_point,
            attach_ref: n.attach_ref,
            nodes: [] as typeof tree,
          };
          g.nodes.push(n);
          groups.set(key, g);
        }

        // Map each group → BriefExpansionHighlight.
        const highlights: BriefExpansionHighlight[] = [];
        for (const g of groups.values()) {
          let parent_title = g.attach_ref;
          let attach_kind: BriefExpansionHighlight["attach_kind"] = "variation";
          if (g.attach_point === "variation") {
            attach_kind = "variation";
            parent_title = variationName(g.attach_ref) ?? "Variation";
          } else if (g.attach_point === "open_question") {
            attach_kind = "open_question";
            // attach_ref shape: "<variation_id>::<question_slug>"
            // — we don't have the verbatim question stored, so we
            // surface the slug as a readable hint.
            const [vid, ...rest] = g.attach_ref.split("::");
            const slug = rest.join("::");
            const vname = variationName(vid);
            parent_title = vname
              ? `${vname} · open question (${slug.slice(0, 40)})`
              : `Open question (${slug.slice(0, 40)})`;
          } else if (g.attach_point === "conflict_open") {
            attach_kind = "conflict_open";
            parent_title = `Conflict: ${g.attach_ref.slice(0, 50)}`;
          } else if (g.attach_point === "planning_risk") {
            attach_kind = "planning_risk";
            parent_title = `Planning: ${g.attach_ref.slice(0, 50)}`;
          } else if (g.attach_point === "integration_point") {
            attach_kind = "integration_point";
            parent_title = `Integration: ${g.attach_ref.slice(0, 50)}`;
          }

          // Cap nodes per group to keep the brief scannable.
          const nodes = g.nodes.slice(0, 6).map((n) => ({
            title: n.title,
            node_type: n.node_type,
            depth: n.depth,
            excerpt: extractNodeExcerpt(n.node_type, n.body),
          }));

          highlights.push({
            item_id: it.id,
            item_name: it.name,
            parent_title,
            attach_kind,
            nodes,
          });
        }
        return highlights;
      });

    const lane_counts = {
      pain: items.filter((i) => i.layer === "pain").length,
      features: items.filter((i) => i.layer === "features").length,
      outcomes: items.filter((i) => i.layer === "outcomes").length,
    };

    return {
      id: room.id,
      title: room.title,
      description: room.description,
      top_negative_outcome: room.top_negative_outcome,
      composed_designs,
      elected_variations,
      experiments,
      expansion_highlights,
      lane_counts,
    } satisfies BriefRoom;
  });

  // ── Themes from distill_concepts findings ────────────────────
  const themeFindings = findings.filter(
    (f) => f.analysis_key === "distill_concepts" && f.disposition !== "dismissed",
  );
  const themes: BriefTheme[] = themeFindings.map((f) => {
    const body = f.body ?? {};
    const evidence = Array.isArray(body.evidence)
      ? (body.evidence as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [];
    return {
      name: typeof body.name === "string" ? body.name : f.title,
      description:
        typeof body.description === "string" ? body.description : f.summary,
      why_it_recurs:
        typeof body.why_it_recurs === "string" ? body.why_it_recurs : "",
      evidence,
      room_ids: f.references?.room_ids ?? [],
      spawned_sub_objective_id:
        typeof body.spawned_sub_objective_id === "string"
          ? body.spawned_sub_objective_id
          : null,
    } satisfies BriefTheme;
  });

  // ── Next move (single, latest recommend_next_move finding) ───
  const recFinding = findings
    .filter(
      (f) =>
        f.analysis_key === "recommend_next_move" &&
        f.disposition !== "dismissed",
    )
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
  let next_move: BriefNextMove | null = null;
  if (recFinding) {
    const body = recFinding.body ?? {};
    const recommendedAction =
      typeof body.recommended_action === "string"
        ? body.recommended_action
        : recFinding.title;
    next_move = {
      action: recommendedAction,
      rationale:
        typeof body.rationale === "string" ? body.rationale : recFinding.summary,
      next_steps: Array.isArray(body.next_steps)
        ? (body.next_steps as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : [],
      estimated_effort:
        typeof body.estimated_effort === "string"
          ? body.estimated_effort
          : "",
      what_youll_learn:
        typeof body.what_youll_learn === "string"
          ? body.what_youll_learn
          : "",
      affected_room_ids: recFinding.references?.room_ids ?? [],
    } satisfies BriefNextMove;
  }

  // ── Open items: findings severity ≥ medium, excluding the
  //    categories that drive their own sections (theme, priority). ──
  const SEVERITY_RANK: Record<AnalysisSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  const open_items: BriefOpenItem[] = findings
    .filter((f) => f.disposition === "open")
    .filter((f) => f.category !== "theme" && f.category !== "priority")
    .filter((f) => SEVERITY_RANK[f.severity] <= 2)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 12)
    .map<BriefOpenItem>((f) => ({
      category: f.category,
      severity: f.severity,
      title: f.title,
      summary: f.summary,
      room_ids: f.references?.room_ids ?? [],
    }));

  // ── Totals (caption + sense-check) ───────────────────────────
  const totals = {
    rooms: briefRooms.length,
    items: state.items.length,
    elected_variations: briefRooms.reduce(
      (sum, r) => sum + r.elected_variations.length,
      0,
    ),
    composed_designs: briefRooms.reduce(
      (sum, r) => sum + r.composed_designs.length,
      0,
    ),
    experiments_planned: briefRooms.reduce(
      (sum, r) => sum + r.experiments.length,
      0,
    ),
    open_conflicts: briefRooms.reduce(
      (sum, r) =>
        sum +
        r.composed_designs.reduce(
          (c, cd) => c + cd.conflicts_open.length,
          0,
        ),
      0,
    ),
    expansion_nodes: briefRooms.reduce(
      (sum, r) =>
        sum + r.expansion_highlights.reduce((c, h) => c + h.nodes.length, 0),
      0,
    ),
  };

  return {
    objective_text: state.core_objective_text,
    space_id: state.space_id,
    generated_at: new Date().toISOString(),
    constraints: state.constraints,
    totals,
    ai_tldr: cachedTldr ?? null,
    themes,
    rooms: briefRooms,
    next_move,
    open_items,
  };
}

/** L1 — pull a short prose excerpt out of an expansion node's body
 *  for the Strategy Brief. The catalog body shapes vary wildly across
 *  domains (paragraph for mechanism_story, levels[] for root_cause_tree,
 *  cases[] for edge_cases, etc.) so we walk a priority list of known
 *  prose keys and use the first non-empty one. For structured bodies
 *  (data_model, manifestation_map) we return empty — the node title
 *  alone is enough; the user clicks through for the structure.
 *
 *  Cap each excerpt at one short clause so the brief stays scannable. */
function extractNodeExcerpt(
  nodeType: string,
  body: Record<string, unknown> | undefined | null,
): string {
  if (!body) return "";
  // Highest-priority prose keys, ordered by how often the catalog
  // uses them. First match wins. Each is a top-level string field.
  const PROSE_KEYS = [
    "paragraph", // *.mechanism_story, *.felt_mechanism
    "default_path", // *.disambiguation_decision, *.decision_rule
    "experiment", // journaling.smallest_experiment
    "check", // software.simplest_check
    "recommended_action", // (recommend_next_move-style)
    "load_bearing_root", // pain.root_cause_tree
    "load_bearing_stage", // journaling.recurrence_cycle
    "affected_most", // pain.severity_calibration
    "kill_switch", // software.rollback_strategy
    "session_signal", // journaling.felt_sense_signal
    "weekly_signal",
    "anti_metric", // software.telemetry
    "anti_signal", // journaling.felt_sense_signal
    "target", // outcome.calibration_baseline
    "two_to_four_weeks", // journaling.week_to_week_delta
  ] as const;
  for (const key of PROSE_KEYS) {
    const v = body[key];
    if (typeof v === "string" && v.trim().length > 0) {
      const trimmed = v.trim();
      // First sentence or 140 chars, whichever comes first.
      const firstStop = trimmed.search(/[.!?]\s/);
      const clause =
        firstStop > 20 && firstStop < 160
          ? trimmed.slice(0, firstStop + 1)
          : trimmed.slice(0, 140);
      return clause.length < trimmed.length ? `${clause.trim()}…` : clause.trim();
    }
  }
  // Suppress noisy structured fields — the node title carries enough
  // signal on its own. Caller falls back to empty string.
  return "";
}

/** Render the brief as clean markdown for export / copy-paste.
 *  Pure function — no DOM. The UI's "Copy markdown" button just
 *  calls this and writes the result to the clipboard. */
export function renderStrategyBriefMarkdown(brief: StrategyBrief): string {
  const out: string[] = [];

  out.push(`# Strategy Brief`);
  out.push("");
  out.push(`> ${brief.objective_text}`);
  out.push("");
  out.push(
    `_${brief.totals.rooms} rooms · ${brief.totals.items} items · ${brief.totals.elected_variations} elected · ${brief.totals.composed_designs} composed · ${brief.totals.experiments_planned} experiments${
      brief.totals.expansion_nodes > 0
        ? ` · ${brief.totals.expansion_nodes} deep dives`
        : ""
    }_`,
  );
  out.push("");

  if (brief.ai_tldr) {
    out.push(`## Executive summary`);
    out.push("");
    out.push(brief.ai_tldr);
    out.push("");
  }

  if (brief.constraints) {
    out.push(`## Operating context`);
    out.push("");
    out.push(`- **Time horizon**: ${brief.constraints.time_horizon}`);
    out.push(`- **Budget**: ${brief.constraints.budget_tier}`);
    out.push(`- **Team**: ${brief.constraints.team_size}`);
    out.push(`- **Risk tolerance**: ${brief.constraints.risk_tolerance}`);
    if (brief.constraints.compliance_requirements.length > 0) {
      out.push(
        `- **Compliance**: ${brief.constraints.compliance_requirements.join(", ")}`,
      );
    }
    out.push("");
  }

  if (brief.themes.length > 0) {
    out.push(`## Strategic threads`);
    out.push("");
    for (const t of brief.themes) {
      out.push(`### ${t.name}`);
      out.push("");
      out.push(t.description);
      if (t.why_it_recurs) {
        out.push("");
        out.push(`_Why it recurs:_ ${t.why_it_recurs}`);
      }
      if (t.evidence.length > 0) {
        out.push("");
        for (const e of t.evidence) out.push(`- "${e}"`);
      }
      out.push("");
    }
  }

  if (brief.rooms.length > 0) {
    out.push(`## Sub-objectives`);
    out.push("");
    brief.rooms.forEach((r, i) => {
      out.push(`### ${i + 1}. ${r.title}`);
      out.push("");
      if (r.top_negative_outcome) {
        out.push(`**Counters:** ${r.top_negative_outcome}`);
        out.push("");
      }
      if (r.composed_designs.length > 0) {
        out.push(`**Chosen design**`);
        out.push("");
        for (const cd of r.composed_designs) {
          out.push(`- **${cd.item_name}** — ${cd.description}`);
          if (cd.integration_points.length > 0) {
            for (const ip of cd.integration_points) out.push(`  - ${ip}`);
          }
        }
        out.push("");
      }
      const allOpenConflicts = r.composed_designs.flatMap(
        (cd) => cd.conflicts_open,
      );
      if (allOpenConflicts.length > 0) {
        out.push(`**Open conflicts**`);
        out.push("");
        for (const c of allOpenConflicts) out.push(`- ⚠ ${c}`);
        out.push("");
      }
      if (r.elected_variations.length > 0) {
        out.push(`**Elected variations**`);
        out.push("");
        for (const v of r.elected_variations) {
          out.push(`- ${v.variation_name} (${v.variation_kind}) — _${v.tradeoff}_`);
        }
        out.push("");
      }
      if (r.experiments.length > 0) {
        out.push(`**Experiments planned**`);
        out.push("");
        for (const e of r.experiments) {
          out.push(`- _${e.artifact_type}_ — ${e.hypothesis} (effort: ${e.build_estimate})`);
        }
        out.push("");
      }
      if (r.expansion_highlights.length > 0) {
        out.push(`**Deep dives**`);
        out.push("");
        for (const h of r.expansion_highlights) {
          out.push(
            `- **${h.item_name}** → ${h.parent_title}`,
          );
          for (const n of h.nodes) {
            const excerpt = n.excerpt ? ` — ${n.excerpt}` : "";
            out.push(`  - _L${n.depth}_ ${n.title}${excerpt}`);
          }
        }
        out.push("");
      }
    });
  }

  if (brief.next_move) {
    out.push(`## Next move`);
    out.push("");
    out.push(`**${brief.next_move.action}**`);
    out.push("");
    out.push(brief.next_move.rationale);
    out.push("");
    if (brief.next_move.next_steps.length > 0) {
      brief.next_move.next_steps.forEach((s, i) =>
        out.push(`${i + 1}. ${s}`),
      );
      out.push("");
    }
    if (brief.next_move.estimated_effort) {
      out.push(`_Effort: ${brief.next_move.estimated_effort}_`);
    }
    if (brief.next_move.what_youll_learn) {
      out.push(`_You'll know: ${brief.next_move.what_youll_learn}_`);
    }
    out.push("");
  }

  if (brief.open_items.length > 0) {
    out.push(`## Open items`);
    out.push("");
    for (const o of brief.open_items) {
      out.push(`- **${o.title}** — ${o.summary}`);
    }
    out.push("");
  }

  return out.join("\n");
}

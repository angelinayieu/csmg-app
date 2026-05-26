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

/** One sub-objective room as it appears in the brief. */
export interface BriefRoom {
  id: string;
  title: string;
  description: string | null;
  top_negative_outcome: string | null;
  composed_designs: BriefComposedDesign[];
  elected_variations: BriefElectedVariation[];
  experiments: BriefExperiment[];
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
    `_${brief.totals.rooms} rooms · ${brief.totals.items} items · ${brief.totals.elected_variations} elected · ${brief.totals.composed_designs} composed · ${brief.totals.experiments_planned} experiments_`,
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

// ── Mechanism materializer ────────────────────────────────────────────
//
// Reads a strategy's InfrastructureProposal[] and writes one mechanism row
// per (proposal, mechanism_hint) into public.mechanisms. Used by the
// twin-proposal generator (PR 3a/3b) to give the UI first-class mechanism
// rows to display, approve, and attach apps to — instead of walking the
// mechanism_hints[] enum buried inside synthesis_data.
//
// Stable identity:
//   unique(space_id, source_infrastructure_proposal_id, kind)
// so re-running for the same strategy version is idempotent (existing rows
// are returned, not duplicated).

import type {
  InfrastructureProposal,
  MechanismHint,
  AgentSpec,
  MechanismRow,
} from "@/types/strategy";

export interface MaterializeMechanismsArgs {
  spaceId: string;
  userId: string;
  strategyVersion?: number | null;
  proposals: InfrastructureProposal[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}

export interface MaterializeMechanismsResult {
  /** All mechanism rows after the operation (existing + newly inserted). */
  mechanisms: MechanismRow[];
  /** Map from InfrastructureProposal.id → mechanism IDs derived from it. */
  mechanismIdsByProposal: Map<string, string[]>;
  /** Count of newly inserted rows. */
  insertedCount: number;
}

const ALLOWED_KINDS: ReadonlySet<MechanismHint> = new Set([
  "simulation",
  "prediction",
  "validation",
  "baseline_tracking",
  "deviation_capture",
  "game",
  "ml_personalization",
]);

/**
 * Naming heuristic — gives the row a human-readable name without an LLM call.
 * "Simulation" + proposal "Customer Feedback Tracker" → "Customer Feedback Tracker · Simulation"
 */
function nameForMechanism(proposal: InfrastructureProposal, kind: MechanismHint): string {
  const kindLabel = kind
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return `${proposal.name} · ${kindLabel}`;
}

function rationaleForMechanism(proposal: InfrastructureProposal, kind: MechanismHint): string {
  const kindReason: Record<MechanismHint, string> = {
    simulation: "Run what-if scenarios against twin state.",
    prediction: "Forward-model expected metric trajectories.",
    validation: "Test hypotheses with structured experiments.",
    baseline_tracking: "Capture baseline so progress is anchored, not absolute.",
    deviation_capture: "Flag surprises from prediction as high-value learning.",
    game: "Drive engagement with behavioral mechanics.",
    ml_personalization: "Personalize behavior per user using prior interactions.",
  };
  return `${kindReason[kind]} Supports: ${proposal.description.slice(0, 140)}`;
}

export async function materializeMechanismsFromStrategy(
  args: MaterializeMechanismsArgs,
): Promise<MaterializeMechanismsResult> {
  const { spaceId, userId, strategyVersion, proposals, db } = args;
  const mechanismIdsByProposal = new Map<string, string[]>();
  let insertedCount = 0;

  if (proposals.length === 0) {
    return { mechanisms: [], mechanismIdsByProposal, insertedCount: 0 };
  }

  // Pre-load any existing rows so re-runs don't re-insert.
  const proposalIds = proposals.map((p) => p.id).filter((id) => typeof id === "string");
  const { data: existing } = (await db
    .from("mechanisms")
    .select("*")
    .eq("space_id", spaceId)
    .in("source_infrastructure_proposal_id", proposalIds)) as {
    data: MechanismRow[] | null;
  };

  const existingByKey = new Map<string, MechanismRow>();
  for (const m of existing ?? []) {
    if (!m.source_infrastructure_proposal_id) continue;
    existingByKey.set(`${m.source_infrastructure_proposal_id}|${m.kind}`, m);
  }

  // Build the rows we'd want to insert; skip ones that already exist.
  const inserts: Array<{
    space_id: string;
    user_id: string;
    name: string;
    description: string | null;
    kind: MechanismHint;
    cycle_pattern: string | null;
    rationale: string;
    source_infrastructure_proposal_id: string;
    source_strategy_version: number | null;
    agent_assignments: AgentSpec[];
    status: string;
  }> = [];

  for (const proposal of proposals) {
    const hints = (proposal.mechanism_hints ?? []).filter(
      (k): k is MechanismHint => ALLOWED_KINDS.has(k),
    );
    const proposalMechIds: string[] = [];

    for (const kind of hints) {
      const key = `${proposal.id}|${kind}`;
      const existingRow = existingByKey.get(key);
      if (existingRow) {
        proposalMechIds.push(existingRow.id);
        continue;
      }
      inserts.push({
        space_id: spaceId,
        user_id: userId,
        name: nameForMechanism(proposal, kind),
        description: proposal.description,
        kind,
        cycle_pattern: null,
        rationale: rationaleForMechanism(proposal, kind),
        source_infrastructure_proposal_id: proposal.id,
        source_strategy_version: strategyVersion ?? null,
        agent_assignments: proposal.agent_specs ?? [],
        status: "proposed",
      });
    }

    mechanismIdsByProposal.set(proposal.id, proposalMechIds);
  }

  // Insert in one round-trip; capture the new IDs and merge them into the map.
  if (inserts.length > 0) {
    const { data: inserted, error } = (await db
      .from("mechanisms")
      .insert(inserts)
      .select("*")) as { data: MechanismRow[] | null; error: unknown };

    if (error) {
      // Non-fatal: caller can decide whether to surface to the user.
      console.error("[materialize-mechanisms] insert failed:", error);
    } else if (inserted) {
      insertedCount = inserted.length;
      for (const row of inserted) {
        if (!row.source_infrastructure_proposal_id) continue;
        const list = mechanismIdsByProposal.get(row.source_infrastructure_proposal_id) ?? [];
        list.push(row.id);
        mechanismIdsByProposal.set(row.source_infrastructure_proposal_id, list);
      }
    }
  }

  const allMechanisms = [...(existing ?? []), ...((inserts.length > 0 ? [] : []) as MechanismRow[])];
  // Re-load the full set after insert to return up-to-date rows.
  const { data: full } = (await db
    .from("mechanisms")
    .select("*")
    .eq("space_id", spaceId)
    .in("source_infrastructure_proposal_id", proposalIds)) as {
    data: MechanismRow[] | null;
  };

  return {
    mechanisms: full ?? allMechanisms,
    mechanismIdsByProposal,
    insertedCount,
  };
}

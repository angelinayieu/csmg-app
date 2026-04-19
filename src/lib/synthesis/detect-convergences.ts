import type {
  Axiom,
  AssumptionInversion,
  InsightConvergence,
  ConvergenceSignal,
  ConvergenceSignalType,
  HiddenSignalData,
  RichBottleneck,
  RichLeveragePoint,
  RichOpenQuestion,
  RichRiskPoint,
  SignalToAction,
  WorthConsidering,
} from "@/types/synthesis";

interface DetectorInput {
  axioms?: Axiom[];
  master_bottleneck?: RichBottleneck | null;
  leverage_points?: RichLeveragePoint[];
  risk_points?: RichRiskPoint[];
  hidden_signals?: HiddenSignalData[];
  signal_to_action?: SignalToAction[];
  assumption_inversions?: AssumptionInversion[];
  worth_considering?: WorthConsidering[];
  open_questions?: RichOpenQuestion[];
}

interface EntityLookup {
  (entityId: string): string | null; // returns entity name or null
}

const MIN_CLUSTER_SIGNALS = 2;

function truncate(s: string, n = 120): string {
  if (!s) return "";
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/**
 * Collects all structured insights into a flat signal list with attached entity anchors.
 * Signals without entity anchors are returned but will not participate in entity-overlap
 * clustering (caller handles them separately).
 */
function extractSignals(input: DetectorInput): ConvergenceSignal[] {
  const signals: ConvergenceSignal[] = [];

  for (const ax of input.axioms ?? []) {
    // Frame-scope axioms anchor only abstractly; node/edge/chain scopes have real anchors.
    const entityIds = ax.scope === "frame" ? [] : [...ax.rests_on];
    signals.push({
      type: "axiom",
      id: ax.axiom_id,
      summary: truncate(ax.claim),
      entity_ids: entityIds,
    });
  }

  if (input.master_bottleneck?.entity_id) {
    signals.push({
      type: "bottleneck",
      id: `bottleneck:${input.master_bottleneck.entity_id}`,
      summary: truncate(input.master_bottleneck.summary ?? input.master_bottleneck.entity_id),
      entity_ids: [input.master_bottleneck.entity_id],
    });
  }

  for (const lp of input.leverage_points ?? []) {
    if (!lp.entity_id) continue;
    signals.push({
      type: "leverage",
      id: `leverage:${lp.entity_id}`,
      summary: truncate(lp.summary ?? lp.entity_name ?? lp.entity_id),
      entity_ids: [lp.entity_id],
    });
  }

  for (const rp of input.risk_points ?? []) {
    if (!rp.entity_id) continue;
    signals.push({
      type: "risk",
      id: `risk:${rp.entity_id}`,
      summary: truncate(rp.summary ?? rp.entity_name ?? rp.entity_id),
      entity_ids: [rp.entity_id],
    });
  }

  // Hidden signals + signal_to_action collapse into one "signal" type — signal_to_action
  // is a refinement of the same underlying mechanism, and counting them separately would
  // inflate convergence strength artificially.
  for (let i = 0; i < (input.hidden_signals ?? []).length; i++) {
    const s = input.hidden_signals![i];
    const eids = s.related_internal_entities ?? [];
    signals.push({
      type: "signal",
      id: `hidden:${i}`,
      summary: truncate(s.description ?? s.signal_name ?? `hidden signal ${i}`),
      entity_ids: eids,
    });
  }
  for (let i = 0; i < (input.signal_to_action ?? []).length; i++) {
    const s = input.signal_to_action![i];
    signals.push({
      type: "signal",
      id: `sta:${i}`,
      summary: truncate(s.signal),
      entity_ids: s.connected_entities ?? [],
    });
  }

  for (let i = 0; i < (input.assumption_inversions ?? []).length; i++) {
    const inv = input.assumption_inversions![i];
    if (!inv.target_entity_id) continue;
    signals.push({
      type: "inversion",
      id: `inv:${i}`,
      summary: truncate(inv.inverted_claim),
      entity_ids: [inv.target_entity_id],
    });
  }

  for (let i = 0; i < (input.worth_considering ?? []).length; i++) {
    const w = input.worth_considering![i];
    if (w.type !== "blind_spot") continue;
    const eids = w.connected_entities ?? [];
    if (eids.length === 0) continue;
    signals.push({
      type: "blind_spot",
      id: `wc:${i}`,
      summary: truncate(w.description ?? w.title),
      entity_ids: eids,
    });
  }

  for (let i = 0; i < (input.open_questions ?? []).length; i++) {
    const q = input.open_questions![i];
    const eids = q.related_entity_ids ?? [];
    if (eids.length === 0) continue;
    // Only cluster questions marked critical/high — medium-priority questions dilute clusters
    if (q.priority && q.priority !== "critical" && q.priority !== "high") continue;
    signals.push({
      type: "open_question",
      id: `oq:${i}`,
      summary: truncate(q.question),
      entity_ids: eids,
    });
  }

  return signals;
}

/**
 * Union-find over signals where two signals are in the same cluster iff they share ≥1
 * entity_id. Returns an array of clusters; singletons are excluded.
 */
function clusterByEntityOverlap(signals: ConvergenceSignal[]): ConvergenceSignal[][] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    while (parent.get(i)! !== i) {
      parent.set(i, parent.get(parent.get(i)!)!);
      i = parent.get(i)!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < signals.length; i++) parent.set(i, i);

  // Build entity -> indices index, union all indices that share an entity
  const entityIndex = new Map<string, number[]>();
  for (let i = 0; i < signals.length; i++) {
    for (const e of signals[i].entity_ids) {
      if (!entityIndex.has(e)) entityIndex.set(e, []);
      entityIndex.get(e)!.push(i);
    }
  }
  for (const indices of entityIndex.values()) {
    for (let k = 1; k < indices.length; k++) {
      union(indices[0], indices[k]);
    }
  }

  const groups = new Map<number, ConvergenceSignal[]>();
  for (let i = 0; i < signals.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(signals[i]);
  }

  return Array.from(groups.values()).filter((g) => g.length >= MIN_CLUSTER_SIGNALS);
}

function buildCluster(
  groupSignals: ConvergenceSignal[],
  index: number,
  lookupEntityName: EntityLookup,
  axioms: Axiom[],
): InsightConvergence {
  const typeSet = new Set<ConvergenceSignalType>(groupSignals.map((s) => s.type));

  const entityCounts = new Map<string, number>();
  for (const s of groupSignals) {
    for (const e of s.entity_ids) {
      entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
    }
  }
  const sharedEntities = Array.from(entityCounts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);

  const distinctTypeCount = typeSet.size;
  const signalCount = groupSignals.length;

  const strength: "strong" | "moderate" | "weak" =
    distinctTypeCount >= 4 || (distinctTypeCount >= 3 && signalCount >= 5)
      ? "strong"
      : distinctTypeCount >= 3 || signalCount >= 4
        ? "moderate"
        : "weak";

  const hiddenAxiomIds = new Set(
    axioms.filter((a) => a.visibility === "HIDDEN").map((a) => a.axiom_id),
  );
  const hasHiddenAxiom = groupSignals.some(
    (s) => s.type === "axiom" && hiddenAxiomIds.has(s.id),
  );

  // Label: top 1-2 shared entities by name; fallback to unique entity if no overlaps
  const labelEntityIds = sharedEntities.length > 0 ? sharedEntities.slice(0, 2) : [groupSignals[0].entity_ids[0]].filter(Boolean);
  const labelParts = labelEntityIds
    .map((e) => {
      const name = lookupEntityName(e);
      return name ? `${e} (${name})` : e;
    })
    .filter(Boolean);
  const concernLabel = labelParts.length > 0
    ? `Converging signals around ${labelParts.join(" + ")}`
    : `Convergence cluster ${index + 1}`;

  return {
    cluster_id: `conv:${index + 1}`,
    concern_label: concernLabel,
    shared_entity_ids: sharedEntities,
    signal_count: signalCount,
    distinct_type_count: distinctTypeCount,
    strength,
    signals: groupSignals,
    has_hidden_axiom: hasHiddenAxiom,
  };
}

export function detectInsightConvergences(
  input: DetectorInput,
  lookupEntityName: EntityLookup = () => null,
): InsightConvergence[] {
  const signals = extractSignals(input);
  if (signals.length < MIN_CLUSTER_SIGNALS) return [];

  const groups = clusterByEntityOverlap(signals);
  const axioms = input.axioms ?? [];

  const clusters = groups.map((g, i) => buildCluster(g, i, lookupEntityName, axioms));

  // Rank: strong first, then by distinct type count, then by signal count, then hidden-axiom tiebreak
  clusters.sort((a, b) => {
    const order = { strong: 0, moderate: 1, weak: 2 } as const;
    if (order[a.strength] !== order[b.strength]) return order[a.strength] - order[b.strength];
    if (a.distinct_type_count !== b.distinct_type_count) return b.distinct_type_count - a.distinct_type_count;
    if (a.signal_count !== b.signal_count) return b.signal_count - a.signal_count;
    if (a.has_hidden_axiom !== b.has_hidden_axiom) return a.has_hidden_axiom ? -1 : 1;
    return 0;
  });

  // Reassign cluster_id by final rank for stable UI numbering
  return clusters.map((c, i) => ({ ...c, cluster_id: `conv:${i + 1}` }));
}

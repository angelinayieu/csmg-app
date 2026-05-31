// ── Rich Narration Composer ───────────────────────────────────────
//
// Today every notebook row is a one-line headline ("Spec'd
// mechanism · Pomodoro Timer · evidence:plausible · 4 ingredients").
// The user has to click → focus canvas → open drawer → drill three
// layers deep to see what the spec actually says.
//
// This composer produces a `RichNarrationMeta` blob that extends
// `NotebookEventMeta` additively. Each stage in the pipeline calls
// its `narrate*` function and merges the result into the
// `logDecision({ metadata })` call. Old notebook code ignores the
// new fields gracefully; the parallel notebook redesign reads them
// to render chat-style content bodies + deep-link affordances.
//
// Why a NEW file: zero conflict with the parallel-owned
// `lab-notebook-panel.tsx` and `notebook-events.ts`. When the
// notebook redesign lands per NOTEBOOK_TIMELINE_PLAN.md, the
// `metadata.narration_*` keys are already populated for every row
// the redesign needs to render richly.
//
// Reference:
//   • INTAKE_TO_BRIEF_SURFACING_PLAN.md (where this fits)
//   • NOTEBOOK_TIMELINE_PLAN.md §3.4 (target row design)
//   • decision-log.ts:23-118 (the action set)
//   • notebook-events.ts:36-207 (the metadata interface this extends)

import type {
  MechanismDesignIntent,
  MechanismSpec,
} from "./enrich-mechanism-spec";

// ─── The narration shape ──────────────────────────────────────────

/** A deep-link target the notebook row can render as an action.
 *  The host (the page that mounts the notebook) wires `kind` →
 *  navigation behavior; the notebook itself just renders the
 *  affordance. */
export interface NarrationDeepLink {
  /** Where to land:
   *    • drawer  — open the entity's mechanism detail drawer
   *    • brief   — open the strategy brief at a specific section
   *    • view    — open a specific tab/view on a sub-objective
   *    • library — open the library and focus the object_id
   *                (typically the mechanism's library_objects row).
   *                From there the user can drag to the whiteboard. */
  kind: "drawer" | "brief" | "view" | "library";
  /** The entity to focus on, when applicable. */
  entity_id?: string;
  /** The sub-objective (room) to focus on, when applicable. */
  sub_objective_id?: string;
  /** The library_objects row id to focus on. Used when kind="library";
   *  the LibraryPanel scrolls to this object and selects it. */
  object_id?: string;
  /** When kind=drawer: which sub-view to scroll to. */
  drawer_section?:
    | "summary"
    | "experience"
    | "data_flow"
    | "engineering"
    | "decision_record"
    | "research_basis";
  /** When kind=brief: which anchor inside the brief to scroll to. */
  brief_anchor?:
    | "executive_summary"
    | "operating_context"
    | "strategic_threads"
    | "sub_objectives"
    | "next_move"
    | "open_items"
    | "agent_build_spec"
    | string;
  /** When kind=view: an arbitrary view id (e.g. a tab name). */
  view_id?: string;
  /** Optional display label override. The notebook uses this as the
   *  action button text when set. */
  label?: string;
}

/** A fact chip for the row body. Renders as "label · value" with
 *  optional tone (default neutral). */
export interface NarrationFact {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "warning" | "insight";
}

/** Additive metadata that any existing notebook action can carry.
 *  All fields optional. When the notebook redesign lands, rows
 *  whose metadata carries `narration_*` keys render as a chat-style
 *  body (title + paragraph + chips + deep-link); rows without these
 *  keys fall back to the existing one-line headline. */
export interface RichNarrationMeta {
  /** Chat-style row title. 1 sentence, ≤80 chars. Replaces the
   *  generic action label when present. */
  narration_title?: string;
  /** Body text — what the user reads without expanding. 2-3 short
   *  sentences, ≤240 chars total. Speaks in past tense from the
   *  agent's POV: "I generated a spec for ... and chose ... because
   *  ..." */
  narration_body?: string;
  /** Fact chips — concise numeric / categorical evidence. */
  narration_facts?: NarrationFact[];
  /** Optional deep-link the row's "Open" affordance navigates to. */
  narration_deep_link?: NarrationDeepLink;
  /** Filter hashtags. Used by the "Key moments" lens + future
   *  faceted filters. e.g. ["#design", "#decision", "#research"]. */
  narration_tags?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────

function clip(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  // Try to break at the nearest sentence / word boundary.
  const slice = trimmed.slice(0, max);
  const lastPeriod = slice.lastIndexOf(". ");
  if (lastPeriod >= max * 0.6) return slice.slice(0, lastPeriod + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= max * 0.7) return slice.slice(0, lastSpace).trim() + "…";
  return slice + "…";
}

/** Caption a `hero_pattern` slug as a short verb phrase the user
 *  reads naturally. */
function captionHeroPattern(pattern: MechanismDesignIntent["hero_pattern"]): string {
  switch (pattern) {
    case "metric":       return "moves a metric";
    case "flow":         return "transforms in a flow";
    case "cycle":        return "establishes a feedback loop";
    case "before_after": return "changes a state";
    case "evidence":     return "grounds in evidence";
    case "decision":     return "branches by decision";
  }
}

/** Caption a `density` slug. */
function captionDensity(density: MechanismDesignIntent["density"]): string {
  switch (density) {
    case "airy":        return "airy";
    case "comfortable": return "comfortable";
    case "dense":       return "dense";
  }
}

// ─── Composers per stage ─────────────────────────────────────────

/** mechanism_spec_generated — the richest event. Composes a body
 *  that surfaces: chosen algorithm + WHY, evidence strength, design
 *  intent (hero pattern), touchpoint count, the data-token surface
 *  (produces/consumes coverage). Lets the user read the spec's
 *  meaning without opening the drawer. */
export function narrateMechanismSpec(input: {
  spec: MechanismSpec;
  entity: { id: string; name: string };
  subObjectiveId?: string | null;
  subObjectiveTitle?: string | null;
  /** When provided, the chat row's primary deep-link routes to the
   *  library object (so the user can open the mechanism's card AND
   *  drag it onto the whiteboard). Falls back to the drawer
   *  experience tab when omitted (Step 8 behavior). */
  libraryObjectId?: string | null;
}): RichNarrationMeta {
  const { spec, entity, subObjectiveId } = input;

  // Title — names the entity, not the generic "Spec'd mechanism".
  const title = `Spec'd ${entity.name}`;

  // Body — 2-3 sentences with the load-bearing claims.
  const chosenMethod =
    spec.decision_record?.chosen?.trim() || "the default approach";
  const rationale = clip(
    spec.decision_record?.rationale?.trim() || "",
    160,
  );
  const moa = clip(spec.mechanism_of_action ?? "", 200);
  const bodyParts: string[] = [];
  if (moa) bodyParts.push(moa);
  if (chosenMethod && rationale) {
    bodyParts.push(`Chose ${chosenMethod} — ${rationale}`);
  } else if (chosenMethod) {
    bodyParts.push(`Chose ${chosenMethod}.`);
  }
  const body = clip(bodyParts.join(" "), 240);

  // Facts — quality, evidence, design intent, touchpoints.
  const axes = Object.values(spec.quality_score ?? {});
  const minAxis = axes.length > 0 ? Math.min(...axes) : 0.7;
  const visibleSteps = (spec.runtime_flow ?? []).filter(
    (s) =>
      s.visual_intent != null && !!s.user_sees && s.user_sees !== "—",
  );
  const facts: NarrationFact[] = [];
  facts.push({
    label: "Confidence",
    value: `${Math.round(minAxis * 100)}%`,
    tone:
      minAxis >= 0.75 ? "positive" : minAxis >= 0.6 ? "neutral" : "warning",
  });
  facts.push({
    label: "Evidence",
    value: spec.research_basis?.evidence_strength ?? "plausible",
    tone:
      spec.research_basis?.evidence_strength === "established"
        ? "positive"
        : spec.research_basis?.evidence_strength === "speculative"
          ? "warning"
          : "neutral",
  });
  if (spec.design_intent) {
    facts.push({
      label: "Design",
      value: `${captionHeroPattern(spec.design_intent.hero_pattern)} · ${captionDensity(spec.design_intent.density)}`,
      tone: "insight",
    });
  }
  if (visibleSteps.length > 0) {
    facts.push({
      label: "Touchpoints",
      value: `${visibleSteps.length} user-visible`,
      tone: "neutral",
    });
  }
  if ((spec.active_ingredients ?? []).length > 0) {
    facts.push({
      label: "Ingredients",
      value: String(spec.active_ingredients.length),
      tone: "neutral",
    });
  }
  // Data-token surface (the produces/consumes spine).
  const allTokens = (spec.runtime_flow ?? []).flatMap((s) => [
    ...(s.produces ?? []),
    ...(s.consumes ?? []),
  ]);
  if (allTokens.length > 0) {
    const unique = new Set(allTokens).size;
    facts.push({
      label: "Data tokens",
      value: String(unique),
      tone: "neutral",
    });
  }
  // v3 — Claude-composed design artifact (Step 16). When present,
  // surfaces the caption + section count as evidence the artifact
  // was actually composed (vs derived fallback). The artifact's
  // existence in the chat lets the user know there's a premium
  // designed poster waiting in the brief.
  if (spec.design_artifact) {
    const sectionCount = spec.design_artifact.sections?.length ?? 0;
    if (sectionCount > 0) {
      facts.push({
        label: "Sections",
        value: String(sectionCount),
        tone: "insight",
      });
    }
    if (spec.design_artifact.caption) {
      facts.push({
        label: "Artifact",
        value: clip(spec.design_artifact.caption, 60),
        tone: "insight",
      });
    }
  }

  const tags: string[] = ["#mechanism"];
  if (spec.design_intent) tags.push("#design");
  if (spec.design_artifact) tags.push("#artifact");
  if (spec.decision_record?.chosen) tags.push("#decision");
  if (spec.research_basis?.evidence_strength === "established") {
    tags.push("#established");
  }

  // Pick the most useful deep-link target: prefer the library so the
  // user can drag the mechanism's card onto the whiteboard, falling
  // back to the drawer's experience tab when the library object id
  // isn't available yet (legacy specs before library upsert).
  const deepLink: NarrationDeepLink = input.libraryObjectId
    ? {
        kind: "library",
        object_id: input.libraryObjectId,
        entity_id: entity.id,
        sub_objective_id: subObjectiveId ?? undefined,
        label: "Open in library",
      }
    : {
        kind: "drawer",
        entity_id: entity.id,
        sub_objective_id: subObjectiveId ?? undefined,
        drawer_section: spec.design_intent ? "experience" : "summary",
        label: "Open mechanism",
      };

  return {
    narration_title: clip(title, 80),
    narration_body: body,
    narration_facts: facts,
    narration_deep_link: deepLink,
    narration_tags: tags,
  };
}

/** chains_enriched — names which chains gained narrative + which
 *  weak points the enrichment surfaced. */
export function narrateChainsEnriched(input: {
  enrichedCount: number;
  newCount?: number;
  avgStrength?: number;
  orphansClosed?: number;
  subObjectiveId?: string | null;
  subObjectiveTitle?: string | null;
}): RichNarrationMeta {
  const { enrichedCount, newCount = 0, avgStrength, orphansClosed = 0 } = input;
  const title = input.subObjectiveTitle
    ? `Enriched chains in ${input.subObjectiveTitle}`
    : "Enriched causal chains";

  const bodyParts: string[] = [];
  bodyParts.push(
    `Walked ${enrichedCount} chain${enrichedCount === 1 ? "" : "s"}, adding mediators + chain strength.`,
  );
  if (newCount > 0) {
    bodyParts.push(
      `Proposed ${newCount} net-new chain${newCount === 1 ? "" : "s"} for orphaned items.`,
    );
  }
  if (orphansClosed > 0) {
    bodyParts.push(
      `Closed ${orphansClosed} orphan${orphansClosed === 1 ? "" : "s"} — they're now part of a chain.`,
    );
  }

  const facts: NarrationFact[] = [
    { label: "Enriched", value: String(enrichedCount), tone: "neutral" },
  ];
  if (typeof avgStrength === "number") {
    facts.push({
      label: "Avg strength",
      value: avgStrength.toFixed(2),
      tone:
        avgStrength >= 0.7
          ? "positive"
          : avgStrength >= 0.5
            ? "neutral"
            : "warning",
    });
  }
  if (newCount > 0) {
    facts.push({
      label: "New chains",
      value: `+${newCount}`,
      tone: "positive",
    });
  }

  return {
    narration_title: clip(title, 80),
    narration_body: clip(bodyParts.join(" "), 240),
    narration_facts: facts,
    narration_deep_link: input.subObjectiveId
      ? {
          kind: "view",
          sub_objective_id: input.subObjectiveId,
          view_id: "chains",
          label: "Open chains",
        }
      : undefined,
    narration_tags: ["#chains", "#enrichment"],
  };
}

/** scan_complete — narrates findings count and what was new since
 *  the prior scan. */
export function narrateScanComplete(input: {
  findingCount: number;
  newFindingCount?: number;
  resolvedCount?: number;
  topFindings?: Array<{ title: string; severity?: string }>;
}): RichNarrationMeta {
  const { findingCount, newFindingCount = 0, resolvedCount = 0 } = input;

  const bodyParts: string[] = [];
  if (newFindingCount > 0) {
    bodyParts.push(
      `Surfaced ${newFindingCount} new finding${newFindingCount === 1 ? "" : "s"} from the cross-room scan.`,
    );
  } else if (findingCount === 0) {
    bodyParts.push(
      "Scanned across rooms — no contradictions or weak edges found.",
    );
  } else {
    bodyParts.push(
      `Re-scanned ${findingCount} finding${findingCount === 1 ? "" : "s"}; nothing new this pass.`,
    );
  }
  if (input.topFindings && input.topFindings.length > 0) {
    const top = input.topFindings[0];
    bodyParts.push(`Top: ${clip(top.title, 100)}.`);
  }
  if (resolvedCount > 0) {
    bodyParts.push(
      `${resolvedCount} prior finding${resolvedCount === 1 ? "" : "s"} resolved.`,
    );
  }

  const facts: NarrationFact[] = [
    { label: "Findings", value: String(findingCount), tone: "neutral" },
  ];
  if (newFindingCount > 0) {
    facts.push({
      label: "New",
      value: `+${newFindingCount}`,
      tone: "warning",
    });
  }
  if (resolvedCount > 0) {
    facts.push({
      label: "Resolved",
      value: String(resolvedCount),
      tone: "positive",
    });
  }

  return {
    narration_title: "Cross-room scan",
    narration_body: clip(bodyParts.join(" "), 240),
    narration_facts: facts,
    narration_tags: ["#scan", newFindingCount > 0 ? "#new" : "#stable"],
  };
}

/** research_completed (Cooperation Plan v2 Fix A) — narrates the
 *  per-feature research stage. Fired from /api/brainstorm/item/research
 *  whether triggered by the canvas autopilot's research stage, the
 *  drawer's lazy fetch, or room-gen's fire-and-forget pre-warm.
 *
 *  Body tells the user the research now exists so downstream stages
 *  (rubric scoring, mechanism-spec) have grounding. Cached re-fires
 *  produce a softer "already on file" body so the notebook doesn't
 *  spam identical research events on autopilot re-runs. */
export function narrateResearch(input: {
  entityName: string;
  technicalCount: number;
  designCount: number;
  cached?: boolean;
}): RichNarrationMeta {
  const { entityName, technicalCount, designCount, cached = false } = input;
  const total = technicalCount + designCount;

  const bodyParts: string[] = [];
  if (cached) {
    bodyParts.push(
      `Research already on file for ${clip(entityName, 60)} (${total} source${total === 1 ? "" : "s"} cached).`,
    );
  } else if (total === 0) {
    bodyParts.push(
      `Research pass for ${clip(entityName, 60)} returned no sources — the LLM will score without precedents.`,
    );
  } else {
    const parts: string[] = [];
    if (technicalCount > 0) {
      parts.push(
        `${technicalCount} technical precedent${technicalCount === 1 ? "" : "s"}`,
      );
    }
    if (designCount > 0) {
      parts.push(
        `${designCount} design reference${designCount === 1 ? "" : "s"}`,
      );
    }
    bodyParts.push(
      `Pulled ${parts.join(" + ")} for ${clip(entityName, 60)} — feeding score grounding.`,
    );
  }

  const facts: NarrationFact[] = [];
  if (technicalCount > 0) {
    facts.push({
      label: "Technical",
      value: String(technicalCount),
      tone: "neutral",
    });
  }
  if (designCount > 0) {
    facts.push({
      label: "Design",
      value: String(designCount),
      tone: "neutral",
    });
  }
  if (cached) {
    facts.push({ label: "Source", value: "cached", tone: "neutral" });
  }

  return {
    narration_title: cached
      ? `Research cached · ${clip(entityName, 50)}`
      : total === 0
        ? `Research empty · ${clip(entityName, 50)}`
        : `Researched · ${clip(entityName, 50)}`,
    narration_body: clip(bodyParts.join(" "), 240),
    narration_facts: facts,
    narration_tags: [
      "#research",
      cached ? "#cached" : total === 0 ? "#empty" : "#fresh",
    ],
  };
}

/** room_generated — narrates room composition (pain/feature/outcome
 *  counts) and a one-line preview. */
export function narrateRoomGenerated(input: {
  subObjectiveId: string;
  subObjectiveTitle: string;
  painCount: number;
  featureCount: number;
  outcomeCount: number;
  edgeCount?: number;
  topNegativeOutcome?: string;
}): RichNarrationMeta {
  const {
    painCount,
    featureCount,
    outcomeCount,
    edgeCount = 0,
    topNegativeOutcome,
  } = input;

  const title = `Generated ${input.subObjectiveTitle}`;
  const bodyParts: string[] = [
    `Built the room: ${painCount} pain${painCount === 1 ? "" : "s"}, ${featureCount} mechanism${featureCount === 1 ? "" : "s"}, ${outcomeCount} outcome${outcomeCount === 1 ? "" : "s"}, ${edgeCount} edge${edgeCount === 1 ? "" : "s"}.`,
  ];
  if (topNegativeOutcome) {
    bodyParts.push(`Most painful: ${clip(topNegativeOutcome, 140)}.`);
  }

  return {
    narration_title: clip(title, 80),
    narration_body: clip(bodyParts.join(" "), 240),
    narration_facts: [
      { label: "Pains", value: String(painCount), tone: "warning" },
      { label: "Mechanisms", value: String(featureCount), tone: "insight" },
      { label: "Outcomes", value: String(outcomeCount), tone: "positive" },
    ],
    narration_deep_link: {
      kind: "view",
      sub_objective_id: input.subObjectiveId,
      view_id: "room",
      label: "Open room",
    },
    narration_tags: ["#room", "#generated"],
  };
}

/** brief_polished — surfaces the tldr verbatim AND links into the
 *  brief. This is the single most important narration in the whole
 *  pipeline — it's the user's "Your strategy is ready" moment. */
export function narrateBriefPolished(input: {
  tldr: string;
  tldrSentenceCount?: number;
  featureCount?: number;
  roomCount?: number;
}): RichNarrationMeta {
  const facts: NarrationFact[] = [];
  if (typeof input.tldrSentenceCount === "number") {
    facts.push({
      label: "TL;DR length",
      value: `${input.tldrSentenceCount} sentence${input.tldrSentenceCount === 1 ? "" : "s"}`,
      tone: "neutral",
    });
  }
  if (typeof input.featureCount === "number") {
    facts.push({
      label: "Features",
      value: String(input.featureCount),
      tone: "neutral",
    });
  }
  if (typeof input.roomCount === "number") {
    facts.push({
      label: "Rooms",
      value: String(input.roomCount),
      tone: "neutral",
    });
  }

  return {
    narration_title: "Your strategy brief is ready",
    // The tldr IS the body — the user reads the conclusion right
    // there in the chat, no clicks required.
    narration_body: clip(input.tldr, 320),
    narration_facts: facts,
    narration_deep_link: {
      kind: "brief",
      brief_anchor: "executive_summary",
      label: "Open the brief",
    },
    narration_tags: ["#brief", "#ready", "#deliverable"],
  };
}

/** deliverable_generated — narrates which artifact was produced and
 *  links to its detail surface. */
export function narrateDeliverableGenerated(input: {
  subtype:
    | "mockup"
    | "export_prompt"
    | "description_doc"
    | "prototype_brief"
    | "agent_spec";
  entityId?: string;
  entityName?: string;
  size?: string;
}): RichNarrationMeta {
  const LABEL: Record<typeof input.subtype, string> = {
    mockup: "Built a mockup",
    export_prompt: "Built an export prompt",
    description_doc: "Built a description doc",
    prototype_brief: "Built a prototype brief",
    agent_spec: "Built an agent build spec",
  };
  const NOUN: Record<typeof input.subtype, string> = {
    mockup: "mockup",
    export_prompt: "export prompt",
    description_doc: "description doc",
    prototype_brief: "prototype brief",
    agent_spec: "agent build spec",
  };

  const title = LABEL[input.subtype];
  const bodyParts: string[] = [];
  if (input.entityName) {
    bodyParts.push(`For ${input.entityName}.`);
  }
  bodyParts.push(
    `A ${NOUN[input.subtype]} is ready — open it to review or hand off.`,
  );

  return {
    narration_title: title,
    narration_body: clip(bodyParts.join(" "), 240),
    narration_facts: input.size
      ? [{ label: "Size", value: input.size, tone: "neutral" }]
      : undefined,
    narration_deep_link:
      input.subtype === "agent_spec"
        ? {
            kind: "brief",
            brief_anchor: "agent_build_spec",
            label: "Open agent spec",
          }
        : input.entityId
          ? {
              kind: "drawer",
              entity_id: input.entityId,
              drawer_section: "summary",
              label: "Open detail",
            }
          : undefined,
    narration_tags: ["#deliverable", `#${input.subtype}`],
  };
}

/** annotations_generated — names the scope + count, and surfaces a
 *  few of the extracted concepts as preview text. */
export function narrateAnnotationsGenerated(input: {
  scope: "objective" | "sub";
  subObjectiveId?: string | null;
  phraseCount: number;
  previewPhrases?: string[];
}): RichNarrationMeta {
  const where =
    input.scope === "objective"
      ? "from your objective"
      : "from this sub-objective";
  const title = `Extracted ${input.phraseCount} concept${input.phraseCount === 1 ? "" : "s"} ${where}`;
  const preview = (input.previewPhrases ?? []).slice(0, 3).join(", ");
  const bodyParts: string[] = [];
  if (preview) {
    bodyParts.push(`Including ${preview}.`);
  }
  bodyParts.push(
    "These anchor every downstream room so the pipeline reasons about the same things.",
  );

  return {
    narration_title: clip(title, 80),
    narration_body: clip(bodyParts.join(" "), 240),
    narration_facts: [
      {
        label: "Concepts",
        value: String(input.phraseCount),
        tone: "neutral",
      },
    ],
    narration_deep_link:
      input.scope === "sub" && input.subObjectiveId
        ? {
            kind: "view",
            sub_objective_id: input.subObjectiveId,
            view_id: "definition",
            label: "Open definition",
          }
        : undefined,
    narration_tags: ["#annotations", `#${input.scope}`],
  };
}

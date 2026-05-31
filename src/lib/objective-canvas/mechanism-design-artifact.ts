// ── Mechanism Design Artifact ─────────────────────────────────────
//
// The "Claude generates the final design artifact" closure to the
// user's original ask (session-1 message): generate UI artifacts
// that look "really cool and nice, not choppy ugly basic." We
// honored that for safety via a STRUCTURED artifact format rather
// than raw JSX strings — Claude composes the design at the section
// level (which sections, what headline copy, which layout primitive
// per section), and a hand-written renderer maps each section type
// to premium React.
//
// Why this over raw JSX:
//   • No eval / sandbox / XSS surface
//   • No runtime dependency (no Sandpack, no react-live)
//   • Claude still gets real compositional control:
//       - Picks which sections appear (hero, moment, quote, stats…)
//       - Writes headline / sub / micro-copy
//       - Picks layout primitive per section
//       - Picks tone per callout
//   • The renderer enforces design discipline (glass tokens, accent
//     palette, type rhythm) — so no Claude pick can produce a
//     "cheap" result
//
// Sits alongside `design_intent` (which captures the GLOBAL tokens
// for the mechanism — accent / glass / density / motion / hero_pattern).
// The artifact INHERITS from design_intent and adds per-section
// composition.
//
// Cost: one extra Claude Sonnet call per mechanism (~$0.06). Opt out
// via env `USE_CLAUDE_DESIGN_ARTIFACT=false`.
//
// Reference:
//   • MECHANISM_EXPERIENCE_SPEC.md (the v3 design intent foundation)
//   • Session 1 user message ("create the final jsx artifacts and
//     also make the designs look better")

import { llmGenerate } from "@/lib/llm";
import type {
  MechanismDesignIntent,
  MechanismSpec,
} from "./enrich-mechanism-spec";

// ─── Section types ───────────────────────────────────────────────

export type DesignToneKind = "neutral" | "positive" | "warning" | "insight";

export type SurfaceKind =
  | "screen"
  | "notification"
  | "ambient"
  | "physical"
  | "background";

/** Hero section — the headline composition. */
export interface DesignSectionHero {
  kind: "hero";
  /** Inherits from `MechanismDesignIntent.hero_pattern` but Claude
   *  may override based on the mechanism's actual nature. */
  pattern: MechanismDesignIntent["hero_pattern"];
  /** Big headline — Claude composes this. ≤80 chars. */
  headline: string;
  /** Optional subhead / lead context. ≤160 chars. */
  subhead: string | null;
  /** When pattern === "metric", the central numeric. */
  metric: {
    /** The number itself ("78%", "3 sessions", "12m"). */
    value: string;
    /** Optional delta with direction ("+12 from baseline"). */
    delta: string | null;
    /** Optional unit / sub-label below the value. */
    label: string | null;
  } | null;
  /** When pattern === "evidence", an optional citation hint
   *  ("DOI 10.1109/…", "fluency studies, Bjork et al."). */
  citation: string | null;
}

/** Moment section — one user-experience moment with eyebrow + body. */
export interface DesignSectionMoment {
  kind: "moment";
  /** Optional eyebrow above the title. ≤24 chars. */
  eyebrow: string | null;
  /** Moment title. ≤80 chars. */
  title: string;
  /** Moment body — 1-2 short sentences. ≤220 chars. */
  body: string;
  /** What kind of surface this moment lives on. */
  surface: SurfaceKind;
}

/** Pull-quote section. */
export interface DesignSectionQuote {
  kind: "quote";
  /** The pull quote text. ≤240 chars. */
  text: string;
  /** Optional attribution. */
  attribution: string | null;
}

/** Flow section — ordered user actions. */
export interface DesignSectionFlow {
  kind: "flow";
  eyebrow: string | null;
  /** 3-5 ordered steps. */
  steps: Array<{
    /** Imperative verb opening: "Tap", "Drag", "See", "Hear". */
    verb: string;
    /** What happens at this step. ≤120 chars. */
    what: string;
    /** How it feels — one phrase. ≤80 chars. */
    feels: string;
  }>;
}

/** Stats section — small numeric grid (2-4 items). */
export interface DesignSectionStats {
  kind: "stats";
  eyebrow: string | null;
  items: Array<{
    value: string;
    label: string;
    tone: DesignToneKind;
  }>;
}

/** Callout section — single boxed line with tone. */
export interface DesignSectionCallout {
  kind: "callout";
  text: string;
  tone: DesignToneKind;
}

/** Before/after section. */
export interface DesignSectionBeforeAfter {
  kind: "before_after";
  before: {
    state: string;
    feels: string;
  };
  after: {
    state: string;
    feels: string;
  };
}

export type DesignSection =
  | DesignSectionHero
  | DesignSectionMoment
  | DesignSectionQuote
  | DesignSectionFlow
  | DesignSectionStats
  | DesignSectionCallout
  | DesignSectionBeforeAfter;

/** The composed artifact. */
export interface DesignArtifact {
  /** Inherits the mechanism's design_intent (tokens for accent, glass
   *  tier, density, motion). The artifact's sections are rendered
   *  using these tokens. */
  intent: MechanismDesignIntent;
  /** Composed sections in render order. 2-5 typical. */
  sections: DesignSection[];
  /** Single-line caption Claude composed about the WHOLE artifact —
   *  surfaces in the brief / chat above the artifact body
   *  ("Designed as a calm, evidence-anchored sequence."). */
  caption: string;
}

// ─── Allowed enums (used by the parser) ──────────────────────────

const SURFACE_KIND_ALLOWED = new Set<SurfaceKind>([
  "screen",
  "notification",
  "ambient",
  "physical",
  "background",
]);

const TONE_ALLOWED = new Set<DesignToneKind>([
  "neutral",
  "positive",
  "warning",
  "insight",
]);

const HERO_PATTERN_ALLOWED = new Set<MechanismDesignIntent["hero_pattern"]>([
  "metric",
  "flow",
  "cycle",
  "before_after",
  "evidence",
  "decision",
]);

// ─── Parser ──────────────────────────────────────────────────────

function clipString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

function parseHero(raw: Record<string, unknown>): DesignSectionHero | null {
  const pattern = clipString(raw.pattern, 40);
  if (
    !pattern ||
    !HERO_PATTERN_ALLOWED.has(pattern as MechanismDesignIntent["hero_pattern"])
  ) {
    return null;
  }
  const headline = clipString(raw.headline, 80);
  if (!headline) return null;
  const subhead = clipString(raw.subhead, 160);
  let metric: DesignSectionHero["metric"] = null;
  if (raw.metric && typeof raw.metric === "object") {
    const m = raw.metric as Record<string, unknown>;
    const value = clipString(m.value, 32);
    if (value) {
      metric = {
        value,
        delta: clipString(m.delta, 48),
        label: clipString(m.label, 48),
      };
    }
  }
  const citation = clipString(raw.citation, 120);
  return {
    kind: "hero",
    pattern: pattern as MechanismDesignIntent["hero_pattern"],
    headline,
    subhead,
    metric,
    citation,
  };
}

function parseMoment(
  raw: Record<string, unknown>,
): DesignSectionMoment | null {
  const title = clipString(raw.title, 80);
  if (!title) return null;
  const body = clipString(raw.body, 220);
  if (!body) return null;
  const surfaceRaw = clipString(raw.surface, 32) ?? "screen";
  const surface: SurfaceKind = SURFACE_KIND_ALLOWED.has(surfaceRaw as SurfaceKind)
    ? (surfaceRaw as SurfaceKind)
    : "screen";
  return {
    kind: "moment",
    eyebrow: clipString(raw.eyebrow, 24),
    title,
    body,
    surface,
  };
}

function parseQuote(raw: Record<string, unknown>): DesignSectionQuote | null {
  const text = clipString(raw.text, 240);
  if (!text) return null;
  return {
    kind: "quote",
    text,
    attribution: clipString(raw.attribution, 80),
  };
}

function parseFlow(raw: Record<string, unknown>): DesignSectionFlow | null {
  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: DesignSectionFlow["steps"] = [];
  for (const s of stepsRaw) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const verb = clipString(r.verb, 24);
    const what = clipString(r.what, 120);
    const feels = clipString(r.feels, 80);
    if (verb && what && feels) {
      steps.push({ verb, what, feels });
    }
    if (steps.length >= 5) break;
  }
  if (steps.length < 2) return null; // a flow needs at least 2 steps
  return {
    kind: "flow",
    eyebrow: clipString(raw.eyebrow, 24),
    steps,
  };
}

function parseStats(raw: Record<string, unknown>): DesignSectionStats | null {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items: DesignSectionStats["items"] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const value = clipString(r.value, 32);
    const label = clipString(r.label, 48);
    if (!value || !label) continue;
    const toneRaw = clipString(r.tone, 16) ?? "neutral";
    const tone: DesignToneKind = TONE_ALLOWED.has(toneRaw as DesignToneKind)
      ? (toneRaw as DesignToneKind)
      : "neutral";
    items.push({ value, label, tone });
    if (items.length >= 4) break;
  }
  if (items.length < 2) return null; // stats need at least 2 items
  return {
    kind: "stats",
    eyebrow: clipString(raw.eyebrow, 24),
    items,
  };
}

function parseCallout(
  raw: Record<string, unknown>,
): DesignSectionCallout | null {
  const text = clipString(raw.text, 200);
  if (!text) return null;
  const toneRaw = clipString(raw.tone, 16) ?? "neutral";
  const tone: DesignToneKind = TONE_ALLOWED.has(toneRaw as DesignToneKind)
    ? (toneRaw as DesignToneKind)
    : "neutral";
  return { kind: "callout", text, tone };
}

function parseBeforeAfter(
  raw: Record<string, unknown>,
): DesignSectionBeforeAfter | null {
  if (!raw.before || !raw.after) return null;
  const b = raw.before as Record<string, unknown>;
  const a = raw.after as Record<string, unknown>;
  const bState = clipString(b.state, 100);
  const bFeels = clipString(b.feels, 100);
  const aState = clipString(a.state, 100);
  const aFeels = clipString(a.feels, 100);
  if (!bState || !aState || !bFeels || !aFeels) return null;
  return {
    kind: "before_after",
    before: { state: bState, feels: bFeels },
    after: { state: aState, feels: aFeels },
  };
}

function parseSection(raw: unknown): DesignSection | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind : "";
  switch (kind) {
    case "hero":         return parseHero(obj);
    case "moment":       return parseMoment(obj);
    case "quote":        return parseQuote(obj);
    case "flow":         return parseFlow(obj);
    case "stats":        return parseStats(obj);
    case "callout":      return parseCallout(obj);
    case "before_after": return parseBeforeAfter(obj);
    default:             return null;
  }
}

/** Parse Claude's JSON output. Tolerates leading/trailing whitespace
 *  and optional code fences. Returns null on parse failure or when
 *  no valid sections survive. */
export function parseDesignArtifact(
  raw: string,
  intent: MechanismDesignIntent,
): DesignArtifact | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const caption = clipString(obj.caption, 160) ?? "";
    if (!caption) return null;
    const rawSections = Array.isArray(obj.sections) ? obj.sections : [];
    const sections: DesignSection[] = [];
    for (const s of rawSections) {
      const parsed = parseSection(s);
      if (parsed) sections.push(parsed);
      if (sections.length >= 6) break;
    }
    if (sections.length < 2) return null; // an artifact needs ≥2 sections
    return { intent, sections, caption };
  } catch {
    return null;
  }
}

// ─── Prompt builder ──────────────────────────────────────────────

function buildDesignArtifactPrompt(spec: MechanismSpec): {
  system: string;
  user: string;
} {
  const di = spec.design_intent!;
  const visibleSteps = (spec.runtime_flow ?? [])
    .filter((s) => !!s.user_sees && s.user_sees !== "—")
    .slice(0, 6)
    .map(
      (s, i) =>
        `  ${i + 1}. ${s.step} → user sees: ${s.user_sees}${s.visual_intent ? ` [surface: ${s.visual_intent}]` : ""}${s.interaction_sketch ? `\n     sketch: ${s.interaction_sketch}` : ""}`,
    )
    .join("\n");

  const system = `You are a senior UI/UX design director. The UI skill pack above is your operating manual.

Given a MECHANISM, COMPOSE 2-5 sections that, when rendered as a designed card, produce a premium, calm, intentional artifact. NOT a wireframe — a designed POSTER for the mechanism, the kind a senior designer would write for an internal review.

You may use these section kinds:
  • hero          — the headline composition. ONE per artifact, always FIRST. Picks a "pattern" from {metric, flow, cycle, before_after, evidence, decision}. Writes the headline + optional subhead. For "metric" pattern, includes a metric.value (the number). For "evidence" pattern, may include a short citation hint.
  • moment        — one user-experience moment. Eyebrow + title + 1-2 sentence body + surface kind {screen, notification, ambient, physical, background}.
  • quote         — a pull-quote that crystallizes the mechanism's meaning. May include attribution.
  • flow          — 3-5 ordered steps describing the user's path. Each step has {verb, what, feels}.
  • stats         — 2-4 small stats with {value, label, tone}.
  • callout       — single boxed line of guidance/honesty with tone.
  • before_after  — a split panel; each side has {state, feels}.

Rules:
  • EXACTLY ONE hero, always FIRST.
  • 2-5 total sections (hero + 1-4 others). Don't over-compose; lean on whitespace.
  • Section copy must be ABOUT THIS MECHANISM specifically — never generic platitudes.
  • Headlines: tight, evocative, present tense. Not titles like "Pomodoro Timer" — read more like "Twenty-five minutes the deck stops shuffling."
  • Moment titles: imagistic, like chapter headings.
  • Flow verbs: imperative ("Flick", "Tap", "Hum", "Watch", "Sense"), not generic ("Use", "Click").
  • Feels phrases: sensory ("a soft settle", "the periphery dims", "a faint pull toward the next").
  • Callouts: candid, never marketing voice. Warning tone reserved for real risks; positive tone reserved for honest gains.

Return STRICT JSON in this shape (no markdown, no code fences, no prose):
{
  "caption": "<one-line caption describing the artifact as a whole, ≤120 chars>",
  "sections": [
    { "kind": "hero", "pattern": "...", "headline": "...", "subhead": "..."|null, "metric": {...}|null, "citation": "..."|null },
    { "kind": "moment", "eyebrow": "..."|null, "title": "...", "body": "...", "surface": "..." },
    { "kind": "quote", "text": "...", "attribution": "..."|null },
    { "kind": "flow", "eyebrow": "..."|null, "steps": [{ "verb": "...", "what": "...", "feels": "..." }] },
    { "kind": "stats", "eyebrow": "..."|null, "items": [{ "value": "...", "label": "...", "tone": "..." }] },
    { "kind": "callout", "text": "...", "tone": "..." },
    { "kind": "before_after", "before": { "state": "...", "feels": "..." }, "after": { "state": "...", "feels": "..." } }
  ]
}

(Only include the sections you actually compose. ALWAYS include caption.)`;

  const user = `MECHANISM: ${spec.mechanism_of_action.slice(0, 600)}

USER-VISIBLE BEHAVIOR: ${spec.user_visible_behavior || "(none specified)"}

RUNTIME FLOW (user-visible only):
${visibleSteps || "  (no user-visible steps — purely internal)"}

ACTIVE INGREDIENTS:
${(spec.active_ingredients ?? [])
  .slice(0, 4)
  .map((i) => `  • ${i.name} — ${i.role}`)
  .join("\n") || "  (none)"}

DESIGN INTENT (Claude-refined):
  hero_pattern: ${di.hero_pattern}
  accent_intent: ${di.accent_intent}
  density: ${di.density}
  motion_intent: ${di.motion_intent}

EVIDENCE: ${spec.research_basis.evidence_strength}
RESEARCH BASIS: ${spec.research_basis.basis.slice(0, 280)}

Compose the artifact as STRICT JSON. Premium, specific, calm.`;

  return { system, user };
}

// ─── Public generator ────────────────────────────────────────────

const CLAUDE_ARTIFACT_MODEL = "claude-3-5-sonnet-20241022";

/** Compose a `DesignArtifact` for the mechanism via Claude Sonnet.
 *  Returns null on any failure (parse failure, Anthropic unavailable,
 *  quota error). Soft-fail by design — the spec's design_intent is
 *  always available as the renderer's fallback substrate. */
export async function composeDesignArtifactWithClaude(
  spec: MechanismSpec,
  uiSkillPrefix: string,
): Promise<DesignArtifact | null> {
  if (!spec.design_intent) return null;
  try {
    const { system, user } = buildDesignArtifactPrompt(spec);
    const raw = await llmGenerate({
      provider: "anthropic",
      model: CLAUDE_ARTIFACT_MODEL,
      system: uiSkillPrefix + system,
      user,
      temperature: 0.6,
      maxTokens: 2200,
    });
    return parseDesignArtifact(raw, spec.design_intent);
  } catch (err) {
    console.warn(
      "[mechanism-design-artifact] composition failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ─── Default fallback (derived from design_intent + spec) ────────

/** Build a minimal artifact from the spec's existing fields when
 *  Claude is unavailable or disabled. Lets the renderer have
 *  SOMETHING to show even without Claude — degrades to "designed
 *  enough" rather than "missing entirely". */
export function fallbackDesignArtifactFromSpec(
  spec: MechanismSpec,
): DesignArtifact | null {
  if (!spec.design_intent) return null;
  const di = spec.design_intent;
  const visibleSteps = (spec.runtime_flow ?? []).filter(
    (s) => !!s.user_sees && s.user_sees !== "—",
  );
  const sections: DesignSection[] = [
    {
      kind: "hero",
      pattern: di.hero_pattern,
      headline: spec.user_visible_behavior?.slice(0, 80) || spec.mechanism_of_action.slice(0, 80),
      subhead:
        spec.mechanism_of_action.length > 80
          ? spec.mechanism_of_action.slice(80, 240).trim() || null
          : null,
      metric: null,
      citation: null,
    },
  ];
  if (visibleSteps.length >= 2) {
    sections.push({
      kind: "flow",
      eyebrow: "Path",
      steps: visibleSteps.slice(0, 5).map((s) => ({
        verb: s.step.split(" ")[0] || "Act",
        what: s.user_sees,
        feels: s.interaction_sketch?.slice(0, 80) || "—",
      })),
    });
  }
  return {
    intent: di,
    sections,
    caption: `Designed as ${di.hero_pattern} · ${di.accent_intent} · ${di.density}`,
  };
}

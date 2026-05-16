// ── Per-step icon + metadata classifier ──
//
// Plan steps are semantically very different activities — schedule a
// time block, do research, collaborate with people, build something,
// publish/share. The Phase 1 LLM upgrade tags each step with a
// `category` at generation time so the UI can render the right glyph
// authoritatively. For backward-compat (strategies generated before
// the schema upgrade) we keep a regex-based classifier as a fallback.
//
// Two exports:
//   - getStepIcon(meta, body) → Lucide component
//   - getStepMetadata(meta, body) → small array of pills (max 3)
//
// Both functions prefer LLM-tagged fields when present, fall back to
// regex-derived heuristics when not.

import {
  BookOpen,
  CalendarClock,
  Code2,
  Gauge,
  Lightbulb,
  Radio,
  Repeat2,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { PlanStepCategory, PlanStepMeta } from "@/lib/synergy/types";

interface IconRule {
  icon: LucideIcon;
  patterns: RegExp[];
  /** Higher wins when multiple rules match. Default 1. */
  priority?: number;
}

// Order is roughly precedence, but we sort by priority so a row like
// "Schedule daily 30-minute sessions to read research papers" classes
// as schedule (priority 3) rather than research (priority 2).
const ICON_RULES: IconRule[] = [
  {
    icon: CalendarClock,
    priority: 3,
    patterns: [
      /\bschedule\b/i,
      /\b(daily|weekly|monthly)\b/i,
      /\b\d+[-\s]?(minute|min|hour|hr)\b/i,
      /\bsession(s)?\b/i,
      /\btime[-\s]?block\b/i,
    ],
  },
  {
    icon: BookOpen,
    priority: 2,
    patterns: [
      /\b(academic|research|journal|paper|reading|literature|database|study|studies)\b/i,
    ],
  },
  {
    icon: Users,
    priority: 2,
    patterns: [
      /\b(collaborat|partner|coordinate|interview|stakeholder|community)\b/i,
      /\bteam\b/i,
      /\bwith\b\s+(scientist|expert|user|cognitive|domain)/i,
    ],
  },
  {
    icon: Code2,
    priority: 2,
    patterns: [
      /\b(model(ing|s)?|simulat|computational|software|algorithm|implement|prototype|code|coding)\b/i,
      /\b(MATLAB|Python|JavaScript|TypeScript|R)\b/,
      /\bbuild(ing)?\b.*\b(tool|model|system|platform)/i,
    ],
  },
  {
    icon: Radio,
    priority: 2,
    patterns: [
      /\b(publish|broadcast|share|disseminat|communicat|outreach|launch|release|present)\b/i,
      /\b(content|platform|multimedia)\b/i,
      /\bpublic\b/i,
    ],
  },
  {
    icon: Lightbulb,
    priority: 1,
    patterns: [
      /\b(idea|brainstorm|concept|hypothes|theory|explorat|discover)\b/i,
    ],
  },
  {
    icon: Wrench,
    priority: 1,
    patterns: [/\b(refine|iterate|improve|adjust|tune|validate)\b/i],
  },
];

// Authoritative mapping: LLM category → Lucide icon. The category
// enum lives in @/lib/synergy/types and is the source of truth for
// Phase 1+. Anything not in this map (only "other" today) falls
// through to the Sparkles fallback.
const CATEGORY_ICON: Record<PlanStepCategory, LucideIcon> = {
  schedule: CalendarClock,
  research: BookOpen,
  collaborate: Users,
  build: Code2,
  publish: Radio,
  iterate: Wrench,
  learn: Lightbulb,
  other: Sparkles,
};

export function getStepIcon(
  meta: PlanStepMeta,
  body: string,
): LucideIcon {
  // ── Phase 1 — prefer LLM-tagged category ──
  // When the strategy was generated post-Phase 1, meta.category is
  // authoritative — it's the LLM's read of the activity kind based
  // on full context, not a regex against a few keywords.
  if (meta.category && CATEGORY_ICON[meta.category]) {
    return CATEGORY_ICON[meta.category];
  }

  // ── Fallback (pre-Phase 1 strategies) — regex against title + body ──
  const text = `${meta.title ?? ""} ${body}`;
  let best: IconRule | null = null;
  let bestPriority = -1;
  for (const rule of ICON_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      const priority = rule.priority ?? 1;
      if (priority > bestPriority) {
        best = rule;
        bestPriority = priority;
      }
    }
  }
  return best?.icon ?? Sparkles;
}

export interface StepPill {
  icon: LucideIcon;
  label: string;
}

// Tools we surface as a metadata pill when mentioned. Whitelist only —
// false positives ("Python" used as a metaphor) are worse than misses,
// so we keep this short and high-confidence.
const TOOLS_WHITELIST = [
  "MATLAB",
  "Python",
  "JavaScript",
  "TypeScript",
  "Notion",
  "Figma",
  "Jupyter",
  "Tableau",
  "GitHub",
  "PyTorch",
  "TensorFlow",
  "Excel",
];

export function getStepMetadata(
  meta: PlanStepMeta,
  body: string,
): StepPill[] {
  const pills: StepPill[] = [];

  // ── Duration ──
  // Phase 1: prefer the LLM-authored duration_estimate. It's a string
  // the LLM composed with full context ("30 min/day", "by Q3",
  // "ongoing"), not a regex sample. Fall back to regex extraction
  // from the body for backward-compat with pre-Phase 1 strategies.
  if (meta.duration_estimate?.trim()) {
    pills.push({ icon: CalendarClock, label: meta.duration_estimate.trim() });
  } else {
    const timeMatch = body.match(
      /\b(\d+)[-\s]?(minute|min|hour|hr|day|week)s?\b/i,
    );
    if (timeMatch) {
      const n = timeMatch[1];
      const u = timeMatch[2].toLowerCase();
      let normalizedUnit: string;
      if (u.startsWith("min")) normalizedUnit = "min";
      else if (u === "hour" || u === "hr") normalizedUnit = "hr";
      else normalizedUnit = u; // day | week
      let label = `${n} ${normalizedUnit}`;
      if (/\b(daily|each day|every day)\b/i.test(body)) {
        label += "/day";
      } else if (/\bweekly\b/i.test(body)) {
        label += "/week";
      }
      pills.push({ icon: CalendarClock, label });
    } else if (/\b(daily|each day|every day)\b/i.test(body)) {
      pills.push({ icon: Repeat2, label: "Daily" });
    } else if (/\bweekly\b/i.test(body)) {
      pills.push({ icon: Repeat2, label: "Weekly" });
    } else if (/\b(ongoing|continuous|recurring)\b/i.test(body)) {
      pills.push({ icon: Repeat2, label: "Ongoing" });
    }
  }

  // ── Effort level ──
  // LLM-only — there's no reliable regex proxy for "is this a heavy
  // commitment." Renders as "Light", "Medium", or "Heavy" with a
  // gauge glyph.
  if (meta.effort_level) {
    const labelMap = { light: "Light", medium: "Medium", heavy: "Heavy" };
    pills.push({ icon: Gauge, label: labelMap[meta.effort_level] });
  }

  // ── Mode — "with others" vs implicit solo ──
  // Regex-only. Skipped if we'd push past 3 pills since duration +
  // effort already give the highest-signal information.
  if (
    pills.length < 3 &&
    /\b(collaborat|partner|team|together|community|stakeholder|expert|interview|coordinate)\b/i.test(
      body,
    )
  ) {
    pills.push({ icon: Users, label: "With others" });
  }

  // ── Tools mentioned ──
  // Regex-only. Will get crowded out by duration + effort + mode on
  // collaboration-heavy steps; that's fine — tools is the least
  // important of the four for at-a-glance reading.
  if (pills.length < 3) {
    const tools: string[] = [];
    for (const tool of TOOLS_WHITELIST) {
      const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`).test(body)) tools.push(tool);
    }
    if (tools.length > 0) {
      pills.push({ icon: Wrench, label: tools.slice(0, 2).join(" · ") });
    }
  }

  // Hard cap at 3 — past that the row visually competes with the
  // step title. Ordering above means duration/effort wins on
  // crunch, which is what users want first.
  return pills.slice(0, 3);
}

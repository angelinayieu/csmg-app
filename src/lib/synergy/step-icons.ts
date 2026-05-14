// ── Per-step icon + metadata classifier ──
//
// Plan steps are semantically very different activities — schedule a
// time block, do research, collaborate with people, build something,
// publish/share — but the strategy LLM doesn't tag them. We infer the
// "kind" client-side from the step's title + body so each row can wear
// a glyph that matches its activity, and a few small metadata pills
// (time, cadence, mode, tools) that pull the key facts forward without
// the user having to re-read the body.
//
// Two exports:
//   - getStepIcon(title, body) → Lucide component
//   - getStepMetadata(body)    → small array of pills (icon + caps
//                                label), max ~3
//
// Rule-based on purpose: zero latency, no token cost, runs at render.
// If we later add an LLM-tagged `category` to PlanStepMeta, this stays
// useful as a fallback.

import {
  BookOpen,
  CalendarClock,
  Code2,
  Lightbulb,
  Radio,
  Repeat2,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

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

export function getStepIcon(title: string, body: string): LucideIcon {
  const text = `${title} ${body}`;
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

export function getStepMetadata(body: string): StepPill[] {
  const pills: StepPill[] = [];

  // ── Time block — "30-minute" / "2 hours" / "1 hr/day" ──
  // Captures the number + unit, then glues the cadence on as a suffix
  // if the surrounding text says daily/weekly so the pill reads as a
  // dose ("30 MIN/DAY") rather than a duration.
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
  }

  // ── Cadence — only if we didn't already glue it onto the time pill ──
  const cadenceInTime = pills.some((p) => /\/(day|week)/.test(p.label));
  if (!cadenceInTime) {
    if (/\b(daily|each day|every day)\b/i.test(body)) {
      pills.push({ icon: Repeat2, label: "Daily" });
    } else if (/\bweekly\b/i.test(body)) {
      pills.push({ icon: Repeat2, label: "Weekly" });
    } else if (/\b(ongoing|continuous|recurring)\b/i.test(body)) {
      pills.push({ icon: Repeat2, label: "Ongoing" });
    }
  }

  // ── Mode — "with others" vs implicit solo ──
  // Only emit when there's positive evidence of collaboration. We
  // don't emit a "solo" pill — visual silence is enough for solo.
  if (
    /\b(collaborat|partner|team|together|community|stakeholder|expert|interview|coordinate)\b/i.test(
      body,
    )
  ) {
    pills.push({ icon: Users, label: "With others" });
  }

  // ── Tools mentioned ──
  const tools: string[] = [];
  for (const tool of TOOLS_WHITELIST) {
    // Case-sensitive — "MATLAB" should match but "matlab" usually
    // doesn't in real plan text, and we want to avoid casual mentions.
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(body)) tools.push(tool);
  }
  if (tools.length > 0) {
    pills.push({
      icon: Wrench,
      label: tools.slice(0, 2).join(" · "),
    });
  }

  // Cap at 3 pills — beyond that the row gets visually noisy. The
  // ordering above means time/cadence wins over tools when there's a
  // crunch, which matches what users want to see first.
  return pills.slice(0, 3);
}

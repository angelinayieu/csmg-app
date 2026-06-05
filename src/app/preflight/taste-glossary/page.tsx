// Visual preflight for the taste-glossary system — renders the pieces that are
// otherwise auth-gated on the board so they can be screenshotted without a live
// session: (1) the inline provenance underlines from GlossaryText, and (2) the
// enriched glossary row (provenance badge + evidence + cross-space reuse +
// inheritance) as it appears in the notebook glossary view.
//
// SAFE TO DELETE — exploration. Route: /preflight/taste-glossary

"use client";

import { GlossaryText } from "@/components/objective/glossary-text";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { GlossaryTerm } from "@/lib/objective-canvas/generate-glossary";

type RichTerm = GlossaryTerm & {
  evidence?: Array<{ label?: string; detail?: string }>;
  crossSpaceCount?: number;
};

// Music-app domain (matches the resolution-studio preflight) covering every
// provenance + depth case.
const TERMS: RichTerm[] = [
  {
    term: "Flow",
    definition:
      "A vibe / energy level (chill, hype, focused) the user self-selects per task — NOT clinical 'flow state'.",
    aliases: ["flow mood"],
    source: "user",
    pinned: true,
    concept_slug: "flow",
    updated_at: "",
    crossSpaceCount: 2,
    evidence: [
      { label: "your note", detail: "flow = a vibe, not productivity" },
      { label: "PRD excerpt", detail: "users pick chill / hype / focused" },
    ],
  },
  {
    term: "Task",
    definition:
      "A lifestyle context (gym, commute, studying) the user tags music to.",
    aliases: ["task-based"],
    source: "annotation",
    concept_slug: "task",
    updated_at: "",
    evidence: [{ label: "reference doc", detail: "tasks are broad contexts" }],
  },
  {
    term: "Remix",
    definition:
      "A user-uploaded reinterpretation of a track, shared to the community feed.",
    aliases: [],
    source: "llm",
    concept_slug: "remix",
    updated_at: "",
  },
  {
    term: "Interest-Based Matching",
    definition:
      "Pairs users by overlapping taste + current task so they can co-listen.",
    aliases: ["matching"],
    source: "user",
    pinned: false,
    concept_slug: "interest-based-matching",
    updated_at: "",
    cross_space_origin: "abc",
    cross_space_origin_title: "Fitness Coach App",
    crossSpaceCount: 1,
  },
];

const PROSE = `This app surfaces a Flow vibe for whatever Task you're doing — code to a hype set, study to a chill one. Upload a Remix and it posts to the community feed. Interest-Based Matching then pairs you with people whose taste and Task line up, so a stranger's flow becomes yours.`;

const SOURCE_TONE: Record<string, { bg: string; color: string }> = {
  annotation: { bg: "rgba(37,99,235,0.1)", color: "rgba(30,64,175,0.95)" },
  llm: { bg: appleVibe.surface.chip, color: appleVibe.text.faint },
  user: { bg: "rgba(217,119,6,0.12)", color: "rgba(146,64,14,0.95)" },
};

function Badge({ term }: { term: RichTerm }) {
  const inherited = term.cross_space_origin_title ?? "";
  const tone = inherited ? SOURCE_TONE.user : (SOURCE_TONE[term.source] ?? SOURCE_TONE.llm);
  const label = inherited
    ? "inherited"
    : term.source === "user"
      ? "your edit"
      : term.source === "annotation"
        ? "objective lens"
        : "generated";
  return (
    <span
      style={{
        flexShrink: 0,
        borderRadius: 999,
        padding: "1px 6px",
        fontSize: 8.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        background: tone.bg,
        color: tone.color,
      }}
    >
      {label}
    </span>
  );
}

function Row({ term }: { term: RichTerm }) {
  const evidence = term.evidence ?? [];
  const crossN = term.crossSpaceCount ?? 0;
  return (
    <li
      style={{
        listStyle: "none",
        borderRadius: 12,
        padding: "8px 12px",
        background: "rgba(255,255,255,0.6)",
        border: `1px solid ${
          term.pinned ? "rgba(217,119,6,0.3)" : appleVibe.stroke.hairline
        }`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: appleVibe.text.primary }}>
          {term.term}
        </span>
        <Badge term={term} />
      </div>
      <p
        style={{
          margin: "2px 0 0",
          fontSize: 11.5,
          fontWeight: 300,
          lineHeight: 1.4,
          color: appleVibe.text.secondary,
        }}
      >
        {term.definition}
      </p>
      {(crossN > 0 || evidence.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {crossN > 0 && (
            <span
              style={{
                borderRadius: 999,
                padding: "1px 6px",
                fontSize: 9,
                fontWeight: 600,
                background: appleVibe.surface.chip,
                color: appleVibe.text.tertiary,
              }}
            >
              in {crossN} other space{crossN === 1 ? "" : "s"}
            </span>
          )}
          {evidence.slice(0, 3).map((e, i) => (
            <span
              key={i}
              title={e.detail || e.label || ""}
              style={{
                borderRadius: 999,
                padding: "1px 6px",
                fontSize: 9,
                fontWeight: 500,
                background: "rgba(37,99,235,0.08)",
                color: "rgba(30,64,175,0.9)",
              }}
            >
              ↳ {e.label}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export default function TasteGlossaryPreflight() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f6f8",
        padding: "40px 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        <header>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: appleVibe.text.primary, margin: 0 }}>
            Taste glossary — visual preflight
          </h1>
          <p style={{ fontSize: 13, color: appleVibe.text.tertiary, margin: "6px 0 0" }}>
            How a user SEES that their taste is embedded. Hover any underlined
            term for its provenance tooltip.
          </p>
        </header>

        <section>
          <h2 style={sectionH}>1 · Inline provenance cues (everywhere prose renders)</h2>
          <div
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: appleVibe.text.primary,
              background: "#fff",
              borderRadius: 14,
              padding: "18px 20px",
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            <GlossaryText text={PROSE} terms={TERMS} />
          </div>
          <ul style={legend}>
            <li><b style={{ borderBottom: `1.5px solid ${appleVibe.accent.primary}` }}>Yours</b> — pinned / authored (honored everywhere)</li>
            <li><b style={{ borderBottom: `1px dashed ${appleVibe.text.tertiary}` }}>Grounded</b> — from your refs / project</li>
            <li><b style={{ borderBottom: `1px dotted ${appleVibe.text.faint}` }}>AI</b> — suggested, not yet yours</li>
          </ul>
        </section>

        <section>
          <h2 style={sectionH}>2 · Glossary depth (the notebook definition page)</h2>
          <ul style={{ display: "flex", flexDirection: "column", gap: 6, padding: 0, margin: 0 }}>
            {TERMS.map((t) => (
              <Row key={t.term} term={t} />
            ))}
          </ul>
          <p style={{ fontSize: 12, color: appleVibe.text.tertiary, marginTop: 8 }}>
            Provenance badge · evidence chips (the references that deepened it) ·
            cross-space reuse · “inherited” when a meaning travels from another
            of your spaces.
          </p>
        </section>
      </div>
    </div>
  );
}

const sectionH: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: appleVibe.text.tertiary,
  margin: "0 0 10px",
};
const legend: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 18,
  listStyle: "none",
  padding: 0,
  margin: "12px 0 0",
  fontSize: 12,
  color: appleVibe.text.secondary,
};

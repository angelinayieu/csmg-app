"use client";

// ── GlossaryText (Arc 3.5) ─────────────────────────────────────────
//
// Renders a string with the FIRST occurrence of each known glossary
// term wrapped in a hover-definition span (dotted underline + native
// title tooltip). The "annotate everything" readability primitive —
// drop it anywhere dense domain language is rendered.
//
// Only the first occurrence of each term is glossed, so prose doesn't
// turn into a sea of underlines. Pure + dependency-light: no fetch, no
// state — the caller supplies the resolved terms.

import type React from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { GlossaryTerm } from "@/lib/objective-canvas/generate-glossary";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function GlossaryText({
  text,
  terms,
}: {
  text: string;
  terms: GlossaryTerm[];
}) {
  if (!text || !terms || terms.length === 0) return <>{text}</>;

  // Candidate surface forms (term + aliases) → definition. Longest
  // first so multi-word terms win over their sub-words.
  const candidates: Array<{ surface: string; definition: string; key: string }> =
    [];
  for (const t of terms) {
    if (t.term) {
      candidates.push({
        surface: t.term,
        definition: t.definition,
        key: t.term.toLowerCase(),
      });
    }
    for (const a of t.aliases ?? []) {
      if (a) {
        candidates.push({
          surface: a,
          definition: t.definition,
          key: t.term.toLowerCase(),
        });
      }
    }
  }
  if (candidates.length === 0) return <>{text}</>;
  candidates.sort((a, b) => b.surface.length - a.surface.length);

  const byLowerSurface = new Map(
    candidates.map((c) => [c.surface.toLowerCase(), c]),
  );
  let pattern: RegExp;
  try {
    pattern = new RegExp(
      `\\b(${candidates.map((c) => escapeRegExp(c.surface)).join("|")})\\b`,
      "gi",
    );
  } catch {
    // Defensive — a malformed surface form shouldn't break rendering.
    return <>{text}</>;
  }

  const nodes: React.ReactNode[] = [];
  const glossed = new Set<string>(); // term keys already glossed (first hit only)
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const matched = m[0];
    const cand = byLowerSurface.get(matched.toLowerCase());
    if (!cand || glossed.has(cand.key)) continue; // leave un-glossed text as-is
    glossed.add(cand.key);
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <span
        key={`g${key++}`}
        title={cand.definition}
        style={{
          borderBottom: `1px dotted ${appleVibe.text.faint}`,
          cursor: "help",
        }}
      >
        {matched}
      </span>,
    );
    last = m.index + matched.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

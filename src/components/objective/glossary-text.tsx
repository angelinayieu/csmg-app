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
import { useAnnotationsVisible } from "@/components/objective/annotations-visibility";

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
  // Hook must run unconditionally before any early return. Global
  // "annotations off" mode also drops glossary underlines so the page
  // reads as clean text.
  const annotationsVisible = useAnnotationsVisible();
  if (!annotationsVisible) return <>{text}</>;
  if (!text || !terms || terms.length === 0) return <>{text}</>;

  // Candidate surface forms (term + aliases) → definition. Longest
  // first so multi-word terms win over their sub-words.
  const candidates: Array<{
    surface: string;
    definition: string;
    key: string;
    prov: "yours" | "grounded" | "ai";
    extra: string;
    origin: string;
  }> = [];
  for (const t of terms) {
    // Opportunistic depth: when the caller passes terms from the enriched
    // glossary endpoint, surface the references that ground the term + how
    // widely the user reuses it. Absent on bare terms → no extra line.
    const enr = t as GlossaryTerm & {
      evidence?: Array<{ label?: string }>;
      crossSpaceCount?: number;
    };
    const hasEv = !!(enr.evidence && enr.evidence.length > 0);
    // Provenance, mirroring the server rule (taste-glossary.ts provenanceOf):
    // pinned/user = "yours"; ref-backed or annotation-derived = "grounded";
    // entity/llm jargon the user hasn't touched = "ai". Drives the underline
    // weight + tooltip so the user SEES which meanings are theirs, everywhere.
    const prov: "yours" | "grounded" | "ai" =
      t.pinned || t.source === "user"
        ? "yours"
        : hasEv || t.source === "annotation"
          ? "grounded"
          : "ai";
    const evNote =
      enr.evidence && enr.evidence.length > 0
        ? `Grounded in your material: ${enr.evidence
            .slice(0, 3)
            .map((e) => e.label)
            .filter(Boolean)
            .join(", ")}`
        : "";
    const xN = enr.crossSpaceCount ?? 0;
    const xNote =
      xN > 0
        ? `Also defined by you in ${xN} other space${xN === 1 ? "" : "s"} — defined once.`
        : "";
    const extra = [evNote, xNote].filter(Boolean).join("\n");
    // Inherited from another of the user's spaces (P3.0 cross-space taste).
    const origin = t.cross_space_origin_title ?? "";
    if (t.term) {
      candidates.push({
        surface: t.term,
        definition: t.definition,
        key: t.term.toLowerCase(),
        prov,
        extra,
        origin,
      });
    }
    for (const a of t.aliases ?? []) {
      if (a) {
        candidates.push({
          surface: a,
          definition: t.definition,
          key: t.term.toLowerCase(),
          prov,
          extra,
          origin,
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
    // Provenance-keyed underline + tooltip. "Yours" reads as a confident solid
    // accent (this meaning is honored everywhere AI reasons); "ai" stays a
    // faint dotted hint inviting the user to make it theirs. The tooltip layers
    // provenance → definition → grounding/reuse, deepest last.
    const provLine =
      cand.prov === "yours"
        ? cand.origin
          ? `Inherited from your “${cand.origin}” — your meaning, applied here too.`
          : "Your definition — applied everywhere AI reasons."
        : cand.prov === "grounded"
          ? "From your project."
          : "AI-suggested — edit it to make it yours.";
    const border =
      cand.prov === "yours"
        ? `1.5px solid ${appleVibe.accent.primary}`
        : cand.prov === "grounded"
          ? `1px dashed ${appleVibe.text.tertiary}`
          : `1px dotted ${appleVibe.text.faint}`;
    const title = [provLine, cand.definition, cand.extra]
      .filter(Boolean)
      .join("\n\n");
    nodes.push(
      <span
        key={`g${key++}`}
        title={title}
        style={{ borderBottom: border, cursor: "help" }}
      >
        {matched}
      </span>,
    );
    last = m.index + matched.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

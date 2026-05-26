"use client";

// ── Concept Memory Feed Strip ──────────────────────────────────────
//
// Ambient strip on the main canvas surfacing the user's top
// canonical concepts by recent activity. Differs from the picker's
// PriorConceptsStrip (query-specific) — this is the user's WHOLE-KG
// memory feed, scoped only to "recently active across your spaces."
//
// Click a chip → opens CanonicalConceptDrawer for full cross-space
// inspection. Collapsed by default so it's quiet ambient signal.

import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { CanonicalConceptDrawer } from "@/components/canonical/canonical-concept-drawer";

interface ConceptMemoryEntry {
  id: string;
  canonical_code: string;
  display_name: string;
  description: string | null;
  domain_tags: string[];
  entity_count: number;
  space_count: number;
  last_seen_at: string | null;
}

interface Props {
  concepts: ConceptMemoryEntry[];
}

/** Pretty-print "N days ago" / "today" / "yesterday" for the
 *  last_seen_at tooltip. Cheap; no date library. */
function relativeAge(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diffMs = Date.now() - d;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / dayMs);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function ConceptMemoryFeedStrip({ concepts }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);

  if (concepts.length === 0) return null;

  return (
    <>
      <div
        className="mx-auto w-full max-w-5xl rounded-2xl border px-3 py-2.5"
        style={{
          background: "rgba(124,58,237,0.025)",
          borderColor: "rgba(124,58,237,0.18)",
          borderRadius: appleVibe.radius.md,
          fontFamily: appleVibe.font.stack,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Sparkles
              className="h-3 w-3 flex-shrink-0"
              strokeWidth={2}
              style={{ color: "rgba(91,33,182,0.9)" }}
            />
            <span
              className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgba(91,33,182,0.95)" }}
            >
              Concept memory
            </span>
            <span
              className="text-[11.5px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              · top {concepts.length} concepts you&apos;ve been reasoning across
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1 text-[10.5px] font-medium"
            style={{ color: appleVibe.text.tertiary }}
          >
            {expanded ? (
              <>
                hide <ChevronUp className="h-3 w-3" strokeWidth={2} />
              </>
            ) : (
              <>
                show <ChevronDown className="h-3 w-3" strokeWidth={2} />
              </>
            )}
          </span>
        </button>

        {expanded && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {concepts.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setOpenCode(c.canonical_code)}
                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[rgba(124,58,237,0.10)]"
                style={{
                  background: "rgba(255,255,255,0.92)",
                  color: "rgba(91,33,182,0.95)",
                  border: "1px solid rgba(124,58,237,0.20)",
                  cursor: "pointer",
                }}
                title={
                  [
                    c.description ?? "",
                    c.domain_tags.length > 0
                      ? `Tags: ${c.domain_tags.join(", ")}`
                      : "",
                    `${c.entity_count} entit${c.entity_count === 1 ? "y" : "ies"} across ${c.space_count} space${c.space_count === 1 ? "" : "s"}`,
                    `Last touched ${relativeAge(c.last_seen_at)}`,
                    "Click to open cross-space view.",
                  ]
                    .filter(Boolean)
                    .join("\n")
                }
              >
                <span className="truncate">{c.display_name}</span>
                <span
                  className="font-mono text-[9.5px]"
                  style={{ color: "rgba(91,33,182,0.65)" }}
                >
                  {c.space_count}×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {openCode && (
        <CanonicalConceptDrawer
          canonicalCode={openCode}
          onClose={() => setOpenCode(null)}
        />
      )}
    </>
  );
}

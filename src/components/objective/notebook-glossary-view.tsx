"use client";

// ── Notebook Glossary View (Arc 3.5 / v2) ──────────────────────────
//
// The space-level "definition page" — the single home for the project
// glossary, mounted inside the always-open notebook rail (not repeated
// per-drawer). Lists every term with its context-specific definition +
// provenance, and lets the user generate/regenerate, edit, and pin.
//
// Pinning an edited definition makes it source:"user" + immutable
// across regenerations (the merge in generate-glossary.ts respects it).

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, Pin, RefreshCw, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  GlossaryTerm,
  GlossarySource,
} from "@/lib/objective-canvas/generate-glossary";

const SOURCE_LABEL: Record<GlossarySource, string> = {
  annotation: "objective lens",
  entity: "from rooms",
  llm: "generated",
  user: "your edit",
};
const SOURCE_TONE: Record<GlossarySource, { bg: string; color: string }> = {
  annotation: { bg: "rgba(37,99,235,0.1)", color: "rgba(30,64,175,0.95)" },
  entity: { bg: "rgba(22,163,74,0.1)", color: "rgba(22,101,52,0.95)" },
  llm: { bg: appleVibe.surface.chip, color: appleVibe.text.faint },
  user: { bg: "rgba(217,119,6,0.12)", color: "rgba(146,64,14,0.95)" },
};

export function NotebookGlossaryView({ spaceId }: { spaceId: string }) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/brainstorm/space/${spaceId}/glossary`);
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && Array.isArray(json?.glossary)) {
          setTerms(json.glossary as GlossaryTerm[]);
        }
      } catch {
        /* soft */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const regenerate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brainstorm/space/${spaceId}/glossary`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Couldn't build the glossary.");
        return;
      }
      if (Array.isArray(json?.glossary)) setTerms(json.glossary as GlossaryTerm[]);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, [spaceId, busy]);

  const patch = useCallback(
    async (term: string, payload: { definition?: string; pinned?: boolean }) => {
      try {
        const res = await fetch(`/api/brainstorm/space/${spaceId}/glossary`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ term, ...payload }),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.term) {
          setTerms((prev) =>
            prev.map((t) =>
              t.term.toLowerCase() === term.toLowerCase()
                ? (json.term as GlossaryTerm)
                : t,
            ),
          );
        }
      } catch {
        /* soft */
      }
    },
    [spaceId],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Header + generate */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Glossary · {terms.length} {terms.length === 1 ? "term" : "terms"}
        </span>
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
          style={{
            background: appleVibe.surface.chip,
            color: appleVibe.text.tertiary,
            cursor: busy ? "wait" : "pointer",
          }}
          title="Build/refresh the glossary from the objective lens + rooms"
        >
          {busy ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" strokeWidth={2} />
          )}
          {busy ? "Working…" : terms.length > 0 ? "Refresh" : "Build"}
        </button>
      </div>

      <p
        className="text-[11px] font-light leading-snug"
        style={{ color: appleVibe.text.tertiary }}
      >
        Context-specific definitions for this project&apos;s key terms. Sourced
        from the objective lens + your rooms; edits you pin are kept across
        refreshes.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl px-3 py-2 text-[11px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            color: "rgba(127,29,29,0.95)",
            border: "1px solid rgba(220,38,38,0.18)",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p
          className="text-[11.5px] font-light italic"
          style={{ color: appleVibe.text.tertiary }}
        >
          Loading glossary…
        </p>
      ) : terms.length === 0 ? (
        <p
          className="text-[11.5px] font-light leading-snug"
          style={{ color: appleVibe.text.tertiary }}
        >
          No glossary yet. Build one to hover-define this project&apos;s key
          terms throughout the canvas.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {terms.map((t) => {
            // Taste depth from the enriched glossary GET (additive — absent on
            // bare terms): the references that ground the term + how widely the
            // user reuses it + whether it was inherited from another space.
            const enr = t as GlossaryTerm & {
              evidence?: Array<{ label?: string; detail?: string }>;
              crossSpaceCount?: number;
            };
            const evidence = enr.evidence ?? [];
            const crossN = enr.crossSpaceCount ?? 0;
            const inheritedFrom = t.cross_space_origin_title ?? "";
            const tone = inheritedFrom
              ? SOURCE_TONE.user
              : (SOURCE_TONE[t.source] ?? SOURCE_TONE.llm);
            const badgeLabel = inheritedFrom ? "inherited" : SOURCE_LABEL[t.source];
            const badgeTitle = inheritedFrom
              ? `Inherited from your "${inheritedFrom}" — your meaning, applied here too`
              : `Definition source: ${SOURCE_LABEL[t.source]}`;
            const isEditing = editing === t.term;
            return (
              <li
                key={t.term}
                className="rounded-xl px-3 py-2"
                style={{
                  background: "rgba(255,255,255,0.6)",
                  border: `1px solid ${
                    t.pinned ? "rgba(217,119,6,0.3)" : appleVibe.stroke.hairline
                  }`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="truncate text-[12.5px] font-semibold"
                      style={{ color: appleVibe.text.primary }}
                    >
                      {t.term}
                    </span>
                    <span
                      className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.06em]"
                      style={{ background: tone.bg, color: tone.color }}
                      title={badgeTitle}
                    >
                      {badgeLabel}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(t.term);
                        setDraft(t.definition);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.05)]"
                      title="Edit definition"
                    >
                      <Pencil
                        className="h-3 w-3"
                        strokeWidth={2}
                        style={{ color: appleVibe.text.tertiary }}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void patch(t.term, { pinned: !t.pinned })}
                      className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.05)]"
                      title={t.pinned ? "Unpin (allow refresh)" : "Pin (keep across refreshes)"}
                      aria-pressed={t.pinned}
                    >
                      <Pin
                        className="h-3 w-3"
                        strokeWidth={2}
                        style={{
                          color: t.pinned
                            ? "rgba(146,64,14,0.95)"
                            : appleVibe.text.faint,
                          fill: t.pinned ? "rgba(217,119,6,0.4)" : "none",
                        }}
                      />
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="mt-1 flex flex-col gap-1">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full resize-none rounded-lg px-2 py-1.5 text-[11.5px] font-light leading-snug outline-none"
                      style={{
                        color: appleVibe.text.primary,
                        background: "rgba(255,255,255,0.9)",
                        border: `1px solid ${appleVibe.stroke.medium}`,
                      }}
                    />
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ color: appleVibe.text.tertiary }}
                      >
                        <X className="h-2.5 w-2.5" strokeWidth={2} /> Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void patch(t.term, { definition: draft });
                          setEditing(null);
                        }}
                        className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: appleVibe.accent.primary,
                          color: appleVibe.text.onAccent,
                        }}
                      >
                        <Check className="h-2.5 w-2.5" strokeWidth={2} /> Save &amp; pin
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      className="mt-0.5 text-[11.5px] font-light leading-snug"
                      style={{ color: appleVibe.text.secondary }}
                    >
                      {t.definition}
                    </p>
                    {(crossN > 0 || evidence.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {crossN > 0 && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                            style={{
                              background: appleVibe.surface.chip,
                              color: appleVibe.text.tertiary,
                            }}
                            title="You've defined this concept in other spaces too — define once, reused everywhere"
                          >
                            in {crossN} other space{crossN === 1 ? "" : "s"}
                          </span>
                        )}
                        {evidence.slice(0, 3).map((e, i) => (
                          <span
                            key={i}
                            className="max-w-[170px] truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                            style={{
                              background: "rgba(37,99,235,0.08)",
                              color: "rgba(30,64,175,0.9)",
                            }}
                            title={e.detail || e.label || ""}
                          >
                            ↳ {e.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

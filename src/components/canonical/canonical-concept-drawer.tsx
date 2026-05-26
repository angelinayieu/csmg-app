"use client";

// ── CanonicalConceptDrawer (Sprint W6.8) ───────────────────────────
//
// Right-edge slide-in drawer (480px wide) that hits
// GET /api/canonical-concepts/[code] and renders:
//
//   1. Header — display_name + canonical_code + verified badge
//   2. Description + domain tags
//   3. Cross-space evidence — distinct_space_count + total_entity_count
//      (privacy-safe aggregate counts only)
//   4. "In your spaces" — list of the user's own spaces that have
//      entities linked to this concept (full identifiable pointers)
//
// Loading + error states are inline. Click outside or × closes.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GitBranch, X } from "lucide-react";

interface CanonicalConceptDrawerProps {
  canonicalCode: string;
  onClose: () => void;
  /** When provided, renders a "+ Branch into current space" button
   *  in the drawer footer. Clicking it fires
   *  /api/brainstorm/sub-objectives/branch-from-concept which seeds
   *  a new sub-objective in the given space from this concept's
   *  cross-space history. When undefined, the button is hidden
   *  (drawer-as-read-only view). */
  currentSpaceId?: string;
}

interface ConceptResponse {
  concept: {
    id: string;
    canonical_code: string;
    display_name: string;
    description: string | null;
    domain_tags: string[];
    aliases: string[];
    status: "pending" | "verified" | "rejected" | "merged";
    space_count: number;
    entity_count: number;
    last_seen_at: string | null;
    first_observed_space_id: string | null;
    created_at: string;
    updated_at: string;
  };
  evidence: {
    total_entity_count: number;
    distinct_space_count: number;
  };
  in_your_spaces: Array<{
    space_id: string;
    space_name: string;
    entity_count: number;
  }>;
}

export function CanonicalConceptDrawer({
  canonicalCode,
  onClose,
  currentSpaceId,
}: CanonicalConceptDrawerProps) {
  const router = useRouter();
  const [data, setData] = useState<ConceptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Branch state — the user clicked "+ Branch into current space".
  const [branching, setBranching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  // Success state — when set, render a brief confirmation before
  // auto-closing + refreshing the page so the new card appears.
  const [branchedTo, setBranchedTo] = useState<string | null>(null);

  async function handleBranch() {
    if (!currentSpaceId || !data) return;
    setBranchError(null);
    setBranching(true);
    try {
      const res = await fetch(
        "/api/brainstorm/sub-objectives/branch-from-concept",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId: currentSpaceId,
            canonicalCode: data.concept.canonical_code,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setBranchError(json?.error ?? "Could not branch the concept.");
        return;
      }
      const title =
        typeof json?.proposal?.title === "string"
          ? json.proposal.title
          : data.concept.display_name;
      setBranchedTo(title);
      // Brief confirmation, then close + refresh.
      setTimeout(() => {
        router.refresh();
        onClose();
      }, 1200);
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBranching(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/canonical-concepts/${encodeURIComponent(canonicalCode)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<ConceptResponse> & { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setData(body as ConceptResponse);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalCode]);

  // Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isVerified = data?.concept.status === "verified";

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        className="flex-1 bg-black/20"
        aria-label="Close panel"
      />

      <aside
        className="flex w-full max-w-[480px] flex-col bg-white shadow-2xl"
        role="dialog"
        aria-label="Canonical concept"
      >
        <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
              Canonical concept
            </div>
            {loading ? (
              <div className="mt-2 h-5 w-2/3 animate-pulse rounded bg-gray-100" />
            ) : data ? (
              <div className="mt-1 flex items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold text-gray-900">
                  {data.concept.display_name}
                </h2>
                {isVerified && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                    verified
                  </span>
                )}
              </div>
            ) : (
              <h2 className="mt-1 text-[15px] font-semibold text-gray-500">
                Concept not found
              </h2>
            )}
            {data && (
              <p className="mt-0.5 font-mono text-[10.5px] text-gray-400">
                {data.concept.canonical_code}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3">
              <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
              <div className="mt-6 h-16 w-full animate-pulse rounded bg-gray-100" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-[12px] font-medium text-red-700">
                Couldn&apos;t load concept
              </p>
              <p className="mt-0.5 text-[11px] text-red-600">{error}</p>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* Description */}
              {data.concept.description && (
                <p className="text-[12.5px] leading-relaxed text-gray-700">
                  {data.concept.description}
                </p>
              )}

              {/* Domain tags */}
              {data.concept.domain_tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.concept.domain_tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Aliases */}
              {data.concept.aliases.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                    Also known as
                  </h3>
                  <p className="text-[12px] text-gray-600">
                    {data.concept.aliases.join(" · ")}
                  </p>
                </section>
              )}

              {/* Cross-space evidence */}
              <section className="rounded-xl border border-violet-100 bg-violet-50/40 px-3.5 py-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-violet-700">
                  Cross-space evidence
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[20px] font-semibold text-violet-900">
                      {data.evidence.distinct_space_count}
                    </div>
                    <div className="text-[10.5px] text-violet-700">
                      {data.evidence.distinct_space_count === 1
                        ? "space"
                        : "spaces"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[20px] font-semibold text-violet-900">
                      {data.evidence.total_entity_count}
                    </div>
                    <div className="text-[10.5px] text-violet-700">
                      {data.evidence.total_entity_count === 1
                        ? "entity"
                        : "entities"}
                    </div>
                  </div>
                </div>
              </section>

              {/* In your spaces */}
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                  In your spaces
                </h3>
                {data.in_your_spaces.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-[11.5px] text-gray-500">
                    This concept hasn&apos;t appeared in any of your spaces yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {data.in_your_spaces.map((s) => (
                      <li
                        key={s.space_id}
                        className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px]"
                      >
                        <a
                          href={`/app/space/${s.space_id}`}
                          className="truncate font-medium text-gray-900 hover:underline"
                        >
                          {s.space_name}
                        </a>
                        <span className="ml-2 flex-shrink-0 text-[10.5px] text-gray-500">
                          {s.entity_count}{" "}
                          {s.entity_count === 1 ? "entity" : "entities"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Branch into current space — only when the host
                  passed currentSpaceId AND we have a loaded concept.
                  This is the "use the cross-space KG as a building
                  block" affordance. */}
              {currentSpaceId && (
                <section className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-3.5 py-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <GitBranch className="h-3 w-3 text-violet-700" />
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-violet-700">
                      Branch into current space
                    </h3>
                  </div>
                  {branchedTo ? (
                    <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-2 text-[12px] text-emerald-800">
                      <span className="text-[14px] leading-none">✓</span>
                      <span className="min-w-0 flex-1 truncate">
                        Added: <span className="font-medium">{branchedTo}</span>
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="mb-2 text-[11.5px] leading-snug text-violet-900/80">
                        Seed a new sub-objective from this concept&apos;s
                        cross-space history, adapted to your current
                        objective.
                      </p>
                      <button
                        type="button"
                        onClick={handleBranch}
                        disabled={branching}
                        className="group flex w-full items-center justify-between rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex items-center gap-1.5">
                          <GitBranch className="h-3 w-3" />
                          {branching ? "Branching…" : "Branch concept here"}
                        </span>
                        {!branching && (
                          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                        )}
                      </button>
                      {branchError && (
                        <p className="mt-1.5 text-[11px] text-red-600">
                          {branchError}
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}

              {/* Status footer */}
              <footer className="border-t border-gray-100 pt-3 text-[10.5px] text-gray-400">
                {data.concept.status === "verified" ? (
                  <span>
                    Verified across {data.concept.space_count} spaces. Status:
                    {" "}
                    <span className="font-semibold text-emerald-600">
                      {data.concept.status}
                    </span>
                  </span>
                ) : (
                  <span>
                    Single-space concept. Auto-verifies when ≥3 distinct
                    spaces use this concept.
                  </span>
                )}
              </footer>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

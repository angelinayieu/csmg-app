"use client";

// ── Annotation Compare Modal ──
//
// Full-overlay side-by-side view of two annotation versions. Picks
// the two versions via dropdowns, lists each version's phrases with
// readings + key dimension counts, and exposes a "Synthesize best of
// both" CTA that calls /api/brainstorm/annotations/synthesize.
//
// Designed compact, not opulent — the rich-popover experience lives
// in the main card. This modal is for AUDITING what's different and
// triggering arbitration.

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, GitMerge, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type {
  AnnotationVersion,
  ArbitrationRecord,
} from "@/lib/objective-canvas/annotation-versions";
import type {
  ObjectiveAnnotation,
} from "@/components/objective/annotated-objective-card";

interface Props {
  open: boolean;
  spaceId: string;
  versions: AnnotationVersion[];
  /** Default pair to show. If null, picks last two versions. */
  initialPair?: [string, string] | null;
  onClose: () => void;
  onSynthesized: (
    annotations: ObjectiveAnnotation[],
    arbitration: ArbitrationRecord[],
    newVersionId: string,
  ) => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

const GENERATOR_LABEL = {
  initial: "v1",
  deepen: "deepened",
  synthesis: "synthesis",
} as const;

export function AnnotationCompareModal({
  open,
  spaceId,
  versions,
  initialPair,
  onClose,
  onSynthesized,
}: Props) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Initialize pair on open
  useEffect(() => {
    if (!open) return;
    if (initialPair) {
      setLeftId(initialPair[0]);
      setRightId(initialPair[1]);
      return;
    }
    if (versions.length >= 2) {
      setLeftId(versions[versions.length - 2]!.id);
      setRightId(versions[versions.length - 1]!.id);
    } else if (versions.length === 1) {
      setLeftId(versions[0]!.id);
      setRightId(versions[0]!.id);
    }
  }, [open, initialPair, versions]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const left = useMemo(
    () => versions.find((v) => v.id === leftId) ?? null,
    [versions, leftId],
  );
  const right = useMemo(
    () => versions.find((v) => v.id === rightId) ?? null,
    [versions, rightId],
  );

  function synthesize() {
    if (!left || !right || left.id === right.id) {
      setError("Pick two different versions to synthesize.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/brainstorm/annotations/synthesize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            versionAId: left.id,
            versionBId: right.id,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json?.error ?? "Synthesize failed.");
          return;
        }
        onSynthesized(
          json.annotations,
          json.arbitration_record ?? [],
          json.version_id,
        );
        onClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error.",
        );
      }
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{
            background: "rgba(15,23,42,0.5)",
            backdropFilter: "blur(10px)",
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl"
            style={{
              background: appleVibe.surface.card,
              border: `1px solid ${appleVibe.stroke.soft}`,
              boxShadow: "0 24px 80px -20px rgba(11,18,40,0.45)",
              borderRadius: appleVibe.radius.xl,
              fontFamily: appleVibe.font.stack,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <header
              className="flex items-center justify-between border-b px-6 py-4"
              style={{ borderColor: appleVibe.stroke.hairline }}
            >
              <div>
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Compare annotation versions
                </div>
                <h2
                  className="mt-0.5 text-[18px] font-semibold tracking-tight"
                  style={{ color: appleVibe.text.primary }}
                >
                  {versions.length} versions in history
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.secondary,
                }}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </header>

            {/* Body — two columns */}
            <div className="grid grid-cols-1 gap-px overflow-y-auto md:grid-cols-2" style={{ background: appleVibe.stroke.hairline }}>
              <VersionColumn
                label="Left"
                versions={versions}
                selectedId={leftId}
                onSelect={setLeftId}
              />
              <VersionColumn
                label="Right"
                versions={versions}
                selectedId={rightId}
                onSelect={setRightId}
              />
            </div>

            {/* Footer with Synthesize CTA */}
            <footer
              className="flex flex-col gap-2 border-t px-6 py-4"
              style={{ borderColor: appleVibe.stroke.hairline }}
            >
              {error && (
                <div
                  role="alert"
                  className="rounded-lg px-3 py-2 text-[12px]"
                  style={{
                    background: "rgba(220,38,38,0.06)",
                    border: "1px solid rgba(220,38,38,0.18)",
                    color: "rgba(127,29,29,0.95)",
                  }}
                >
                  {error}
                </div>
              )}
              <div className="flex items-center justify-between">
                <p
                  className="text-[11.5px] font-light"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Synthesize runs an arbitration LLM that picks per-phrase
                  winners and records WHY.
                </p>
                <button
                  type="button"
                  onClick={synthesize}
                  disabled={busy || !left || !right || left.id === right.id}
                  className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[13px] font-semibold"
                  style={{
                    background:
                      busy || !left || !right || left.id === right.id
                        ? appleVibe.surface.chip
                        : appleVibe.accent.primary,
                    color:
                      busy || !left || !right || left.id === right.id
                        ? appleVibe.text.tertiary
                        : appleVibe.text.onAccent,
                    cursor:
                      busy || !left || !right || left.id === right.id
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  <GitMerge className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>{busy ? "Synthesizing…" : "Synthesize best of both"}</span>
                  {!busy && (
                    <ArrowRight className="h-3 w-3" strokeWidth={2.25} />
                  )}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  function VersionColumn({
    label,
    versions,
    selectedId,
    onSelect,
  }: {
    label: string;
    versions: AnnotationVersion[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  }) {
    const v = versions.find((vv) => vv.id === selectedId) ?? null;
    return (
      <div
        className="flex flex-col gap-2.5 p-5"
        style={{ background: appleVibe.surface.card }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            {label}
          </span>
          <select
            value={selectedId ?? ""}
            onChange={(e) => onSelect(e.target.value)}
            className="rounded-md border-0 bg-transparent px-1 py-0.5 text-[11.5px] font-semibold outline-none"
            style={{ color: appleVibe.text.primary }}
          >
            {versions.map((vv) => (
              <option key={vv.id} value={vv.id}>
                {GENERATOR_LABEL[vv.generator]} · {fmtTime(vv.generated_at)}
              </option>
            ))}
          </select>
        </div>

        {!v && (
          <div
            className="rounded-lg px-3 py-2 text-[11px] font-light"
            style={{ color: appleVibe.text.tertiary }}
          >
            no version selected
          </div>
        )}

        {v && (
          <>
            <div
              className="rounded-lg px-2.5 py-1.5 text-[10.5px] font-light"
              style={{
                background: appleVibe.surface.chip,
                color: appleVibe.text.secondary,
              }}
            >
              {v.annotations.length} phrases ·{" "}
              {v.annotations.filter((a) => a.analogies.length > 0).length}{" "}
              with analogies ·{" "}
              {v.annotations.filter((a) => a.dimensions.length > 0).length}{" "}
              with layers
            </div>
            <ul className="space-y-1.5">
              {v.annotations.map((a, i) => (
                <li
                  key={i}
                  className="rounded-md px-2 py-1.5"
                  style={{
                    background: appleVibe.surface.base,
                    border: `1px solid ${appleVibe.stroke.hairline}`,
                  }}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-[11.5px] font-semibold"
                      style={{ color: appleVibe.text.primary }}
                    >
                      &ldquo;{a.phrase}&rdquo;
                    </span>
                    {a.crystal && (
                      <span
                        className="rounded-full px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                        style={{
                          background: "rgba(15,23,42,0.06)",
                          color: appleVibe.text.tertiary,
                        }}
                      >
                        {a.crystal}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-0.5 line-clamp-2 text-[11px] font-light leading-snug"
                    style={{ color: appleVibe.text.secondary }}
                  >
                    {a.reading}
                  </p>
                </li>
              ))}
            </ul>

            {/* If this version is a synthesis, show its arbitration record */}
            {v.generator === "synthesis" &&
              v.arbitration_record &&
              v.arbitration_record.length > 0 && (
                <details
                  className="mt-1 rounded-md px-2 py-1.5"
                  style={{
                    background: "rgba(71,85,105,0.04)",
                    border: "1px solid rgba(71,85,105,0.14)",
                  }}
                >
                  <summary
                    className="cursor-pointer text-[10.5px] font-semibold uppercase tracking-wider"
                    style={{ color: "rgba(71,85,105,0.95)" }}
                  >
                    Arbitration record ({v.arbitration_record.length})
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {v.arbitration_record.map((r, i) => (
                      <li
                        key={i}
                        className="text-[10.5px] font-light"
                        style={{ color: appleVibe.text.secondary }}
                      >
                        <span
                          className="font-semibold"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {r.phrase}:
                        </span>{" "}
                        picked {r.picked_from} — {r.why}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
          </>
        )}
      </div>
    );
  }
}

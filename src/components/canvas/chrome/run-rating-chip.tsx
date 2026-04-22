"use client";

// ── Run rating chip (Phase 2E · PR 6.1) ──
//
// Stage 1 of the self-improvement loop. Appears on the
// probability-space rail once a run has completed and the merge
// phase has settled. Lets the user drop a 1-5 star rating + optional
// note; the backend (/api/pipeline/axis-candidate-capture) persists
// the rating and, if ≥4, spawns candidate exemplars for the scorer.
//
// Interaction model:
//   - Unrated → compact "rate run" chip with 5 inline stars. Clicking
//     a star submits immediately (no modal, no "submit" button). A
//     subtle "want to tell us why? (optional)" appears after the
//     submit for qualitative note entry.
//   - After submit → the chip collapses to a confirmation pill
//     ("Rated ★★★★ · thanks!") so the user knows it landed without
//     the UI eating real estate.
//   - Below 4 stars → pill says "Rated · stored for telemetry" (no
//     candidate capture fanfare, honest about what the rating does).
//
// The chip doesn't show at all for unfinished runs — rating the
// middle of a run is meaningless.

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RunRatingChipProps {
  runId: string;
  /** Optional from the frame-extractor response cache. Pass through
   *  so candidate rows get denormalized tags without re-classifying. */
  domain?: string | null;
  questionType?: string | null;
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting"; rating: number }
  | {
      phase: "submitted";
      rating: number;
      candidatesCreated: number;
      noteOpen: boolean;
    }
  | { phase: "error"; error: string };

export function RunRatingChip({
  runId,
  domain,
  questionType,
}: RunRatingChipProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const [note, setNote] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  async function submit(rating: number, withNote = false) {
    setState({ phase: "submitting", rating });
    try {
      const res = await fetch("/api/pipeline/axis-candidate-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          rating,
          note: withNote ? note.slice(0, 2000) : undefined,
          domain: domain ?? null,
          questionType: questionType ?? null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setState({
          phase: "error",
          error: body.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as { candidatesCreated?: number };
      setState({
        phase: "submitted",
        rating,
        candidatesCreated: data.candidatesCreated ?? 0,
        noteOpen: false,
      });
    } catch (err) {
      setState({
        phase: "error",
        error: err instanceof Error ? err.message : "network error",
      });
    }
  }

  async function submitNote() {
    if (state.phase !== "submitted") return;
    if (!note.trim()) return;
    setNoteSubmitting(true);
    try {
      await fetch("/api/pipeline/axis-candidate-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          rating: state.rating,
          note: note.slice(0, 2000),
          domain: domain ?? null,
          questionType: questionType ?? null,
        }),
      });
      setNoteSaved(true);
    } catch {
      // Silent — the note is telemetry-only. A rating still counts
      // even if the note fails to persist.
    } finally {
      setNoteSubmitting(false);
    }
  }

  // ── Submitted state ──
  if (state.phase === "submitted") {
    const stars = "★".repeat(state.rating) + "☆".repeat(5 - state.rating);
    const promotedText =
      state.rating >= 4
        ? state.candidatesCreated > 0
          ? `${state.candidatesCreated} axis${state.candidatesCreated === 1 ? "" : "es"} queued for the exemplar library`
          : "stored for learning"
        : "stored for telemetry";
    return (
      <div className="pointer-events-auto flex max-w-[360px] flex-col items-center gap-1.5">
        <div
          className="flex items-center gap-2 rounded-full border border-emerald-300/60 bg-white/80 px-3 py-1 text-[10.5px] font-medium text-gray-700 shadow-sm backdrop-blur"
          title={`Rated ${state.rating}/5 · ${promotedText}`}
        >
          <span
            className="tabular-nums font-semibold text-amber-600"
            aria-label={`Rated ${state.rating} out of 5`}
          >
            {stars}
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">{promotedText}</span>
        </div>
        {/* Optional free-text follow-up, only surfaced after rating. */}
        {!noteSaved &&
          (state.noteOpen ? (
            <div className="flex w-full flex-col gap-1 rounded-lg border border-gray-200 bg-white/90 px-2 py-1.5 shadow-sm backdrop-blur">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What stood out? What missed?"
                rows={2}
                className="w-full resize-none rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-700 outline-none focus:border-gray-400"
                maxLength={2000}
              />
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] text-gray-400">
                  Optional · {note.length}/2000
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setState({ ...state, noteOpen: false })
                    }
                    className="rounded px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-700"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={submitNote}
                    disabled={noteSubmitting || !note.trim()}
                    className="rounded bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40"
                  >
                    {noteSubmitting ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setState({ ...state, noteOpen: true })}
              className="text-[9.5px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
            >
              want to tell us why? (optional)
            </button>
          ))}
        {noteSaved && (
          <span className="text-[9.5px] text-emerald-600">Saved · thanks!</span>
        )}
      </div>
    );
  }

  // ── Error state — allow retry ──
  if (state.phase === "error") {
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-red-300/60 bg-white/80 px-3 py-1 text-[10.5px] text-red-700 shadow-sm backdrop-blur">
        <span>Rating failed: {state.error}</span>
        <button
          type="button"
          onClick={() => setState({ phase: "idle" })}
          className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Idle / submitting ──
  const active = state.phase === "submitting" ? state.rating : hovered;
  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-[10.5px] text-gray-700 shadow-sm backdrop-blur"
      title="Rate this run — helps the system learn which lenses produce high-caliber outputs for your kind of question."
    >
      <span className="font-medium text-gray-500">Rate run</span>
      <div
        className="flex items-center gap-0.5"
        onMouseLeave={() => setHovered(null)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = active !== null && n <= active;
          const submittingThis =
            state.phase === "submitting" && state.rating === n;
          return (
            <button
              key={n}
              type="button"
              aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
              disabled={state.phase === "submitting"}
              onMouseEnter={() => setHovered(n)}
              onClick={() => submit(n)}
              className={cn(
                "rounded-full p-0.5 transition-transform hover:scale-110 disabled:opacity-50",
                submittingThis && "animate-pulse",
              )}
            >
              <Star
                size={13}
                strokeWidth={1.7}
                className={cn(
                  filled ? "fill-amber-400 text-amber-400" : "text-gray-300",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

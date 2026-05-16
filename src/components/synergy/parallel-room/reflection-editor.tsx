// ── ReflectionEditor (C-2) ──
//
// Lazy 3-line textarea below YOUR checked-AND-within-24h plan-step
// rows. Lets the user write a reflection on how the step is going.
// Auto-saves on blur OR after a 600ms keystroke-pause, whichever
// comes first. Cmd+Enter saves immediately; Esc reverts to the last-
// saved value.
//
// Visual style matches ReflectionDisplay (Apple Notes quote-block) —
// 2px gray-200 left border, gray-700 text, 13px size — so the saved
// state and editing state read as continuous.
//
// Five sub-states:
//   - Collapsed (placeholder, no border)
//   - Focused / dirty (border + textarea + char count)
//   - Saving (textarea + "Saving…" badge bottom-right)
//   - Saved (textarea + "Saved" badge — 1s flash)
//   - Error (textarea + rose-600 "Retry" link bottom-right)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  updateReflection,
  type CheckinRow,
} from "@/lib/synergy/checkin-client";

const MAX_LEN = 2000;
const KEYSTROKE_DEBOUNCE_MS = 600;
const SAVED_FLASH_MS = 1000;

interface Props {
  roomId: string;
  checkinId: string;
  /** Persisted value from the server. Used as the "last saved" anchor. */
  initialReflection: string | null;
  /** Called after a successful save so the parent can update its state. */
  onSaved: (checkin: CheckinRow) => void;
}

type Status = "idle" | "saving" | "saved" | "error";

export function ReflectionEditor({
  roomId,
  checkinId,
  initialReflection,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<string>(initialReflection ?? "");
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // The most-recently-saved value. Used to skip no-op saves + to
  // revert on Esc.
  const savedRef = useRef<string>(initialReflection ?? "");
  // Debounce handle for keystroke-pause auto-save
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saved-flash timeout
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest in-flight buffer (so the async response doesn't stomp
  // newer edits)
  const inflightBufferRef = useRef<string>(savedRef.current);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (flashRef.current) clearTimeout(flashRef.current);
    };
  }, []);

  const save = useCallback(
    async (next: string) => {
      const normalized = next.trim();
      if (normalized === savedRef.current.trim()) return; // no-op
      setStatus("saving");
      setErrorMsg(null);
      inflightBufferRef.current = next;
      try {
        const checkin = await updateReflection({
          roomId,
          checkinId,
          reflection: normalized.length > 0 ? normalized : null,
        });
        // Skip stale responses (user edited again while we were saving)
        if (inflightBufferRef.current !== next) return;
        savedRef.current = checkin.reflection ?? "";
        onSaved(checkin);
        setStatus("saved");
        if (flashRef.current) clearTimeout(flashRef.current);
        flashRef.current = setTimeout(() => setStatus("idle"), SAVED_FLASH_MS);
      } catch (e) {
        if (inflightBufferRef.current !== next) return;
        setStatus("error");
        setErrorMsg((e as Error).message);
      }
    },
    [roomId, checkinId, onSaved],
  );

  const scheduleAutoSave = (next: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void save(next);
    }, KEYSTROKE_DEBOUNCE_MS);
  };

  // ── Collapsed (placeholder) state — only when not focused and empty ──
  if (!focused && draft.trim().length === 0 && status === "idle") {
    return (
      <button
        type="button"
        onClick={() => setFocused(true)}
        className="mt-2 block w-full pl-3 text-left text-[13px] italic leading-relaxed text-gray-400 transition hover:text-gray-600"
      >
        How is this going? (optional)
      </button>
    );
  }

  // ── Expanded editor (or saved display when not focused but non-empty) ──
  return (
    <div className="mt-2">
      <div className="relative">
        <textarea
          autoFocus={focused && draft.length === 0}
          value={draft}
          maxLength={MAX_LEN}
          rows={3}
          onChange={(e) => {
            setDraft(e.target.value);
            setStatus("idle");
            scheduleAutoSave(e.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            void save(draft);
            setFocused(false);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
              }
              void save(draft);
              (e.currentTarget as HTMLTextAreaElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(savedRef.current);
              setStatus("idle");
              setErrorMsg(null);
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
          placeholder="How is this going? (optional)"
          className="w-full resize-none border-l-2 border-gray-200 bg-transparent pl-3 pr-16 text-[13px] leading-relaxed text-gray-700 placeholder:italic placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
        />
        {/* Status badge — bottom-right */}
        <div className="pointer-events-auto absolute right-1 bottom-1 flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-gray-400">
          {status === "saving" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={1.5} />
              Saving…
            </span>
          )}
          {status === "saved" && <span>Saved</span>}
          {status === "error" && (
            <button
              type="button"
              onClick={() => void save(draft)}
              title={errorMsg ?? "Save failed"}
              className="text-rose-600 hover:underline"
            >
              Couldn&apos;t save — retry
            </button>
          )}
          {status === "idle" && focused && (
            <span>
              {draft.length} / {MAX_LEN}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalEntry } from "@/types/use-case";

interface Detected {
  emotions: string[];
  values: string[];
  tensions: string[];
}

interface Props {
  spaceId: string;
  text: string;
  entries: JournalEntry[];
}

const DEBOUNCE_MS = 2000;
const MIN_CHARS = 80;
const EASE = [0.22, 1, 0.36, 1] as const;

function formatEntryDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function JournalAiRail({ spaceId, text, entries }: Props) {
  const [questions, setQuestions] = useState<string[]>([]);
  const [detected, setDetected] = useState<Detected>({
    emotions: [],
    values: [],
    tensions: [],
  });
  const [loading, setLoading] = useState(false);
  const [everFired, setEverFired] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFiredText = useRef("");

  useEffect(() => {
    if (text.trim().length < MIN_CHARS) return;
    // Don't re-fire if text hasn't changed meaningfully (within 20 chars)
    if (Math.abs(text.length - lastFiredText.current.length) < 20 && lastFiredText.current.length > 0) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      lastFiredText.current = text;
      setLoading(true);
      setEverFired(true);
      try {
        const res = await fetch("/api/journal/reflect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ space_id: spaceId, text }),
        });
        if (res.ok) {
          const data = await res.json() as {
            questions: string[];
            detected: Detected;
          };
          setQuestions(data.questions ?? []);
          setDetected(data.detected ?? { emotions: [], values: [], tensions: [] });
        }
      } catch {
        // silent fail — rail is non-critical
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, spaceId]);

  // Echoes: past entries sharing detected values or tensions (client-side match)
  const echoes = entries
    .filter((e) => {
      const valMatch = (e.values_surfaced ?? []).some((v) =>
        detected.values.some(
          (dv) => v.toLowerCase().includes(dv.toLowerCase().slice(0, 8)) || dv.toLowerCase().includes(v.toLowerCase().slice(0, 8)),
        ),
      );
      const tensionMatch = (e.tensions_detected ?? []).some((t) =>
        detected.tensions.some((dt) =>
          t.toLowerCase().includes(dt.toLowerCase().slice(0, 10)) ||
          dt.toLowerCase().includes(t.toLowerCase().slice(0, 10)),
        ),
      );
      return valMatch || tensionMatch;
    })
    .slice(0, 2);

  const hasDetected =
    detected.emotions.length > 0 ||
    detected.values.length > 0 ||
    detected.tensions.length > 0;

  const showRail = text.trim().length >= MIN_CHARS;

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: showRail ? 1 : 0, x: showRail ? 0 : 24 }}
      transition={{ duration: 0.45, ease: EASE }}
      style={{ pointerEvents: showRail ? "auto" : "none" }}
      className="w-[236px] flex-shrink-0 border-l border-[#E8E3DC] bg-[#FAFAF7] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-2">
        <div
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full",
            loading
              ? "bg-amber-100"
              : everFired
                ? "bg-amber-50"
                : "bg-gray-100",
          )}
        >
          {loading ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
          ) : (
            <Sparkles className="h-2.5 w-2.5 text-amber-500" />
          )}
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-600">
          {loading ? "Listening…" : "Surfacing"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-5 scrollbar-hide">
        {/* Reflection questions */}
        <AnimatePresence mode="popLayout">
          {questions.map((q, i) => (
            <motion.div
              key={q.slice(0, 24)}
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.38, ease: EASE, delay: i * 0.08 }}
              className="rounded-xl border border-[#EDE8E1] bg-white px-3.5 py-3 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.07)]"
            >
              <p className="text-[12.5px] leading-[1.7] text-[#3A3530] italic">
                &ldquo;{q}&rdquo;
              </p>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Detected themes */}
        <AnimatePresence>
          {hasDetected && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="space-y-2.5"
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#AEAEB2]">
                Detected
              </p>
              <div className="flex flex-wrap gap-1.5">
                {detected.emotions.map((e) => (
                  <span
                    key={e}
                    className="rounded-full bg-blue-50 px-2 py-[3px] text-[10.5px] font-medium text-blue-700"
                  >
                    {e}
                  </span>
                ))}
                {detected.values.map((v) => (
                  <span
                    key={v}
                    className="rounded-full bg-emerald-50 px-2 py-[3px] text-[10.5px] font-medium text-emerald-700"
                  >
                    {v}
                  </span>
                ))}
                {detected.tensions.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-rose-50 px-2 py-[3px] text-[10.5px] font-medium text-rose-700 max-w-[160px] truncate"
                    title={t}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Echoes — past entries with shared themes */}
        <AnimatePresence>
          {echoes.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="space-y-2"
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#AEAEB2]">
                Echoes
              </p>
              {echoes.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-[#EDE8E1] bg-white px-3 py-2.5"
                >
                  <p className="text-[10px] font-semibold text-[#8E8880]">
                    {formatEntryDate(entry.entry_date)}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-[#5C5852]">
                    {entry.text.slice(0, 90)}…
                  </p>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty nudge before first fire */}
        {!everFired && !loading && (
          <p className="text-[11.5px] leading-relaxed text-[#AEAEB2]">
            Keep writing — I&apos;ll surface patterns and questions as you go.
          </p>
        )}
      </div>
    </motion.aside>
  );
}

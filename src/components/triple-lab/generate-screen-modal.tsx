"use client";

// Generate-screen modal. The user clicks "+Screen" on a variation /
// app / strategy row and this slides in centered with:
//   - target context (what we're generating FOR)
//   - artifact-type picker (4 chips with RECOMMENDED badge)
//   - optional custom brief textarea
//   - generation preview ("we'll generate a 9:16 mobile mockup
//     grounded in name, app_type, top 3 interventions")
//   - submit → progress → success/error
//
// Submission POSTs /api/canvas/generate-screen with the target_kind
// + target_id + artifact_type + prompt_brief + hints (so the server
// doesn't need to re-fetch what the client already has). 10-30s
// latency; we show a determinate-ish progress bar based on an
// expected duration estimate so users know it's still working.

import { useEffect, useState } from "react";
import type { ScreenRow } from "@/app/api/spaces/[id]/screens/route";
import {
  recommendArtifactType,
  type ArtifactType,
} from "@/lib/prompts/screen-generation";
import { colors, tracking } from "./tokens";

export interface GenerateScreenTarget {
  kind: "app" | "variation" | "strategy" | "twin" | "intervention" | "generic";
  id: string | null;
  label: string;
  // Optional hints passed straight through to the prompt builder so
  // the resulting image is grounded in real artifact data, not
  // generic placeholder content.
  hints?: {
    target_summary?: string;
    app_type?: string;
    intervention_titles?: string[];
    metric_names?: string[];
    goal_summary?: string;
    posture?: string;
    top_entity_names?: string[];
  };
}

interface GenerateScreenModalProps {
  target: GenerateScreenTarget | null; // null means closed
  spaceId: string;
  onClose: () => void;
  onSuccess: (screen: ScreenRow) => void;
}

const ARTIFACT_TYPES: Array<{
  value: ArtifactType;
  label: string;
  description: string;
  glyph: string;
}> = [
  {
    value: "mobile",
    label: "Mobile app",
    description: "9:16 portrait · in-frame phone mockup",
    glyph: "▭",
  },
  {
    value: "web",
    label: "Web app",
    description: "16:10 landscape · browser-chrome dashboard",
    glyph: "▤",
  },
  {
    value: "twin",
    label: "Digital twin",
    description: "16:9 ops dashboard · live state + topology",
    glyph: "◈",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Format inferred from your brief below",
    glyph: "⚙",
  },
];

export function GenerateScreenModal({
  target,
  spaceId,
  onClose,
  onSuccess,
}: GenerateScreenModalProps) {
  // Picked artifact type — recomputed when target changes so the
  // recommendation refreshes per-target.
  const [artifactType, setArtifactType] = useState<ArtifactType>(() =>
    target
      ? recommendArtifactType({
          target_kind: target.kind,
          app_type: target.hints?.app_type,
        })
      : "web",
  );
  const [recommended, setRecommended] = useState<ArtifactType>(artifactType);
  const [brief, setBrief] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Simulated determinate progress while the request is in-flight.
  // Real progress isn't available from gpt-image-1; we ease towards
  // 95% over ~20s so the user has feedback. Jumps to 100% on success.
  const [progress, setProgress] = useState<number>(0);

  // When the target changes, reset state.
  useEffect(() => {
    if (!target) return;
    const next = recommendArtifactType({
      target_kind: target.kind,
      app_type: target.hints?.app_type,
    });
    setArtifactType(next);
    setRecommended(next);
    setBrief("");
    setError(null);
    setProgress(0);
    setSubmitting(false);
  }, [target]);

  // Esc to close, ⌘⏎ to submit.
  useEffect(() => {
    if (!target) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      } else if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        !submitting
      ) {
        e.preventDefault();
        void submit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, submitting, artifactType, brief]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!target) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [target]);

  // Animate determinate progress: ease toward 95% over ~20s while
  // submitting. Capped so user knows the wait is bounded. On success
  // we flash to 100% then close.
  useEffect(() => {
    if (!submitting) return;
    const start = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      // Ease-out curve: hits ~80% at 16s, ~92% at 24s, plateau at 95%
      const pct = Math.min(95, 100 * (1 - Math.exp(-elapsed / 9)));
      setProgress(pct);
    }, 250);
    return () => window.clearInterval(interval);
  }, [submitting]);

  if (!target) return null;

  const submit = async () => {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    setProgress(0);
    try {
      const res = await fetch("/api/canvas/generate-screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_kind: target.kind,
          target_id: target.id,
          target_label: target.label,
          space_id: spaceId,
          artifact_type: artifactType,
          prompt_brief: brief.trim() || null,
          hints: target.hints ?? null,
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // ignore
        }
        setError(msg);
        setSubmitting(false);
        return;
      }
      const row = (await res.json()) as ScreenRow;
      setProgress(100);
      // Brief delay so the user sees the 100% before close.
      setTimeout(() => {
        onSuccess(row);
        setSubmitting(false);
      }, 320);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  // Generation preview string — describes what's about to be sent so
  // the user knows what to expect.
  const preview = buildPreviewLine({ artifactType, target });

  return (
    <div
      onClick={() => !submitting && onClose()}
      className="fixed inset-0 z-[55] flex items-center justify-center"
      style={{
        background: "rgba(8, 12, 22, 0.65)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{
          width: "min(560px, 92vw)",
          boxShadow: "0 32px 64px rgba(8, 12, 22, 0.4)",
        }}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div
          className="px-5 pb-3 pt-5"
          style={{ background: colors.neutral.panelBgFlat }}
        >
          <div
            className="text-[9px] font-bold uppercase"
            style={{
              color: colors.brand.fg,
              letterSpacing: tracking.eyebrow,
            }}
          >
            ⊕ Generate prototype
          </div>
          <div className="mt-1 text-[16px] font-bold text-slate-900">
            Screen for &ldquo;{target.label}&rdquo;
          </div>
          {target.hints?.target_summary && (
            <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
              {target.hints.target_summary}
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="space-y-4 px-5 py-4">
          {/* Artifact-type picker */}
          <div>
            <div
              className="mb-1.5 text-[9px] font-bold uppercase text-slate-500"
              style={{ letterSpacing: tracking.eyebrow }}
            >
              Artifact type
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ARTIFACT_TYPES.map((t) => {
                const active = artifactType === t.value;
                const isRecommended = t.value === recommended;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => !submitting && setArtifactType(t.value)}
                    disabled={submitting}
                    className="group relative rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-50"
                    style={{
                      background: active
                        ? colors.brand.bgSoft
                        : colors.neutral.panelBg,
                      borderColor: active
                        ? colors.brand.fg
                        : colors.neutral.borderFaint,
                      boxShadow: active
                        ? `0 6px 16px ${colors.brand.shadow}`
                        : "none",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="font-mono text-[11px] font-bold"
                        style={{
                          color: active
                            ? colors.brand.fg
                            : colors.neutral.fg500,
                        }}
                      >
                        {t.glyph}
                      </span>
                      <span
                        className="text-[11.5px] font-semibold"
                        style={{
                          color: active
                            ? colors.brand.fgDark
                            : colors.neutral.fg700,
                        }}
                      >
                        {t.label}
                      </span>
                      {isRecommended && (
                        <span
                          className="ml-auto rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                          style={{
                            background: active
                              ? colors.brand.gradient
                              : colors.state.okSoft,
                            color: active ? "white" : colors.state.okFg,
                          }}
                        >
                          REC
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-slate-500">
                      {t.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom brief */}
          <div>
            <div
              className="mb-1.5 flex items-center justify-between"
            >
              <div
                className="text-[9px] font-bold uppercase text-slate-500"
                style={{ letterSpacing: tracking.eyebrow }}
              >
                Custom brief (optional)
              </div>
              <span className="text-[9px] text-slate-400">{brief.length} / 500</span>
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value.slice(0, 500))}
              disabled={submitting}
              placeholder="Add specific UI elements, color palette, or layout constraints…"
              rows={3}
              className="w-full resize-none rounded-md border px-2.5 py-1.5 text-[11.5px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
              style={{
                background: "white",
                borderColor: colors.neutral.borderInput,
              }}
            />
          </div>

          {/* Generation preview */}
          <div
            className="rounded-md px-3 py-2 text-[10.5px] leading-relaxed"
            style={{
              background: colors.brand.bgPanel,
              color: colors.brand.fgDarker,
            }}
          >
            <span className="font-semibold">Will generate:</span> {preview}
          </div>

          {/* Progress bar (when submitting) */}
          {submitting && (
            <div className="space-y-1.5">
              <div
                className="h-1 overflow-hidden rounded-full"
                style={{ background: colors.neutral.chipBg }}
              >
                <div
                  className="h-full transition-[width]"
                  style={{
                    width: `${progress}%`,
                    background: colors.brand.gradient,
                    transitionDuration: "260ms",
                  }}
                />
              </div>
              <div
                className="text-[10px] uppercase tracking-wider"
                style={{ color: colors.brand.fgDark }}
              >
                {progress < 95
                  ? "Generating mockup… (gpt-image-1 takes 15-25s)"
                  : "Almost there…"}
              </div>
            </div>
          )}

          {/* Error */}
          {error && !submitting && (
            <div
              className="rounded-md px-3 py-2 text-[10.5px] leading-relaxed"
              style={{
                background: colors.state.bottleneckSoft,
                color: colors.state.bottleneckFg,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between gap-2 border-t px-5 py-3"
          style={{
            borderTopColor: colors.neutral.borderFaint,
            background: colors.neutral.panelBgFlat,
          }}
        >
          <div className="text-[9.5px] text-slate-500">
            ⌘⏎ to submit · Esc to cancel
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-md px-3.5 py-1.5 text-[11px] font-bold text-white transition-all disabled:opacity-60"
              style={{
                background: colors.brand.gradient,
                boxShadow: `0 4px 14px ${colors.brand.shadow}`,
              }}
            >
              {submitting ? "Generating…" : "Generate · ~20s"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper: build the preview line in the modal ─────────────────────
function buildPreviewLine({
  artifactType,
  target,
}: {
  artifactType: ArtifactType;
  target: GenerateScreenTarget;
}): string {
  const framing =
    artifactType === "mobile"
      ? "a 9:16 mobile app screen"
      : artifactType === "web"
      ? "a 16:10 web dashboard"
      : artifactType === "twin"
      ? "a 16:9 digital-twin operations view"
      : "a custom layout inferred from your brief";
  const grounding: string[] = [];
  grounding.push(`title "${target.label}"`);
  if (target.hints?.intervention_titles?.length) {
    grounding.push(
      `${target.hints.intervention_titles.length} intervention cards`,
    );
  }
  if (target.hints?.metric_names?.length) {
    grounding.push(
      `${target.hints.metric_names.length} live metrics`,
    );
  }
  if (target.hints?.goal_summary) {
    grounding.push("optimization point as headline");
  }
  return `${framing} grounded in ${grounding.join(" · ")}.`;
}

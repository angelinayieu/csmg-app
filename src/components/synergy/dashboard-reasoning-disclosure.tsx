// ── Dashboard reasoning disclosure ──
//
// The Apple-aesthetic redesign of the legacy "Reasoning settings"
// panel. Two collapsible groups:
//
//   1. Ask me clarifying questions (always on for the dashboard now,
//      but the toggle stays so power users can suppress them)
//   2. Reasoning lenses (multi-select — which framing personas run)
//
// The destination route reads `lenses` + `askClarifying` from the
// URL when the modal is bypassed; otherwise the modal pulls the
// questions and bakes them into the prompt up-front, so the
// destination receives a refined prompt regardless.
//
// Visual: a thin chip under the chatbox that flips open into a
// glass panel. Closed by default. The chip shows the count of
// active customizations so the user knows the panel is live without
// having to open it.

"use client";

import { useMemo } from "react";
import { ChevronDown, MessageCircleQuestion, SlidersHorizontal } from "lucide-react";
import {
  type ReasoningLens,
  type ReasoningSettings,
  DEFAULT_REASONING_SETTINGS,
  LENS_META,
} from "@/types/reasoning-settings";

const LENS_ORDER: ReasoningLens[] = [
  "systems_analyst",
  "skeptic",
  "operator",
  "engineer",
  "historian",
];

interface Props {
  open: boolean;
  onToggle: () => void;
  settings: ReasoningSettings;
  onChange: (next: ReasoningSettings) => void;
  disabled?: boolean;
}

export function DashboardReasoningDisclosure({
  open,
  onToggle,
  settings,
  onChange,
  disabled = false,
}: Props) {
  const customCount = useMemo(() => {
    let n = 0;
    const defaults = new Set(DEFAULT_REASONING_SETTINGS.lenses);
    const current = new Set(settings.lenses);
    if (
      defaults.size !== current.size ||
      [...defaults].some((l) => !current.has(l))
    )
      n += 1;
    if (settings.askClarifyingQuestions !== DEFAULT_REASONING_SETTINGS.askClarifyingQuestions) n += 1;
    if (settings.buildBaselineFirst !== DEFAULT_REASONING_SETTINGS.buildBaselineFirst) n += 1;
    if (settings.showAlternatives !== DEFAULT_REASONING_SETTINGS.showAlternatives) n += 1;
    return n;
  }, [settings]);

  const toggleLens = (lens: ReasoningLens) => {
    if (disabled) return;
    const has = settings.lenses.includes(lens);
    if (has && settings.lenses.length === 1) return;
    onChange({
      ...settings,
      lenses: has
        ? settings.lenses.filter((l) => l !== lens)
        : [...settings.lenses, lens],
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-50"
        aria-expanded={open}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.7} />
        Reasoning settings
        {customCount > 0 && (
          <span
            className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[9px] font-semibold text-white"
            style={{ background: "#0f172a" }}
          >
            {customCount}
          </span>
        )}
        <ChevronDown
          className={[
            "h-3.5 w-3.5 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          strokeWidth={1.7}
        />
      </button>

      {open && (
        <div
          className="mt-2 rounded-2xl px-5 py-4"
          style={{
            background: "rgba(255, 255, 255, 0.72)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.65)",
            boxShadow: [
              "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
              "0 12px 32px -12px rgba(15, 23, 42, 0.1)",
            ].join(", "),
            animation: "dashRsIn 220ms ease both",
          }}
        >
          {/* Process toggles */}
          <Section label="Process">
            <ToggleRow
              label="Ask me clarifying questions"
              description="Sharpen the goal with three flashcard-style questions before we route."
              icon={<MessageCircleQuestion className="h-3 w-3" strokeWidth={2} />}
              checked={settings.askClarifyingQuestions}
              onToggle={(v) =>
                onChange({ ...settings, askClarifyingQuestions: v })
              }
              disabled={disabled}
            />
            <ToggleRow
              label="Build baseline first"
              description="Analyze your current state (inputs · process · outputs) before generating options."
              checked={settings.buildBaselineFirst}
              onToggle={(v) =>
                onChange({ ...settings, buildBaselineFirst: v })
              }
              disabled={disabled}
            />
            <ToggleRow
              label="Show alternative strategies"
              description="Generate three strategy variants in parallel instead of just the top-ranked one."
              checked={settings.showAlternatives}
              onToggle={(v) =>
                onChange({ ...settings, showAlternatives: v })
              }
              disabled={disabled}
            />
          </Section>

          <div className="my-4 h-px bg-black/[0.06]" />

          {/* Lenses */}
          <Section
            label="Reasoning lenses"
            hint="Which framing personas analyze your prompt. At least one must stay active."
          >
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {LENS_ORDER.map((lens) => {
                const m = LENS_META[lens];
                const active = settings.lenses.includes(lens);
                return (
                  <button
                    key={lens}
                    type="button"
                    onClick={() => toggleLens(lens)}
                    disabled={disabled}
                    className="group flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition disabled:opacity-50"
                    style={
                      active
                        ? {
                            background: `color-mix(in srgb, ${m.accent} 12%, white)`,
                            borderColor: `${m.accent}55`,
                          }
                        : {
                            background: "white",
                            borderColor: "rgba(15, 23, 42, 0.1)",
                          }
                    }
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: active ? m.accent : "transparent",
                        boxShadow: active
                          ? "none"
                          : "inset 0 0 0 1px rgba(15, 23, 42, 0.18)",
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-[11.5px] font-semibold"
                        style={{ color: active ? m.accent : "rgb(31, 41, 55)" }}
                      >
                        {m.label}
                      </span>
                      <span className="block text-[10px] leading-tight text-gray-500">
                        {m.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          {customCount > 0 && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => onChange({ ...DEFAULT_REASONING_SETTINGS })}
                disabled={disabled}
                className="text-[10.5px] font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50"
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes dashRsIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
      {hint && (
        <p className="mb-2 text-[11px] leading-relaxed text-gray-500">{hint}</p>
      )}
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  icon,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  description: string;
  icon?: React.ReactNode;
  checked: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-black/[0.03] disabled:opacity-50"
    >
      <span
        className="relative mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
        style={{ background: checked ? "#0f172a" : "rgba(15, 23, 42, 0.18)" }}
      >
        <span
          className="inline-block h-3 w-3 transform rounded-full bg-white transition-transform"
          style={{
            transform: checked ? "translateX(14px)" : "translateX(2px)",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.18)",
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[12px] font-semibold text-gray-900">
          {icon}
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
          {description}
        </span>
      </span>
    </button>
  );
}

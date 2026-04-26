"use client";

// ── Reasoning settings panel ──────────────────────────────────────
//
// Collapsible panel that lives under the prompt intake. Lets users
// customize how the pipeline reasons before they submit:
//
//   - Lenses (multi-select): which framing personas run
//   - Process toggles: ask clarifying questions, build baseline first,
//                       show alternatives
//
// Reasoning depth is intentionally NOT in this panel — it has its own
// inline pill control next to the submit button (Fast / Balanced / Deep).
// The two could be merged in a future iteration; for now keeping them
// separate matches the existing UI convention users learned.
//
// Closed by default — first-time users get smart defaults without
// needing to think about the panel. The "n active" badge in the header
// signals when the user has customized something.

import { useMemo } from "react";
import { ChevronDown, MessageCircleQuestion, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
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

export interface ReasoningSettingsPanelProps {
  open: boolean;
  onToggle: () => void;
  settings: ReasoningSettings;
  onChange: (next: ReasoningSettings) => void;
  /** Disabled while a submit is in flight — toggling settings during
   *  bootstrap would create a confusing race. */
  disabled?: boolean;
}

export function ReasoningSettingsPanel({
  open,
  onToggle,
  settings,
  onChange,
  disabled = false,
}: ReasoningSettingsPanelProps) {
  // Count how many user-customized fields differ from defaults so the
  // header badge reflects "active customization" — important UX cue
  // when the panel is closed.
  const customCount = useMemo(() => {
    let n = 0;
    const defaultLenses = new Set(DEFAULT_REASONING_SETTINGS.lenses);
    const currentLenses = new Set(settings.lenses);
    if (
      defaultLenses.size !== currentLenses.size ||
      [...defaultLenses].some((l) => !currentLenses.has(l))
    )
      n += 1;
    if (settings.askClarifyingQuestions) n += 1;
    if (settings.buildBaselineFirst) n += 1;
    if (!settings.showAlternatives) n += 1;
    return n;
  }, [settings]);

  const toggleLens = (lens: ReasoningLens) => {
    if (disabled) return;
    const has = settings.lenses.includes(lens);
    // At least one lens must remain active — never let the user
    // deselect everything (would degenerate the framing panel).
    if (has && settings.lenses.length === 1) return;
    onChange({
      ...settings,
      lenses: has
        ? settings.lenses.filter((l) => l !== lens)
        : [...settings.lenses, lens],
    });
  };

  return (
    <div
      className="rounded-lg border transition-colors"
      style={{
        borderColor: "var(--home-chrome-stroke)",
        background: open ? "var(--home-chrome-fill)" : "transparent",
      }}
    >
      {/* Header — clickable trigger */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/40 disabled:opacity-50"
      >
        <SlidersHorizontal
          className="h-3.5 w-3.5 text-[color:var(--home-text-mid)]"
          strokeWidth={2}
        />
        <span className="text-[11.5px] font-semibold text-[color:var(--home-text)]">
          Reasoning settings
        </span>
        {customCount > 0 && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums"
            style={{
              background: "var(--home-cta-bg)",
              color: "var(--home-cta-fg)",
            }}
          >
            {customCount}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 text-[color:var(--home-text-mid)] transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {/* Body */}
      {open && (
        <div className="space-y-4 border-t px-3 py-3" style={{ borderColor: "var(--home-chrome-stroke)" }}>
          {/* Lenses — which personas run during framing */}
          <Section
            label="Reasoning lenses"
            hint="Which personas analyze the prompt at framing time. At least one must stay active."
          >
            <div className="grid grid-cols-1 gap-1.5">
              {LENS_ORDER.map((lens) => {
                const meta = LENS_META[lens];
                const active = settings.lenses.includes(lens);
                return (
                  <button
                    key={lens}
                    type="button"
                    onClick={() => toggleLens(lens)}
                    disabled={disabled}
                    className={cn(
                      "group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50",
                      active
                        ? "border-transparent"
                        : "border-[color:var(--home-chrome-stroke)] hover:bg-white/30",
                    )}
                    style={
                      active
                        ? {
                            background: `color-mix(in srgb, ${meta.accent} 14%, transparent)`,
                            borderColor: `color-mix(in srgb, ${meta.accent} 40%, transparent)`,
                          }
                        : {}
                    }
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{
                        background: active ? meta.accent : "transparent",
                        border: active
                          ? "none"
                          : "1px solid var(--home-text-faint)",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[11px] font-semibold"
                        style={{
                          color: active
                            ? meta.accent
                            : "var(--home-text)",
                        }}
                      >
                        {meta.label}
                      </div>
                      <div className="text-[9.5px] leading-tight text-[color:var(--home-text-faint)]">
                        {meta.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Process toggles */}
          <Section label="Process">
            <div className="space-y-1">
              <ToggleRow
                label="Ask me clarifying questions"
                description="Generate 3-5 questions to fill gaps before analysis runs"
                icon={
                  <MessageCircleQuestion
                    className="h-3 w-3"
                    strokeWidth={2}
                  />
                }
                checked={settings.askClarifyingQuestions}
                onToggle={(v) =>
                  onChange({ ...settings, askClarifyingQuestions: v })
                }
                disabled={disabled}
              />
              <ToggleRow
                label="Build baseline first"
                description="Analyze your current state (inputs / process / outputs) before landscape generation"
                checked={settings.buildBaselineFirst}
                onToggle={(v) =>
                  onChange({ ...settings, buildBaselineFirst: v })
                }
                disabled={disabled}
              />
              <ToggleRow
                label="Show alternative strategies"
                description="Generate 3 strategy variants in parallel instead of just the top-ranked"
                checked={settings.showAlternatives}
                onToggle={(v) =>
                  onChange({ ...settings, showAlternatives: v })
                }
                disabled={disabled}
              />
            </div>
          </Section>

          {/* Reset to defaults */}
          {customCount > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_REASONING_SETTINGS })}
              disabled={disabled}
              className="text-[10px] font-medium text-[color:var(--home-text-mid)] underline-offset-2 hover:underline disabled:opacity-50"
            >
              Reset to defaults
            </button>
          )}
        </div>
      )}
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
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--home-text-faint)]">
        {label}
      </div>
      {hint && (
        <div className="mb-2 text-[10px] leading-relaxed text-[color:var(--home-text-mid)]">
          {hint}
        </div>
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
      className={cn(
        "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50",
        checked
          ? "border-transparent bg-[color-mix(in_srgb,var(--home-cta-bg)_10%,transparent)]"
          : "border-[color:var(--home-chrome-stroke)] hover:bg-white/30",
      )}
    >
      {/* Switch */}
      <span
        className={cn(
          "relative mt-0.5 inline-flex h-3.5 w-7 flex-shrink-0 items-center rounded-full transition-colors",
        )}
        style={{
          background: checked
            ? "var(--home-cta-bg)"
            : "var(--home-chrome-fill-hover)",
        }}
      >
        <span
          className="inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform"
          style={{
            transform: checked ? "translateX(15px)" : "translateX(2px)",
          }}
        />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--home-text)]">
          {icon}
          {label}
        </div>
        <div className="text-[9.5px] leading-tight text-[color:var(--home-text-faint)]">
          {description}
        </div>
      </div>
    </button>
  );
}

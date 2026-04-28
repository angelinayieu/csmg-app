"use client";

// ── Contextual Inspector ──────────────────────────────────────────
//
// Slide-in drawer from the right when a chamber subunit is clicked.
// Shows component metadata + live state in current configuration:
//   - colored badge + name + role
//   - mechanism description
//   - current weight (0–100) under the active config
//   - active effects targeting this component
//   - bonded components (the other 3) — clickable to switch focus
//
// Closes via:
//   - X button
//   - Backdrop click
//   - Escape key

import { useEffect } from "react";
import { X } from "lucide-react";
import { COMPONENTS, getComponent } from "../lib/components-defs";
import type { Prediction, ActiveEffect } from "../lib/types";

export interface ContextualInspectorProps {
  componentId: string | null;
  prediction: Prediction;
  subjectName: string;
  onClose: () => void;
  onSwitchComponent: (id: string) => void;
}

export function ContextualInspector({
  componentId,
  prediction,
  subjectName,
  onClose,
  onSwitchComponent,
}: ContextualInspectorProps) {
  const open = !!componentId;
  const component = componentId ? getComponent(componentId) : null;

  // Escape key closes the drawer.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!component) {
    // Render the backdrop+drawer empty so the slide-in animation
    // class drives without us needing to mount/unmount on toggle.
    return null;
  }

  const currentWeight = Math.round(prediction.compWeights[component.id]);
  const colorBg = `${component.color}20`;
  const targetGreek = greekForComponent(component.id);
  const relevantEffects = prediction.effects.filter((e) =>
    effectTargetsComponent(e, component.id),
  );

  const bonded = COMPONENTS.filter((c) => c.id !== component.id);

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className="fixed inset-0 z-[90] bg-black/15 backdrop-blur-[2px]"
        style={{ animation: "ctx-fade-in 0.25s ease-out" }}
      />

      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 z-[100] flex h-screen w-[440px] max-w-[90vw] flex-col overflow-hidden border-l border-black/[0.08] bg-white shadow-[-20px_0_48px_rgba(0,0,0,0.12)]"
        style={{ animation: "ctx-slide-in 0.3s cubic-bezier(0.25,0.1,0.25,1)" }}
      >
        {/* Header */}
        <div
          className="relative border-b border-black/[0.05] px-[22px] pb-4 pt-[18px]"
          style={{
            background: `linear-gradient(180deg, ${component.color}10, #ffffff)`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3.5 top-3.5 grid h-[30px] w-[30px] place-items-center rounded-[7px] bg-[#f2f2f4] text-[#6e6e73] transition-colors hover:bg-black/[0.08] hover:text-[#1d1d1f]"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div
            className="mb-2.5 inline-flex items-center gap-1.5 rounded-[20px] border border-black/[0.05] bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em]"
            style={{ color: component.color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: component.color }}
              aria-hidden
            />
            Internal Component
          </div>

          <div className="flex items-center gap-2.5 text-[22px] font-bold leading-[1.15] tracking-[-0.02em] text-[#1d1d1f]">
            <span
              className="relative grid h-9 w-9 place-items-center rounded-[9px] text-[18px] font-bold leading-none"
              style={{ background: colorBg, color: component.color }}
            >
              {component.sym}
              {component.sub && (
                <span className="absolute bottom-0.5 right-1 text-[10px] font-bold leading-none">
                  {component.sub}
                </span>
              )}
            </span>
            {component.name}
          </div>
          <div className="mt-1 text-[13px] text-[#6e6e73]">
            Role: {component.role}
          </div>
          <div className="mt-2.5 text-[13px] leading-[1.5] text-[#424245]">
            {component.desc}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Live state */}
          <Section title="Live State">
            <div
              className="rounded-[10px] border border-black/[0.05] bg-[#fbfbfd] p-3.5"
              style={{ borderLeftWidth: 3, borderLeftColor: component.color }}
            >
              <div className="mb-2 grid grid-cols-2 gap-2.5">
                <KV
                  label="Current weight"
                  value={
                    <>
                      {currentWeight}
                      <span className="text-[11px] font-medium text-[#6e6e73]">
                        /100
                      </span>
                    </>
                  }
                />
                <KV label="Under config" value={subjectName} small />
              </div>
              <div className="border-t border-black/[0.05] pt-2.5 text-[12px] leading-[1.4] text-[#424245]">
                <b className="font-semibold text-[#1d1d1f]">Mechanism · </b>
                {component.mechanism}
              </div>
            </div>

            {relevantEffects.length > 0 && (
              <div className="mt-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#6e6e73]">
                  Active effects on {targetGreek}
                </div>
                <div className="space-y-1">
                  {relevantEffects.map((e, idx) => (
                    <EffectMiniRow key={`${e.name}-${idx}`} effect={e} />
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Bonded components */}
          <Section title="Bonded Components">
            <div className="flex flex-wrap gap-1.5">
              {bonded.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSwitchComponent(b.id)}
                  className="inline-flex items-center gap-1.5 rounded-[20px] border border-transparent px-2.5 py-1 text-[11px] font-semibold transition-all hover:-translate-y-px"
                  style={{
                    background: `${b.color}20`,
                    color: b.color,
                    borderColor: "transparent",
                  }}
                >
                  <span className="font-bold">
                    {b.sym}
                    {b.sub}
                  </span>
                  {b.name}
                </button>
              ))}
            </div>
          </Section>
        </div>
      </aside>

      {/* Animations — kept inline so the drawer is self-contained. */}
      <style jsx>{`
        @keyframes ctx-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes ctx-slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-black/[0.05] px-[22px] py-[14px] last:border-b-0">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  small = false,
}: {
  label: string;
  value: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[#86868b]">
        {label}
      </div>
      <div
        className={
          "font-semibold leading-tight tracking-[-0.01em] text-[#1d1d1f] " +
          (small ? "text-[12px]" : "text-[13px]")
        }
      >
        {value}
      </div>
    </div>
  );
}

function EffectMiniRow({ effect }: { effect: ActiveEffect }) {
  const negative = effect.value < 0;
  return (
    <div className="flex items-center justify-between rounded-md border border-black/[0.05] bg-[#fbfbfd] px-2.5 py-1.5 text-[12px]">
      <span className="text-[#424245]">{effect.name}</span>
      <span
        className="font-bold tabular-nums"
        style={{ color: negative ? "#ff3b30" : "#34c759" }}
      >
        {effect.value > 0 ? "+" : ""}
        {effect.value.toFixed(2)}
      </span>
    </div>
  );
}

// ── Effect→component target matching ─────────────────────────────
// `predict()` only emits target ∈ {K, α, τ, ρ}. We translate
// component id → which targets are relevant. Buffer effects show
// up under K; Decay under K when the effect name mentions decay;
// Rehearsal under K when the effect name mentions refresh; Attention
// under α.

function effectTargetsComponent(
  effect: ActiveEffect,
  componentId: string,
): boolean {
  const nm = effect.name.toLowerCase();
  switch (componentId) {
    case "buffer":
      return effect.target === "K";
    case "attention":
      return effect.target === "α";
    case "decay":
      return effect.target === "τ" || (effect.target === "K" && nm.includes("decay"));
    case "rehearsal":
      return (
        effect.target === "ρ" ||
        (effect.target === "K" && (nm.includes("refresh") || nm.includes("rehearsal")))
      );
    default:
      return false;
  }
}

function greekForComponent(id: string): string {
  switch (id) {
    case "buffer":
      return "K";
    case "attention":
      return "α";
    case "decay":
      return "τ";
    case "rehearsal":
      return "ρ";
    default:
      return id;
  }
}

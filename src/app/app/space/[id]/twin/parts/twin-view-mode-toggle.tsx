"use client";

// ── View-mode toggle for the System tab ────────────────────────────
//
// Three modes: Workflow / Layers / Mechanisms — three intentions for
// browsing the same data.
//
// Same Apple-segmented-pill pattern I built for the strategy doc's
// Linear/Timeline/Cards toggle. Active state gets a white fill +
// subtle shadow; inactives are flat.

import {
  SystemModelIcon,
  LayerIcon,
  MechanismIcon,
} from "@/components/twin/icons/twin-icons";

export type SystemViewMode = "workflow" | "layers" | "mechanisms";

interface Props {
  value: SystemViewMode;
  onChange: (next: SystemViewMode) => void;
}

const ITEMS: {
  key: SystemViewMode;
  label: string;
  Icon: typeof SystemModelIcon;
}[] = [
  { key: "workflow", label: "Workflow", Icon: SystemModelIcon },
  { key: "layers", label: "Layers", Icon: LayerIcon },
  { key: "mechanisms", label: "Mechanisms", Icon: MechanismIcon },
];

export function TwinViewModeToggle({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="System view mode"
      className="inline-flex items-center gap-0.5 rounded-full p-0.5"
      style={{
        background: "rgba(15,23,42,0.04)",
        boxShadow: "inset 0 0 0 1px var(--glass-hairline)",
      }}
    >
      {ITEMS.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-all",
              active
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900",
            ].join(" ")}
            style={
              active
                ? {
                    boxShadow:
                      "var(--shadow-card), inset 0 0 0 1px var(--glass-hairline)",
                  }
                : undefined
            }
          >
            <Icon size={11} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

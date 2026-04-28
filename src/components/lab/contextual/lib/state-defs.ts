// ── State slider definitions ──────────────────────────────────────
//
// Verbatim from reference. Each slider drives one entry in the
// state bag that prediction consumes (sleep deficit, vigilance
// decrement, Yerkes-Dodson stress, caffeine sigmoid, circadian).

import type { StateDef, StateBag } from "./types";

export const STATE_DEFS: StateDef[] = [
  {
    id: "sleep",
    label: "Sleep",
    sub: "hours",
    min: 0,
    max: 12,
    step: 0.5,
    def: 8,
    fmt: (v) => v.toFixed(1) + "h",
    warn: (v) => v < 6,
    alert: (v) => v < 4,
  },
  {
    id: "tot",
    label: "Time on task",
    sub: "minutes",
    min: 0,
    max: 240,
    step: 5,
    def: 0,
    fmt: (v) => Math.round(v) + "m",
    warn: (v) => v > 90,
    alert: (v) => v > 180,
  },
  {
    id: "stress",
    label: "Stress",
    sub: "0–10",
    min: 0,
    max: 10,
    step: 0.5,
    def: 2,
    fmt: (v) => v.toFixed(1),
    warn: (v) => v > 5,
    alert: (v) => v > 7,
  },
  {
    id: "caffeine",
    label: "Caffeine",
    sub: "mg",
    min: 0,
    max: 400,
    step: 25,
    def: 0,
    fmt: (v) => Math.round(v) + "mg",
    warn: (v) => v > 300,
    alert: (v) => v > 400,
  },
  {
    id: "timeOfDay",
    label: "Time of day",
    sub: "24h clock",
    min: 0,
    max: 24,
    step: 0.5,
    def: 10,
    fmt: (v) => {
      const h = Math.floor(v).toString().padStart(2, "0");
      const m = Math.round((v % 1) * 60)
        .toString()
        .padStart(2, "0");
      return `${h}:${m}`;
    },
    warn: (v) => v < 6 || v > 22,
    alert: (v) => v < 4 || v > 23,
  },
];

export function defaultStateBag(): StateBag {
  const bag: Partial<StateBag> = {};
  for (const d of STATE_DEFS) {
    bag[d.id] = d.def;
  }
  return bag as StateBag;
}

export function getStateDef(id: string): StateDef | null {
  return STATE_DEFS.find((d) => d.id === id) ?? null;
}

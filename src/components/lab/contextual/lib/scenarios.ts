// ── Scenario presets ─────────────────────────────────────────────
//
// 8 one-click load presets verbatim from reference. Each sets
// subject + state + task atomically. The Scenario Library panel
// renders these with descriptions.

import type { ScenarioDef } from "./types";

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "baseline",
    name: "Baseline Reference",
    subj: "typical_adult",
    state: { sleep: 8, tot: 0, stress: 2, caffeine: 0, timeOfDay: 10 },
    task: "digit_span",
    desc: "Healthy rested adult on a simple verbal task. The anchor point.",
  },
  {
    id: "post_call",
    name: "Resident Post-Call at 3am",
    subj: "medic_resident",
    state: { sleep: 0, tot: 120, stress: 6, caffeine: 200, timeOfDay: 3 },
    task: "handoff",
    desc: "Surgical resident ending a 26-hour shift, handing off 6 patients.",
  },
  {
    id: "expert_flow",
    name: "Chess Master in Flow",
    subj: "expert_chess",
    state: { sleep: 8, tot: 20, stress: 3, caffeine: 100, timeOfDay: 10 },
    task: "chess_pos",
    desc: "Chess master 20 min into tournament game, mild caffeine.",
  },
  {
    id: "expert_off_domain",
    name: "Chess Master on Digits",
    subj: "expert_chess",
    state: { sleep: 8, tot: 0, stress: 2, caffeine: 0, timeOfDay: 10 },
    task: "digit_span",
    desc: "Same master on domain-irrelevant digit span. Expertise does not transfer.",
  },
  {
    id: "elderly_afternoon",
    name: "Older Adult, Afternoon",
    subj: "older_adult",
    state: { sleep: 6, tot: 30, stress: 2, caffeine: 50, timeOfDay: 15 },
    task: "mental_rot",
    desc: "Older adult mid-afternoon slump learning a spatial manipulation.",
  },
  {
    id: "all_nighter",
    name: "Student All-Nighter",
    subj: "typical_adult",
    state: { sleep: 0, tot: 180, stress: 5, caffeine: 350, timeOfDay: 5 },
    task: "reading_span",
    desc: "Student pulling all-nighter, 3h into reading, heavy caffeine.",
  },
  {
    id: "anxious_test",
    name: "Anxious Adult, High Stakes",
    subj: "anxiety",
    state: { sleep: 5, tot: 10, stress: 8, caffeine: 100, timeOfDay: 9 },
    task: "n_back",
    desc: "High-anxiety adult in high-stakes updating task.",
  },
  {
    id: "adhd_classroom",
    name: "ADHD Adult, Noisy Context",
    subj: "adhd_adult",
    state: { sleep: 7, tot: 45, stress: 4, caffeine: 0, timeOfDay: 11 },
    task: "reading_span",
    desc: "Adult with ADHD 45 min into reading-span task with ambient distraction.",
  },
];

export function getScenario(id: string): ScenarioDef | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

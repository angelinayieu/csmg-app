// ── Subject archetypes ────────────────────────────────────────────
//
// Verbatim port of the 8 archetypes from the reference HTML. Each
// distribution is calibrated to a published meta-analysis or
// landmark study; citations stay attached so the Evidence Basis
// card can cite them honestly.

import type { Archetype } from "./types";

export const ARCHETYPES: Archetype[] = [
  {
    id: "typical_adult",
    icon: "👤",
    name: "Healthy Young Adult",
    age: "20–35",
    flags: [],
    K: { mean: 4.0, sd: 0.8 },
    attn: { mean: 3.0, sd: 0.7 },
    decay: { mean: 18, sd: 4 },
    refresh: { mean: 1.5, sd: 0.3 },
    expertise: null,
    expertiseLevel: 0,
    desc: "Baseline cognitive profile. Around 50th percentile on K.",
    source:
      "Cowan 2001 (K=4±1); Unsworth 2014 (n>4,000 latent-variable analysis)",
  },
  {
    id: "older_adult",
    icon: "👴",
    name: "Healthy Older Adult",
    age: "65+",
    flags: ["age_decline"],
    K: { mean: 3.2, sd: 0.9 },
    attn: { mean: 2.4, sd: 0.8 },
    decay: { mean: 15, sd: 5 },
    refresh: { mean: 1.2, sd: 0.3 },
    expertise: null,
    expertiseLevel: 0,
    desc: "Crystallized knowledge preserved; executive control declines typically.",
    source:
      "Park & Reuter-Lorenz 2009; Salthouse 2010 (age-related cognitive decline)",
  },
  {
    id: "child",
    icon: "🧒",
    name: "Child",
    age: "7–10",
    flags: ["developing"],
    K: { mean: 2.8, sd: 0.6 },
    attn: { mean: 2.0, sd: 0.6 },
    decay: { mean: 12, sd: 4 },
    refresh: { mean: 1.0, sd: 0.3 },
    expertise: null,
    expertiseLevel: 0,
    desc: "Developing executive function; lower K, still maturing.",
    source:
      "Gathercole et al. 2004 (WM span development across ages 4-15)",
  },
  {
    id: "adhd_adult",
    icon: "⚡",
    name: "Adult with ADHD",
    age: "20–40",
    flags: ["adhd"],
    K: { mean: 3.8, sd: 0.9 },
    attn: { mean: 2.1, sd: 0.9 },
    decay: { mean: 16, sd: 5 },
    refresh: { mean: 1.3, sd: 0.4 },
    expertise: null,
    expertiseLevel: 0,
    desc: "Near-typical baseline K; attentional control and filtering reduced.",
    source: "Alderson et al. 2013 meta-analysis: WM d≈0.42, attention d≈0.55",
  },
  {
    id: "expert_chess",
    icon: "♟",
    name: "Chess Master",
    age: "25–45",
    flags: ["expert"],
    K: { mean: 4.1, sd: 0.8 },
    attn: { mean: 3.3, sd: 0.6 },
    decay: { mean: 20, sd: 5 },
    refresh: { mean: 1.7, sd: 0.3 },
    expertise: "chess",
    expertiseLevel: 1.0,
    desc: "Typical generic K; massive in-domain chunking (~50k chunks).",
    source:
      "Chase & Simon 1973; Gobet 1996 (template theory of chess expertise)",
  },
  {
    id: "medic_resident",
    icon: "🩺",
    name: "Surgical Resident",
    age: "28–34",
    flags: ["expert"],
    K: { mean: 4.1, sd: 0.7 },
    attn: { mean: 3.1, sd: 0.6 },
    decay: { mean: 18, sd: 4 },
    refresh: { mean: 1.6, sd: 0.3 },
    expertise: "medical",
    expertiseLevel: 0.8,
    desc: "Medical expertise; often operates under chronic sleep debt.",
    source:
      "Typical adult baseline with medical domain expertise (Ericsson 2018)",
  },
  {
    id: "anxiety",
    icon: "😰",
    name: "Adult with Anxiety",
    age: "20–45",
    flags: ["anxiety"],
    K: { mean: 3.6, sd: 0.8 },
    attn: { mean: 2.7, sd: 0.8 },
    decay: { mean: 16, sd: 4 },
    refresh: { mean: 1.3, sd: 0.4 },
    expertise: null,
    expertiseLevel: 0,
    desc: "K slightly reduced; rumination consumes slots, especially under stress.",
    source:
      "Moran 2016 meta-analysis: WM d≈0.35–0.45 across anxiety disorders",
  },
  {
    id: "depression",
    icon: "💭",
    name: "Adult with Depression",
    age: "20–50",
    flags: ["depression"],
    K: { mean: 3.7, sd: 0.9 },
    attn: { mean: 2.5, sd: 0.9 },
    decay: { mean: 17, sd: 5 },
    refresh: { mean: 1.2, sd: 0.4 },
    expertise: null,
    expertiseLevel: 0,
    desc: "Updating and manipulation hit harder than simple maintenance.",
    source: "Rock et al. 2014 meta-analysis (MDD cognitive deficits)",
  },
];

export function getArchetype(id: string): Archetype | null {
  return ARCHETYPES.find((a) => a.id === id) ?? null;
}

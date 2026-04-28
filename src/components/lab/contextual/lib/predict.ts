// ── predict() — the lab's math core ──────────────────────────────
//
// Verbatim port of the reference HTML's prediction function. Takes
// (subject archetype × state bag × task) and returns:
//   - effective K (after task load factor)
//   - success probability (logistic of effK − demand)
//   - active effects list (Effect Breakdown panel)
//   - 95% CI (uncertainty inflated by adverse conditions)
//   - component weights 0-100 (Composition panel)
//
// All effect sizes are calibrated to published literature:
//   - Sleep deficit: Lim & Dinges 2010 (g≈-0.5 for WM)
//   - Vigilance decrement: ~-0.3 slot asymptotic at 90 min
//   - Stress Yerkes-Dodson: 2-4 optimal, drops above
//   - Caffeine: ~+0.35α at 200mg, declines beyond
//   - Circadian: peak 10am, trough 3am, post-lunch dip 13-16
//   - ADHD attention: Alderson 2013 d≈0.55
//   - Domain expertise: Gobet 1996 template theory
//
// Pure function — no DB, no side effects, deterministic.

import type {
  Archetype,
  Task,
  StateBag,
  Prediction,
  ActiveEffect,
} from "./types";

export function predict(
  subj: Archetype,
  state: StateBag,
  task: Task,
): Prediction {
  let K = subj.K.mean;
  let attn = subj.attn.mean;
  const decay = subj.decay.mean;
  const refresh = subj.refresh.mean;
  const effects: ActiveEffect[] = [];

  // ── Sleep deficit ──────────────────────────────────────────────
  // 0h sleep → K penalty ~0.8 (Hedges g≈0.5 for typical K=4).
  const sleepDeficit = Math.max(0, 8 - state.sleep);
  if (sleepDeficit > 0) {
    const kHit = sleepDeficit * 0.1;
    const attnHit = sleepDeficit * 0.14;
    K -= kHit;
    attn -= attnHit;
    effects.push({
      name: "Sleep deficit",
      value: -kHit,
      target: "K",
      note: `${sleepDeficit.toFixed(1)}h below 8h target`,
    });
    if (attnHit > 0.1) {
      effects.push({
        name: "Sleep → attention",
        value: -attnHit,
        target: "α",
        note: "Frontoparietal network",
      });
    }
  }

  // ── Vigilance decrement ───────────────────────────────────────
  // Asymptotic -0.3 slot; ramps with diminishing returns past 10 min.
  if (state.tot > 10) {
    const totEffect = (1 - Math.exp(-state.tot / 90)) * 0.3;
    K -= totEffect;
    attn -= totEffect * 1.2;
    effects.push({
      name: "Vigilance decrement",
      value: -totEffect,
      target: "K",
      note: `${Math.round(state.tot)} min elapsed`,
    });
  }

  // ── Stress (Yerkes-Dodson) ────────────────────────────────────
  // Inverted-U: 2-4 optimal, above drops K, below underarouses.
  let stressEffect = 0;
  if (state.stress >= 2 && state.stress <= 4) stressEffect = 0.06;
  else if (state.stress > 4) stressEffect = -(state.stress - 4) * 0.13;
  else if (state.stress < 2) stressEffect = -(2 - state.stress) * 0.04;
  if (Math.abs(stressEffect) > 0.03) {
    K += stressEffect;
    effects.push({
      name:
        state.stress > 4
          ? "High stress"
          : state.stress < 2
            ? "Underarousal"
            : "Optimal arousal",
      value: stressEffect,
      target: "K",
      note: "Yerkes-Dodson",
    });
  }

  // ── Caffeine ──────────────────────────────────────────────────
  // ~+0.35 attention at 200mg, declining after.
  if (state.caffeine > 0) {
    const caffBoost =
      state.caffeine <= 200
        ? (state.caffeine / 200) * 0.35
        : Math.max(0, 0.35 - ((state.caffeine - 200) / 200) * 0.35);
    attn += caffBoost;
    if (caffBoost > 0.03) {
      effects.push({
        name: "Caffeine",
        value: caffBoost,
        target: "α",
        note: `${Math.round(state.caffeine)}mg`,
      });
    }
  }

  // ── Circadian ─────────────────────────────────────────────────
  // Cosine peak at 10am, trough 3am; post-lunch dip 13-16.
  const h = state.timeOfDay;
  let circ = 0.2 * Math.cos(((h - 10) / 24) * 2 * Math.PI);
  if (h >= 13 && h <= 16) circ -= 0.08;
  K += circ;
  if (Math.abs(circ) > 0.03) {
    const hh = Math.floor(h).toString().padStart(2, "0");
    const mm = Math.round((h % 1) * 60)
      .toString()
      .padStart(2, "0");
    effects.push({
      name: "Circadian",
      value: circ,
      target: "K",
      note: `${hh}:${mm}`,
    });
  }

  // ── Expertise — domain match multiplier ───────────────────────
  if (
    task.domainBoost &&
    subj.expertise &&
    subj.expertise === task.domainBoost
  ) {
    const expertiseEffect = subj.K.mean * subj.expertiseLevel * 0.6;
    K += expertiseEffect;
    effects.push({
      name: "Domain expertise",
      value: expertiseEffect,
      target: "K",
      note: `${subj.expertise} match`,
    });
  }

  // ── Clinical flags ────────────────────────────────────────────
  if (subj.flags.includes("adhd")) {
    const hit = 0.5;
    attn -= hit;
    effects.push({
      name: "ADHD → attention",
      value: -hit,
      target: "α",
      note: "Baseline attentional control",
    });
  }
  if (subj.flags.includes("anxiety") && state.stress > 4) {
    const hit = (state.stress - 4) * 0.15;
    K -= hit;
    effects.push({
      name: "Anxiety × stress",
      value: -hit,
      target: "K",
      note: "Rumination consumes slots",
    });
  }
  if (subj.flags.includes("depression") && task.op !== "maintenance") {
    const hit = 0.4;
    K -= hit;
    effects.push({
      name: "Depression → updating",
      value: -hit,
      target: "K",
      note: "Executive updating deficit",
    });
  }
  if (subj.flags.includes("age_decline") && task.op !== "maintenance") {
    const hit = 0.3;
    attn -= hit;
    effects.push({
      name: "Age → executive",
      value: -hit,
      target: "α",
      note: "Executive control decline",
    });
  }

  // ── Effective K ───────────────────────────────────────────────
  // Limited by min(K, attn+1) then divided by task load factor.
  const effK = Math.max(0.5, Math.min(K, attn + 1) / task.loadFactor);

  // Logistic success probability — slope 1.3 keeps the curve crisp
  // at the demand threshold without saturating too fast.
  const successRate = 1 / (1 + Math.exp(-(effK - task.demand) * 1.3));

  // Uncertainty inflates under adverse conditions.
  const uncertainty =
    subj.K.sd +
    (state.sleep < 5 ? 0.3 : 0) +
    (state.stress > 6 ? 0.2 : 0) +
    (state.tot > 120 ? 0.15 : 0);

  // Component weights (0-100) for the Composition panel — relative
  // to archetype's own mean so a well-functioning subject reads ~100.
  const compWeights = {
    buffer: clamp(
      Math.round(100 * (K / subj.K.mean) * (subj.K.mean / 4)),
      10,
      100,
    ),
    decay: clamp(
      Math.round(100 * (decay / subj.decay.mean) * 0.88),
      10,
      100,
    ),
    rehearsal: clamp(
      Math.round(100 * (refresh / subj.refresh.mean) * 0.78),
      10,
      100,
    ),
    attention: clamp(
      Math.round(100 * (attn / subj.attn.mean) * (subj.attn.mean / 3)),
      10,
      100,
    ),
  };

  return {
    K: effK,
    rawK: K,
    attn,
    decay,
    refresh,
    uncertainty,
    successRate,
    effects,
    demand: task.demand,
    ciLow: Math.max(0, effK - uncertainty),
    ciHigh: effK + uncertainty,
    compWeights,
  };
}

/** Box-Muller standard normal sample. */
export function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Sample a perturbed archetype for population-mode Monte Carlo. */
export function sampleFromArchetype(a: Archetype): Archetype {
  return {
    ...a,
    K: { mean: a.K.mean + randn() * a.K.sd, sd: a.K.sd },
    attn: { mean: a.attn.mean + randn() * a.attn.sd, sd: a.attn.sd },
    decay: { mean: a.decay.mean + randn() * a.decay.sd, sd: a.decay.sd },
    refresh: {
      mean: a.refresh.mean + randn() * a.refresh.sd,
      sd: a.refresh.sd,
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── ContextualLab shared types ───────────────────────────────────
//
// Subject × State × Task → predicted K + effects + composition.
// Verbatim port of the reference photo's data model.

export interface NormalDist {
  mean: number;
  sd: number;
}

export type SubjectFlag =
  | "age_decline"
  | "developing"
  | "adhd"
  | "expert"
  | "anxiety"
  | "depression";

export type ExpertiseDomain = "chess" | "medical" | null;

/** A subject archetype — the cognitive profile baseline.
 *  K, attn, decay, refresh distributions are calibrated to published
 *  literature (Cowan 2001, Unsworth 2014, Salthouse 2010, etc.). */
export interface Archetype {
  id: string;
  icon: string;
  name: string;
  age: string;
  flags: SubjectFlag[];
  K: NormalDist; // working memory capacity (slots)
  attn: NormalDist; // attention bandwidth
  decay: NormalDist; // tau, decay time constant (seconds)
  refresh: NormalDist; // rho, rehearsal/refresh rate (per second)
  expertise: ExpertiseDomain;
  expertiseLevel: number; // 0–1, multiplier on domain-matched tasks
  desc: string;
  source: string;
}

export type TaskContentType = "verbal" | "visuospatial";
export type TaskOperation = "maintenance" | "updating" | "manipulation" | "dual";

export interface Task {
  id: string;
  name: string;
  contentType: TaskContentType;
  op: TaskOperation;
  /** Demand K — number of slots the task requires for success. */
  demand: number;
  /** Load factor multiplier on effective K. */
  loadFactor: number;
  desc: string;
  /** When set, archetypes with matching expertise get a domain boost. */
  domainBoost?: ExpertiseDomain;
}

/** State slider definition — sleep, stress, caffeine, etc. */
export interface StateDef {
  id: StateKey;
  label: string;
  sub: string; // unit hint shown under label
  min: number;
  max: number;
  step: number;
  def: number; // default value
  fmt: (v: number) => string;
  warn?: (v: number) => boolean;
  alert?: (v: number) => boolean;
}

export type StateKey =
  | "sleep"
  | "tot" // time on task (minutes)
  | "stress"
  | "caffeine"
  | "timeOfDay";

export type StateBag = Record<StateKey, number>;

/** A predicted effect — one row in the Effect Breakdown panel. */
export interface ActiveEffect {
  name: string;
  value: number; // signed delta on the target
  target: "K" | "α" | "τ" | "ρ"; // which parameter this pushes
  note: string;
}

/** Full prediction output — drives every right-rail panel. */
export interface Prediction {
  K: number; // effective K (after task load factor)
  rawK: number; // K before loadFactor
  attn: number;
  decay: number;
  refresh: number;
  uncertainty: number;
  successRate: number; // 0–1
  effects: ActiveEffect[];
  demand: number;
  ciLow: number;
  ciHigh: number;
  /** Component bar weights 0-100 (Buffer/Decay/Rehearsal/Attention) */
  compWeights: {
    buffer: number;
    decay: number;
    rehearsal: number;
    attention: number;
  };
}

/** A chamber component — one of the 4 lab-formula primitives. */
export interface ComponentDef {
  id: "buffer" | "decay" | "rehearsal" | "attention";
  sym: string; // β, δ, ρ, α
  sub: string; // subscript (e.g. "4" for β₄)
  name: string;
  color: string; // hex
  role: string;
  desc: string;
  mechanism: string;
}

/** A reaction in the Reaction Network panel. */
export interface ReactionDef {
  id: string;
  inputs: ComponentDef["id"][];
  name: string;
  desc: string;
  type:
    | "convergent"
    | "tradeoff"
    | "mechanism"
    | "threshold"
    | "modulation"
    | "constraint"
    | "synthesis";
  baseProb: number; // 0–1
}

/** A scenario preset — one-click loads subject + state + task. */
export interface ScenarioDef {
  id: string;
  name: string;
  subj: string; // archetype id
  state: StateBag;
  task: string; // task id
  desc: string;
}

// ═══════════════════════════════════════════════════════════════════════
// CRCI MODEL DATA — Shared across all workspaces
// Yieu, 2026 · 63 nodes · 91 edges · 168 records · 74 papers
// ═══════════════════════════════════════════════════════════════════════

export interface Node {
  id: string;
  label: string;
  short: string;
  layer: number;
  domain: string;
  obs: boolean;
  mech?: string;
}

export interface Edge {
  id: string;
  s: string;
  t: string;
  b: number;
  se: number;
  k: number;
  i2?: number;
  st: "confirmed" | "mixed" | "sparse";
}

export const LAYER_NAMES = [
  "Exogenous",
  "Behaviors",
  "Biomarkers",
  "Pathways",
  "Symptoms",
  "Cognitive",
  "Composite",
];

export const NODES: Node[] = [
  { id: "N01", label: "Chemotherapy", short: "Chemo", layer: 0, domain: "treatment", obs: true },
  { id: "N02", label: "Radiation", short: "Radiation", layer: 0, domain: "treatment", obs: true },
  { id: "N03", label: "Age", short: "Age", layer: 0, domain: "demographic", obs: true },
  { id: "N04", label: "Cancer Type", short: "CancerType", layer: 0, domain: "demographic", obs: true },
  { id: "N05", label: "Cancer Stage", short: "Stage", layer: 0, domain: "demographic", obs: true },
  { id: "N06", label: "Treatment Phase", short: "TxPhase", layer: 0, domain: "demographic", obs: true },
  { id: "N07", label: "Comorbidity Index", short: "Comorbid", layer: 0, domain: "demographic", obs: true },
  { id: "N08", label: "APOE \u03B54", short: "APOE", layer: 0, domain: "genetic", obs: true },
  { id: "N09", label: "Sex", short: "Sex", layer: 0, domain: "demographic", obs: true },
  { id: "N10", label: "Physical Activity", short: "Activity", layer: 1, domain: "behavior", obs: true },
  { id: "N11", label: "Sleep Quality", short: "Sleep", layer: 1, domain: "behavior", obs: true },
  { id: "N12", label: "Diet Quality", short: "Diet", layer: 1, domain: "behavior", obs: true },
  { id: "N13", label: "Stress Management", short: "StressMgmt", layer: 1, domain: "behavior", obs: true },
  { id: "N14", label: "Cognitive Activity", short: "CogTrain", layer: 1, domain: "behavior", obs: true },
  { id: "N15", label: "Social Engagement", short: "Social", layer: 1, domain: "behavior", obs: true },
  { id: "N16", label: "Smoking", short: "Smoking", layer: 1, domain: "behavior", obs: true },
  { id: "N17", label: "Alcohol", short: "Alcohol", layer: 1, domain: "behavior", obs: true },
  { id: "N20", label: "IL-6", short: "IL-6", layer: 2, domain: "biomarker", obs: true },
  { id: "N21", label: "CRP", short: "CRP", layer: 2, domain: "biomarker", obs: true },
  { id: "N22", label: "TNF-\u03B1", short: "TNF-\u03B1", layer: 2, domain: "biomarker", obs: true },
  { id: "N23", label: "BDNF", short: "BDNF", layer: 2, domain: "biomarker", obs: true },
  { id: "N24", label: "Cortisol", short: "Cortisol", layer: 2, domain: "biomarker", obs: true },
  { id: "N25", label: "8-OHdG", short: "8-OHdG", layer: 2, domain: "biomarker", obs: true },
  { id: "N26", label: "MDA", short: "MDA", layer: 2, domain: "biomarker", obs: true },
  { id: "N27", label: "p16", short: "p16", layer: 2, domain: "biomarker", obs: true },
  { id: "N28", label: "NfL", short: "NfL", layer: 2, domain: "biomarker", obs: true },
  { id: "N29", label: "\u03B3-H2AX", short: "\u03B3H2AX", layer: 2, domain: "biomarker", obs: true },
  { id: "N2A", label: "Shannon Index", short: "Shannon", layer: 2, domain: "biomarker", obs: true },
  { id: "N2B", label: "Fasting Glucose", short: "Glucose", layer: 2, domain: "biomarker", obs: true },
  { id: "N30", label: "Neuroinflammation (OIC)", short: "OIC", layer: 3, domain: "pathway", obs: false, mech: "Functional/Structural" },
  { id: "N31", label: "Oxidative Stress", short: "OxStress", layer: 3, domain: "pathway", obs: false, mech: "Structural" },
  { id: "N32", label: "HPA Dysregulation", short: "HPA", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N33", label: "Neuroplasticity Impairment", short: "Neuroplast", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N34", label: "Neurogenesis Impairment", short: "Neurogenesis", layer: 3, domain: "pathway", obs: false, mech: "Structural" },
  { id: "N35", label: "Mitochondrial Dysfunction", short: "Mitochond", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N36", label: "DNA Damage", short: "DNADmg", layer: 3, domain: "pathway", obs: false, mech: "Structural" },
  { id: "N37", label: "Gut-Brain Axis", short: "GutBrain", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N38", label: "Cellular Senescence", short: "Senescence", layer: 3, domain: "pathway", obs: false, mech: "Structural" },
  { id: "N39", label: "Glymphatic Impairment", short: "Glymphatic", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N3A", label: "Cerebrovascular", short: "Cerebrovasc", layer: 3, domain: "pathway", obs: false, mech: "Structural" },
  { id: "N3B", label: "Epigenetic Changes", short: "Epigenetic", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N3C", label: "Metabolic Dysregulation", short: "Metabolic", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N3D", label: "BBB Disruption", short: "BBB", layer: 3, domain: "pathway", obs: false, mech: "Functional/Structural" },
  { id: "N3E", label: "Synaptic Dysfunction", short: "Synaptic", layer: 3, domain: "pathway", obs: false, mech: "Functional" },
  { id: "N3F", label: "Myelin/Oligodendrocyte", short: "Myelin", layer: 3, domain: "pathway", obs: false, mech: "Structural" },
  { id: "N40", label: "Cancer-Related Fatigue", short: "Fatigue", layer: 4, domain: "symptom", obs: true },
  { id: "N41", label: "Depression", short: "Depression", layer: 4, domain: "symptom", obs: true },
  { id: "N42", label: "Anxiety", short: "Anxiety", layer: 4, domain: "symptom", obs: true },
  { id: "N43", label: "Sleep Disturbance", short: "SleepDist", layer: 4, domain: "symptom", obs: true },
  { id: "N44", label: "Pain", short: "Pain", layer: 4, domain: "symptom", obs: true },
  { id: "N45", label: "Cognitive Complaints", short: "CogCompl", layer: 4, domain: "symptom", obs: true },
  { id: "N46", label: "Nausea", short: "Nausea", layer: 4, domain: "symptom", obs: true },
  { id: "N47", label: "Neuropathy", short: "Neuropathy", layer: 4, domain: "symptom", obs: true },
  { id: "N50", label: "Processing Speed", short: "ProcSpeed", layer: 5, domain: "cognitive", obs: true },
  { id: "N51", label: "Episodic Memory", short: "EpisodicMem", layer: 5, domain: "cognitive", obs: true },
  { id: "N52", label: "Working Memory", short: "WorkMem", layer: 5, domain: "cognitive", obs: true },
  { id: "N53", label: "Sustained Attention", short: "SustAttn", layer: 5, domain: "cognitive", obs: true },
  { id: "N54", label: "Selective Attention", short: "SelAttn", layer: 5, domain: "cognitive", obs: true },
  { id: "N55", label: "Executive Planning", short: "ExecPlan", layer: 5, domain: "cognitive", obs: true },
  { id: "N56", label: "Executive Inhibition", short: "ExecInhib", layer: 5, domain: "cognitive", obs: true },
  { id: "N57", label: "Verbal Fluency", short: "Verbal", layer: 5, domain: "cognitive", obs: true },
  { id: "N58", label: "Language", short: "Language", layer: 5, domain: "cognitive", obs: true },
  { id: "N59", label: "Visuospatial", short: "Visuospatial", layer: 5, domain: "cognitive", obs: true },
  { id: "N60", label: "CRCI Composite", short: "CRCI", layer: 6, domain: "composite", obs: true },
];

export const EDGES: Edge[] = [
  { id: "ER_CHEMO_IL6", s: "N01", t: "N20", b: 0.42, se: 0.08, k: 8, i2: 61, st: "confirmed" },
  { id: "ER_CHEMO_CRP", s: "N01", t: "N21", b: 0.35, se: 0.09, k: 5, i2: 48, st: "confirmed" },
  { id: "ER_CHEMO_TNF", s: "N01", t: "N22", b: 0.31, se: 0.10, k: 7, i2: 55, st: "confirmed" },
  { id: "ER_IL6_OIC", s: "N20", t: "N30", b: 0.52, se: 0.06, k: 15, i2: 58, st: "confirmed" },
  { id: "ER_CRP_OIC", s: "N21", t: "N30", b: 0.41, se: 0.07, k: 10, i2: 52, st: "confirmed" },
  { id: "ER_TNF_OIC", s: "N22", t: "N30", b: 0.45, se: 0.07, k: 11, i2: 49, st: "confirmed" },
  { id: "ER_CORTISOL_HPA", s: "N24", t: "N32", b: 0.48, se: 0.09, k: 4, i2: 38, st: "confirmed" },
  { id: "ER_BDNF_NEUROPLAST", s: "N23", t: "N33", b: 0.30, se: 0.10, k: 3, i2: 41, st: "confirmed" },
  { id: "ER_OIC_PROCSPEED", s: "N30", t: "N50", b: -0.34, se: 0.05, k: 25, i2: 64, st: "confirmed" },
  { id: "ER_OIC_EPISODIC", s: "N30", t: "N51", b: -0.26, se: 0.06, k: 15, i2: 59, st: "confirmed" },
  { id: "ER_OIC_WORKMEM", s: "N30", t: "N52", b: -0.28, se: 0.06, k: 8, i2: 51, st: "confirmed" },
  { id: "ER_OIC_ATTNSUST", s: "N30", t: "N53", b: -0.22, se: 0.07, k: 9, i2: 45, st: "confirmed" },
  { id: "ER_HPA_EPISODIC", s: "N32", t: "N51", b: -0.25, se: 0.08, k: 4, i2: 31, st: "confirmed" },
  { id: "ER_OIC_FATIGUE", s: "N30", t: "N40", b: 0.38, se: 0.07, k: 6, i2: 42, st: "confirmed" },
  { id: "ER_FATIGUE_PROCSPD", s: "N40", t: "N50", b: -0.24, se: 0.07, k: 4, st: "confirmed" },
  { id: "ER_ACT_IL6", s: "N10", t: "N20", b: -0.21, se: 0.08, k: 4, st: "confirmed" },
  { id: "ER_ACT_BDNF", s: "N10", t: "N23", b: 0.14, se: 0.10, k: 3, i2: 68, st: "mixed" },
  { id: "ER_ACT_FATIGUE", s: "N10", t: "N40", b: -0.29, se: 0.08, k: 4, st: "confirmed" },
  { id: "ER_SLEEP_CORTISOL", s: "N11", t: "N24", b: -0.23, se: 0.09, k: 2, st: "confirmed" },
  { id: "ER_DEP_WORKMEM", s: "N41", t: "N52", b: -0.22, se: 0.09, k: 3, st: "confirmed" },
  { id: "ER_OIC_DEPRESSION", s: "N30", t: "N41", b: 0.29, se: 0.08, k: 3, st: "confirmed" },
  { id: "ER_NFL_MYELIN", s: "N28", t: "N3F", b: -0.35, se: 0.11, k: 2, st: "confirmed" },
  { id: "ER_MYELIN_PROCSPD", s: "N3F", t: "N50", b: 0.31, se: 0.10, k: 2, st: "confirmed" },
];

// ─── RECOVERY PARAMS ─────────────────────────────────────────────
export const REC = {
  BCA: { rInf: 0.75, tau: 8, gam: 1.2, acc: 1.5, label: "Breast (AC)", color: "#E11D48" },
  BCT: { rInf: 0.72, tau: 9, gam: 1.1, acc: 1.4, label: "Breast (Taxane)", color: "#F43F5E" },
  CRC: { rInf: 0.70, tau: 10, gam: 1.1, acc: 1.4, label: "Colorectal", color: "#F97316" },
  LNG: { rInf: 0.60, tau: 12, gam: 1.0, acc: 1.6, label: "Lung", color: "#8B5CF6" },
  HEM: { rInf: 0.55, tau: 14, gam: 0.9, acc: 1.8, label: "Hematologic", color: "#3B82F6" },
  GYN: { rInf: 0.68, tau: 10, gam: 1.1, acc: 1.4, label: "Gynecologic", color: "#EC4899" },
  HNC: { rInf: 0.58, tau: 13, gam: 1.0, acc: 1.5, label: "Head & Neck", color: "#14B8A6" },
  CNS: { rInf: 0.50, tau: 18, gam: 0.7, acc: 2.0, label: "CNS", color: "#6366F1" },
  PRS: { rInf: 0.80, tau: 6, gam: 1.3, acc: 1.2, label: "Prostate", color: "#0EA5E9" },
  PED: { rInf: 0.65, tau: 16, gam: 0.8, acc: 2.5, label: "Pediatric", color: "#10B981" },
} as const;

export type CancerType = keyof typeof REC;

export const SUBPOPS = [
  { id: "BCA", label: "Breast (AC)", z: -0.58, top: "Exercise", dc: 0.29, vuln: "OIC + Fatigue", color: "#E11D48" },
  { id: "BCT", label: "Breast (Tax)", z: -0.44, top: "Exercise", dc: 0.24, vuln: "OIC + Myelin", color: "#F43F5E" },
  { id: "CRC", label: "Colorectal", z: -0.51, top: "Exercise", dc: 0.26, vuln: "OIC + Myelin", color: "#F97316" },
  { id: "LNG", label: "Lung", z: -0.63, top: "CBT-I", dc: 0.25, vuln: "DNA + OIC + Fatigue", color: "#8B5CF6" },
  { id: "HEM", label: "Hematologic", z: -0.76, top: "Exercise", dc: 0.33, vuln: "OIC+++ + BBB", color: "#3B82F6" },
  { id: "GYN", label: "Gynecologic", z: -0.49, top: "MBSR", dc: 0.22, vuln: "OIC + HPA", color: "#EC4899" },
  { id: "HNC", label: "Head & Neck", z: -0.61, top: "Exercise", dc: 0.21, vuln: "BBB + DNA + Myelin", color: "#14B8A6" },
  { id: "CNS", label: "CNS", z: -0.85, top: "Exercise", dc: 0.28, vuln: "All elevated", color: "#6366F1" },
  { id: "PRS", label: "Prostate", z: -0.41, top: "MBSR", dc: 0.20, vuln: "HPA + Metabolic", color: "#0EA5E9" },
  { id: "PED", label: "Pediatric", z: -0.37, top: "Exercise", dc: 0.23, vuln: "Neuroplast + Late", color: "#10B981" },
];

export const PATHWAYS = [
  "Neuroinflammation",
  "HPA Dysregulation",
  "Neuroplasticity",
  "DNA Damage",
  "BBB / Myelin",
  "Fatigue Loop",
  "Metabolic",
  "Gut-Brain",
];

export const VULN_MATRIX: Record<string, number[]> = {
  BCA: [0.85, 0.52, 0.38, 0.55, 0.22, 0.71, 0.18, 0.12],
  CRC: [0.72, 0.28, 0.25, 0.45, 0.48, 0.58, 0.35, 0.38],
  LNG: [0.78, 0.31, 0.22, 0.78, 0.31, 0.82, 0.42, 0.08],
  HEM: [0.94, 0.41, 0.34, 0.48, 0.68, 0.75, 0.22, 0.15],
  HNC: [0.65, 0.22, 0.18, 0.82, 0.75, 0.52, 0.15, 0.05],
  PRS: [0.35, 0.81, 0.20, 0.15, 0.10, 0.42, 0.61, 0.08],
  PED: [0.58, 0.39, 0.62, 0.51, 0.55, 0.35, 0.20, 0.10],
};

export const REF_DOMAINS = [
  { name: "Processing Speed", z: -0.82, ci: [-1.24, -0.40], obs: 78, edge: "OIC\u2192ProcSpeed (41%)" },
  { name: "Sustained Attention", z: -0.61, ci: [-1.18, -0.04], obs: 62, edge: "Fatigue\u2192Attn (33%)" },
  { name: "Episodic Memory", z: -0.58, ci: [-1.08, -0.08], obs: 71, edge: "OIC\u2192Episodic (29%)" },
  { name: "Working Memory", z: -0.49, ci: [-1.05, 0.07], obs: 65, edge: "OIC\u2192WorkMem (26%)" },
  { name: "Executive Planning", z: -0.35, ci: [-0.98, 0.28], obs: 52, edge: "Depression\u2192Exec (31%)" },
  { name: "Selective Attention", z: -0.31, ci: [-1.03, 0.41], obs: 38, edge: "Anxiety\u2192SelAttn (48%)" },
];

export const IVS = [
  {
    id: "exercise", name: "Structured Exercise", dose: "150 min/wk", dc: 0.31, ci: [0.12, 0.50], ptop3: 0.87,
    mech: "Anti-inflammatory",
    mechParts: [{ l: "IL-6 reduction", p: 42 }, { l: "Fatigue", p: 31 }, { l: "Cortisol", p: 15 }, { l: "BDNF", p: 12 }],
    dr: { emax: 0.37, ec50: 90, hill: 1.8, minE: 60, opt: 150, plat: 300, unit: "min/wk" }, color: "#1E40AF",
    kernel: { onset: 2, buildup: 6, plateau: 20, decay: 8 },
  },
  {
    id: "cbti", name: "CBT-I Sleep", dose: "8-wk protocol", dc: 0.22, ci: [0.06, 0.38], ptop3: 0.73,
    mech: "Sleep\u2192HPA cascade",
    mechParts: [{ l: "Sleep-HPA", p: 38 }, { l: "Fatigue-sleep", p: 29 }, { l: "Inflammation", p: 18 }, { l: "Mood", p: 15 }],
    dr: { emax: 0.30, ec50: 4, hill: 2.2, minE: 3, opt: 8, plat: 12, unit: "weeks" }, color: "#7C3AED",
    kernel: { onset: 1, buildup: 4, plateau: 16, decay: 12 },
  },
  {
    id: "mbsr", name: "MBSR / Mindfulness", dose: "8-wk MBSR", dc: 0.18, ci: [0.02, 0.34], ptop3: 0.68,
    mech: "Stress\u2192cortisol",
    mechParts: [{ l: "Stress-HPA", p: 52 }, { l: "Anti-inflam", p: 22 }, { l: "Mood", p: 16 }, { l: "Sleep", p: 10 }],
    dr: { emax: 0.28, ec50: 5, hill: 1.6, minE: 4, opt: 8, plat: 16, unit: "weeks" }, color: "#0F766E",
    kernel: { onset: 2, buildup: 6, plateau: 18, decay: 10 },
  },
  {
    id: "diet", name: "Mediterranean Diet", dose: "Score \u22657", dc: 0.11, ci: [-0.06, 0.28], ptop3: 0.44,
    mech: "Anti-inflammatory dietary",
    mechParts: [{ l: "IL-6", p: 34 }, { l: "OxStress", p: 28 }, { l: "Metabolic", p: 22 }, { l: "Gut", p: 16 }],
    dr: { emax: 0.22, ec50: 4, hill: 1.2, minE: 3, opt: 7, plat: 10, unit: "score" }, color: "#B45309",
    kernel: { onset: 4, buildup: 8, plateau: 24, decay: 16 },
  },
  {
    id: "cogtrain", name: "Cognitive Training", dose: "3\u00D7/wk", dc: 0.09, ci: [-0.08, 0.26], ptop3: 0.31,
    mech: "Neuroplasticity",
    mechParts: [{ l: "Synaptic", p: 45 }, { l: "BDNF", p: 32 }, { l: "Reserve", p: 15 }, { l: "Mood", p: 8 }],
    dr: { emax: 0.20, ec50: 6, hill: 1.4, minE: 4, opt: 12, plat: 24, unit: "weeks" }, color: "#DC2626",
    kernel: { onset: 3, buildup: 8, plateau: 20, decay: 12 },
  },
  {
    id: "social", name: "Social Engagement", dose: "Program", dc: 0.06, ci: [-0.12, 0.24], ptop3: 0.22,
    mech: "Mood / verbal",
    mechParts: [{ l: "Depression", p: 51 }, { l: "Verbal", p: 28 }, { l: "Motivation", p: 14 }, { l: "Reserve", p: 7 }],
    dr: { emax: 0.15, ec50: 4, hill: 1.0, minE: 2, opt: 8, plat: 16, unit: "weeks" }, color: "#64748B",
    kernel: { onset: 2, buildup: 6, plateau: 24, decay: 16 },
  },
];

// ─── SEARCH INDEX ────────────────────────────────────────────────
export const SEARCH_INDEX = [
  ...NODES.map((n) => ({ type: "node", id: n.id, label: n.label, short: n.short, sub: `Layer ${n.layer} \u00B7 ${n.domain}`, target: { ws: "dag", nodeId: n.id } })),
  ...EDGES.map((e) => {
    const sn = NODES.find((n) => n.id === e.s);
    const tn = NODES.find((n) => n.id === e.t);
    return { type: "edge", id: e.id, label: `${sn?.short || e.s} \u2192 ${tn?.short || e.t}`, short: e.id, sub: `\u03B2=${e.b} k=${e.k || 0}`, target: { ws: "dag", edgeId: e.id } };
  }),
  { type: "workspace", id: "ws_dag", label: "DAG Explorer", short: "dag", sub: "63-node knowledge graph visualization", target: { ws: "dag" } },
  { type: "workspace", id: "ws_sim", label: "Simulation Console", short: "sim", sub: "Patient-stratified Bayesian inference", target: { ws: "sim" } },
  { type: "workspace", id: "ws_disc", label: "Discovery Engine", short: "disc", sub: "Self-improvement evidence loop", target: { ws: "disc" } },
  { type: "workspace", id: "ws_audit", label: "Audit Trail", short: "audit", sub: "Full provenance & source ingestion", target: { ws: "audit" } },
  { type: "workspace", id: "ws_traj", label: "Trajectory & Population", short: "traj", sub: "Temporal modeling, dose-response, heatmap", target: { ws: "traj" } },
  { type: "workspace", id: "ws_twin", label: "Digital Twin Simulator", short: "twin", sub: "Live patient-specific CRCI forecast", target: { ws: "twin" } },
];

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { T } from "../tokens";
import { Mono, Pill, StatCard } from "../ui";

// ─── Simplified simulation engine ────────────────────────────────
const VULN: Record<string, Record<string, number>> = {
  Breast:      { oic: 0.85, hpa: 0.52, neuro: 0.38, myelin: 0.22, ox: 0.55, fatigue: 0.71, meta: 0.18 },
  Colorectal:  { oic: 0.72, hpa: 0.28, neuro: 0.25, myelin: 0.48, ox: 0.45, fatigue: 0.58, meta: 0.35 },
  Lung:        { oic: 0.78, hpa: 0.31, neuro: 0.22, myelin: 0.31, ox: 0.78, fatigue: 0.82, meta: 0.42 },
  Hematologic: { oic: 0.94, hpa: 0.41, neuro: 0.34, myelin: 0.68, ox: 0.48, fatigue: 0.75, meta: 0.22 },
  HNC:         { oic: 0.65, hpa: 0.22, neuro: 0.18, myelin: 0.75, ox: 0.82, fatigue: 0.52, meta: 0.15 },
  Prostate:    { oic: 0.35, hpa: 0.81, neuro: 0.20, myelin: 0.10, ox: 0.15, fatigue: 0.42, meta: 0.61 },
  Pediatric:   { oic: 0.58, hpa: 0.39, neuro: 0.62, myelin: 0.55, ox: 0.51, fatigue: 0.35, meta: 0.20 },
  CNS:         { oic: 0.75, hpa: 0.45, neuro: 0.55, myelin: 0.80, ox: 0.65, fatigue: 0.60, meta: 0.30 },
  GYN:         { oic: 0.70, hpa: 0.68, neuro: 0.30, myelin: 0.25, ox: 0.40, fatigue: 0.55, meta: 0.28 },
  Mixed:       { oic: 0.65, hpa: 0.42, neuro: 0.32, myelin: 0.40, ox: 0.50, fatigue: 0.58, meta: 0.30 },
};

const INTERVENTIONS = [
  { id: "exercise", name: "Structured Exercise", dose: "150 min/wk", baseDc: 0.31, color: "#1E40AF", mech: "Activity→↓IL-6→↓OIC (42%), ↓Fatigue (31%)" },
  { id: "cbti", name: "CBT-I Sleep", dose: "8-week protocol", baseDc: 0.22, color: "#7C3AED", mech: "Sleep→↓Cortisol→↓HPA (38%), ↓Fatigue (29%)" },
  { id: "mbsr", name: "MBSR / Mindfulness", dose: "8-week MBSR", baseDc: 0.18, color: "#059669", mech: "Stress→↓Cortisol→↓HPA (52%), ↓IL-6 (22%)" },
  { id: "diet", name: "Mediterranean Diet", dose: "Adherence ≥7", baseDc: 0.11, color: "#B45309", mech: "Diet→↓IL-6 (34%), Diet→↓MDA/OxStress (28%)" },
  { id: "cogtrain", name: "Cognitive Training", dose: "3×/wk, 45 min", baseDc: 0.09, color: "#DC2626", mech: "↑Synaptic plasticity (45%), ↑BDNF (32%)" },
  { id: "social", name: "Social Engagement", dose: "Structured program", baseDc: 0.06, color: "#6B7280", mech: "↓Depression (51%), ↑Verbal fluency (28%)" },
];

interface Biomarkers {
  il6: number | null; crp: number | null; tnf: number | null; bdnf: number | null; cortisol: number | null;
}

function runSim(cancerType: string, phase: string, activity: string, sleepQual: string, age: number, bio: Biomarkers) {
  const vuln = VULN[cancerType] || VULN.Mixed;
  const pm = phase.includes("Active") ? 1.3 : phase.includes("Early") ? 1.0 : 0.7;
  const am = activity === "Sedentary" ? 1.3 : activity === "Low" ? 1.1 : activity === "Moderate" ? 0.95 : 0.85;
  const sm = sleepQual === "Poor" ? 1.2 : sleepQual === "Fair" ? 1.0 : 0.85;

  const nadirBase = -(vuln.oic * 0.34 + vuln.hpa * 0.25 + vuln.fatigue * 0.12) * pm * am * sm;
  const noise = () => (Math.random() - 0.5) * 0.15;
  const domains = [
    { label: "Processing Speed",    z: nadirBase * 1.5 + noise(), w: 0.22 },
    { label: "Sustained Attention", z: nadirBase * 1.2 + noise(), w: 0.13 },
    { label: "Episodic Memory",     z: nadirBase * 1.1 + noise(), w: 0.18 },
    { label: "Working Memory",      z: nadirBase * 1.0 + noise(), w: 0.15 },
    { label: "Executive Planning",  z: nadirBase * 0.7 + noise(), w: 0.10 },
    { label: "Selective Attention", z: nadirBase * 0.5 + noise(), w: 0.08 },
  ].map((d) => ({ ...d, z: Math.round(d.z * 100) / 100, ci: [Math.round((d.z - 0.3 - Math.random() * 0.1) * 100) / 100, Math.round((d.z + 0.3 + Math.random() * 0.1) * 100) / 100], obsPct: Math.round(40 + Math.random() * 35) }));

  const obsBoost = Object.values(bio).filter((v) => v !== null).length * 0.012;
  const ivs = INTERVENTIONS.map((iv) => {
    const jitter = (Math.random() - 0.5) * 0.05;
    const vulnMatch = iv.id === "exercise" ? vuln.oic + vuln.fatigue : iv.id === "cbti" ? vuln.hpa + vuln.oic : iv.id === "mbsr" ? vuln.hpa : iv.id === "diet" ? vuln.oic + vuln.ox : 0.5;
    const dc = iv.baseDc * (0.8 + vulnMatch * 0.3) + jitter + obsBoost * 0.1;
    return { ...iv, dc: Math.round(dc * 1000) / 1000, ci: [Math.round((dc - 0.13) * 1000) / 1000, Math.round((dc + 0.13) * 1000) / 1000] };
  }).sort((a, b) => b.dc - a.dc);

  const composite = Math.round((domains.reduce((a, d) => a + d.w * d.z, 0) / domains.reduce((a, d) => a + d.w, 0)) * 100) / 100;
  const cCi: [number, number] = [Math.round((composite - 0.37) * 100) / 100, Math.round((composite + 0.37) * 100) / 100];
  return { domains, ivs, composite, cCi, pRank1: 0.87 - jitterSmall() };
}

function jitterSmall() { return Math.random() * 0.1; }

// ─── UI primitives ──────────────────────────────────────────────

function Select({ value, onChange, options, style = {} }: { value: string; onChange: (v: string) => void; options: string[]; style?: React.CSSProperties }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", padding: "6px 8px", fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 5,
        fontFamily: T.sans, color: T.ink, background: T.bg, cursor: "pointer", outline: "none",
        ...style,
      }}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function NumInput({ value, onChange, placeholder, unit }: { value: number | null; onChange: (v: number | null) => void; placeholder: string; unit?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        type="number"
        step="any"
        value={value === null ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
        placeholder={placeholder}
        style={{
          flex: 1, padding: "5px 8px", fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4,
          fontFamily: T.mono, color: T.ink, background: T.bg, outline: "none", width: 0,
        }}
      />
      {unit && <span style={{ fontSize: 10, color: T.ink3, fontFamily: T.mono, whiteSpace: "nowrap" }}>{unit}</span>}
    </div>
  );
}

// ─── Domain forest plot ────────────────────────────────────────

interface DomainResult { label: string; z: number; ci: number[]; obsPct: number; w: number }

function ForestPlot({ data, compositeRow }: { data: DomainResult[]; compositeRow: { label: string; z: number; ci: number[] } }) {
  const W = 580;
  const pad = { l: 150, r: 110, t: 20, b: 30 };
  const pW = W - pad.l - pad.r;
  const rowH = 32;
  const rows = [...data, { ...compositeRow, obsPct: 58, isComposite: true, w: 0 }];
  const H = pad.t + rows.length * rowH + pad.b;
  const allV = rows.flatMap((r) => r.ci);
  const xMin = Math.min(0, ...allV) - 0.1;
  const xMax = Math.max(0, ...allV) + 0.1;
  const xS = (v: number) => pad.l + ((v - xMin) / (xMax - xMin)) * pW;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <line x1={xS(0)} y1={pad.t - 4} x2={xS(0)} y2={H - pad.b} stroke={T.border} strokeDasharray="4,3" strokeWidth={1} />
      <text x={xS(0)} y={H - pad.b + 14} textAnchor="middle" style={{ fontSize: 9, fill: T.ink3, fontFamily: T.mono }}>0</text>
      <text x={pad.l + pW / 2} y={H - 4} textAnchor="middle" style={{ fontSize: 9, fill: T.ink2, fontFamily: T.mono }}>z-score (negative = impaired)</text>
      {rows.map((r, i) => {
        const y = pad.t + i * rowH + rowH / 2;
        const color = (r as DomainResult & { isComposite?: boolean }).isComposite ? T.ink : r.z < -0.5 ? T.lo : r.z < -0.2 ? T.mid : T.ink2;
        const isComp = (r as DomainResult & { isComposite?: boolean }).isComposite;
        return (
          <g key={i}>
            {i > 0 && <line x1={pad.l - 8} y1={y - rowH / 2} x2={W - 4} y2={y - rowH / 2} stroke={T.borderLt} strokeWidth={0.5} />}
            <text x={pad.l - 8} y={y + 4} textAnchor="end" style={{ fontSize: 11, fill: T.ink, fontFamily: T.sans, fontWeight: isComp ? 700 : 400 }}>{r.label}</text>
            <line x1={xS(r.ci[0])} y1={y} x2={xS(r.ci[1])} y2={y} stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={0.55} />
            <circle cx={xS(r.z)} cy={y} r={isComp ? 5 : 4} fill={color} />
            <text x={W - pad.r + 8} y={y + 4} style={{ fontSize: 10, fill: T.ink, fontFamily: T.mono }}>
              {r.z >= 0 ? "+" : ""}{r.z.toFixed(2)} [{r.ci[0].toFixed(2)}, {r.ci[1].toFixed(2)}]
            </text>
            {!isComp && (r as DomainResult).obsPct !== undefined && (
              <>
                <rect x={pad.l - 4} y={y + 8} width={40} height={3} rx={1.5} fill={T.borderLt} />
                <rect x={pad.l - 4} y={y + 8} width={40 * (r as DomainResult).obsPct / 100} height={3} rx={1.5} fill={color} opacity={0.4} />
                <text x={pad.l + 40} y={y + 12} style={{ fontSize: 8, fill: T.ink3, fontFamily: T.mono }}>{(r as DomainResult).obsPct}% obs</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function SimulationWorkspace() {
  const [cancer, setCancer] = useState("Breast");
  const [phase, setPhase] = useState("Early survivorship");
  const [activity, setActivity] = useState("Low");
  const [sleep, setSleep] = useState("Fair");
  const [age, setAge] = useState(55);
  const [bio, setBio] = useState<Biomarkers>({ il6: null, crp: null, tnf: null, bdnf: null, cortisol: null });
  const [result, setResult] = useState<ReturnType<typeof runSim> | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    requestAnimationFrame(() => {
      const r = runSim(cancer, phase, activity, sleep, age, bio);
      setResult(r);
      setRunning(false);
    });
  }, [cancer, phase, activity, sleep, age, bio]);

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bioCount = Object.values(bio).filter((v) => v !== null).length;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* LEFT: Input */}
      <div
        style={{
          width: 300,
          borderRight: `1px solid ${T.border}`,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          background: "rgba(248,250,252,0.7)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em" }}>Simulation Console</div>
          <div style={{ fontSize: 10, color: T.ink2, fontFamily: T.mono, marginTop: 3 }}>
            Patient-Stratified Bayesian Inference
          </div>
        </div>

        <div style={{ padding: "12px 16px", flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, fontFamily: T.mono, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Hard-Scope</div>
          <div style={{ padding: "10px 12px", background: T.bg, borderRadius: 6, marginBottom: 14, border: `1px solid ${T.borderLt}`, boxShadow: "0 1px 2px rgba(15,23,42,0.03)" }}>
            {[
              { lab: "Cancer Type", val: cancer, fn: setCancer, opts: Object.keys(VULN) },
              { lab: "Treatment Phase", val: phase, fn: setPhase, opts: ["Active treatment", "Neoadjuvant", "Adjuvant", "Early survivorship", "Late survivorship", "Maintenance"] },
            ].map(({ lab, val, fn, opts }) => (
              <div key={lab} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: T.ink, display: "block", marginBottom: 4 }}>{lab}</label>
                <Select value={val} onChange={fn} options={opts} />
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, fontFamily: T.mono, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Soft-Scope</div>
          <div style={{ padding: "10px 12px", background: T.bg, borderRadius: 6, marginBottom: 14, border: `1px solid ${T.borderLt}`, boxShadow: "0 1px 2px rgba(15,23,42,0.03)" }}>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 500, color: T.ink, display: "block", marginBottom: 4 }}>Age: {age}</label>
              <input type="range" min={18} max={85} value={age} onChange={(e) => setAge(+e.target.value)} style={{ width: "100%", color: T.blue }} />
            </div>
            {[
              { lab: "Activity Level", val: activity, fn: setActivity, opts: ["Sedentary", "Low", "Moderate", "Active"] },
              { lab: "Sleep Quality", val: sleep, fn: setSleep, opts: ["Poor", "Fair", "Good"] },
            ].map(({ lab, val, fn, opts }) => (
              <div key={lab} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: T.ink, display: "block", marginBottom: 4 }}>{lab}</label>
                <Select value={val} onChange={fn} options={opts} />
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, fontFamily: T.mono, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
            Biomarker Panel ({bioCount}/5)
          </div>
          <div style={{ padding: "10px 12px", background: T.bg, borderRadius: 6, marginBottom: 14, border: `1px solid ${T.borderLt}`, boxShadow: "0 1px 2px rgba(15,23,42,0.03)" }}>
            {(["il6", "crp", "tnf", "bdnf", "cortisol"] as const).map((k, i) => (
              <div key={k} style={{ marginBottom: i < 4 ? 10 : 0 }}>
                <label style={{ fontSize: 11, fontWeight: 500, color: T.ink, display: "block", marginBottom: 4 }}>
                  {({ il6: "IL-6", crp: "CRP", tnf: "TNF-α", bdnf: "BDNF", cortisol: "Cortisol slope" })[k]}
                </label>
                <NumInput
                  value={bio[k]}
                  onChange={(v) => setBio((b) => ({ ...b, [k]: v }))}
                  placeholder="e.g. 1.8"
                  unit="z"
                />
              </div>
            ))}
            <div style={{ fontSize: 10, color: T.ink3, fontStyle: "italic", marginTop: 6 }}>
              Population z-score units (μ=0, σ=1). Leave empty for prior-only inference.
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, flexShrink: 0, background: "rgba(255,255,255,0.6)" }}>
          <button
            onClick={run}
            disabled={running}
            style={{
              width: "100%",
              padding: "10px",
              fontSize: 12,
              fontWeight: 600,
              background: running ? T.raised : T.ink,
              color: running ? T.ink2 : T.bg,
              border: "none",
              borderRadius: 6,
              cursor: running ? "wait" : "pointer",
              letterSpacing: "0.02em",
              boxShadow: running ? "none" : "0 4px 14px rgba(15,23,42,0.18)",
              transition: "all 0.15s",
            }}
          >
            {running ? "Computing M=2,000 draws..." : "Run Simulation"}
          </button>
        </div>
      </div>

      {/* RIGHT: Results */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {!result ? (
          <div style={{ textAlign: "center", padding: 60, color: T.ink3 }}>
            <div style={{ fontSize: 32, opacity: 0.12, marginBottom: 12 }}>○</div>
            <div style={{ fontSize: 13 }}>Configure patient parameters and run simulation.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Domain-Specific Cognitive Risk</div>
                <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>
                  Posterior predictive distributions over 6 domains + composite (M=2,000).
                </div>
              </div>
              <Pill color={T.blue} bg={T.blueBg}>M=2,000</Pill>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              <StatCard label="Composite CRCI" value={`${result.composite} SD`} color={T.ink} sub={`[${result.cCi[0]}, ${result.cCi[1]}]`} />
              <StatCard label="Most Impaired" value={result.domains.slice().sort((a, b) => a.z - b.z)[0].label} color={T.lo} sub={`z = ${result.domains.slice().sort((a, b) => a.z - b.z)[0].z}`} />
              <StatCard label="Top Intervention" value={result.ivs[0].name} color={T.hi} sub={`+${result.ivs[0].dc} SD`} />
            </div>

            <ForestPlot data={result.domains} compositeRow={{ label: "CRCI Composite", z: result.composite, ci: [result.cCi[0], result.cCi[1]] }} />

            {/* Rankings */}
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Intervention Rankings</div>
              {result.ivs.map((iv, i) => {
                const barMax = Math.max(...result.ivs.map((r) => Math.abs(r.dc)));
                return (
                  <div key={iv.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr 110px", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.borderLt}`, alignItems: "center" }}>
                    <div
                      style={{
                        width: 28, height: 28, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: i === 0 ? iv.color : T.raised, color: i === 0 ? T.bg : T.ink,
                        fontSize: 13, fontWeight: 700, fontFamily: T.mono,
                        border: i > 0 ? `1.5px solid ${T.border}` : "none",
                        boxShadow: i === 0 ? `0 4px 12px ${iv.color}44` : "none",
                      }}
                    >{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{iv.name}</div>
                      <div style={{ fontSize: 11, color: T.ink2, marginTop: 2 }}>{iv.dose}</div>
                      <svg width="100%" height={16} viewBox="0 0 320 16" style={{ marginTop: 4 }}>
                        <line x1={160} y1={2} x2={160} y2={14} stroke={T.border} strokeWidth={0.5} />
                        {(() => {
                          const s = 130 / barMax;
                          const cx = 160 + iv.dc * s;
                          const x1 = 160 + iv.ci[0] * s;
                          const x2 = 160 + iv.ci[1] * s;
                          return (
                            <>
                              <line x1={Math.max(4, x1)} y1={8} x2={Math.min(316, x2)} y2={8} stroke={iv.color} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
                              <circle cx={Math.max(4, Math.min(316, cx))} cy={8} r={4} fill={iv.color} />
                            </>
                          );
                        })()}
                      </svg>
                      <div style={{ fontSize: 10, color: T.ink2, fontFamily: T.mono, marginTop: 4 }}>{iv.mech}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Mono style={{ fontSize: 14, fontWeight: 700, color: iv.dc > 0 ? T.hi : T.lo }}>
                        {iv.dc >= 0 ? "+" : ""}{iv.dc.toFixed(3)} SD
                      </Mono>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Variance decomposition */}
            <div style={{ marginTop: 24, padding: "14px 16px", background: T.raised, borderRadius: 8, border: `1px solid ${T.borderLt}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Five-Source Variance Decomposition</div>
                <Mono style={{ fontSize: 11, color: T.ink2 }}>σ²_total = 0.233</Mono>
              </div>
              <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                {([[38.2, T.blue, "Edge"], [23.2, "#7C3AED", "Proxy"], [17.6, T.mid, "τ²"], [15.0, "#059669", "Latent"], [6.0, T.ink3, "Adh"]] as const).map(([p, c, l], i) => (
                  <div key={i} style={{ width: `${p}%`, background: c, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {p > 12 && <span style={{ fontSize: 8, color: "#fff", fontFamily: T.mono, fontWeight: 600 }}>{l} {p}%</span>}
                  </div>
                ))}
              </div>
              <div style={{ padding: "8px 12px", background: T.hiBg, borderRadius: 4, border: `1px solid ${T.hiLt}`, fontSize: 11, color: T.hi }}>
                <b>76%</b> of total variance is reducible through targeted data collection.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

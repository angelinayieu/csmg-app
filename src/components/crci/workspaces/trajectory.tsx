"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { T } from "../tokens";
import { Mono, Pill } from "../ui";
import { REC, SUBPOPS, PATHWAYS, VULN_MATRIX, REF_DOMAINS, IVS, type CancerType } from "../data";

// ─── Math ─────────────────────────────────────────────────────
function hillFn(d: number, emax: number, ec50: number, hill: number) {
  return (emax * Math.pow(d, hill)) / (Math.pow(ec50, hill) + Math.pow(d, hill));
}
function recoveryFn(t: number, rInf: number, tau: number, gam: number) {
  return rInf * (1 - Math.exp(-Math.pow(t / tau, gam)));
}
function trapKernel(t: number, k: { onset: number; buildup: number; plateau: number; decay: number }) {
  if (t < k.onset) return 0;
  if (t < k.onset + k.buildup) return (t - k.onset) / k.buildup;
  if (t < k.onset + k.buildup + k.plateau) return 1;
  const d = t - (k.onset + k.buildup + k.plateau);
  return Math.max(0, 1 - d / k.decay);
}
function agingFn(t: number, age: number, acc: number) {
  return -0.02 * Math.max(1, (age - 50) / 10) * acc * (t / 12);
}
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

// ─── Trajectory Panel ───────────────────────────────────────
function TrajectoryPanel({ cancer, age, ivStart, setIvStart, activeIvs, setActiveIvs }: {
  cancer: CancerType; age: number; ivStart: number; setIvStart: (n: number) => void;
  activeIvs: string[]; setActiveIvs: (a: string[]) => void;
}) {
  const r = REC[cancer];
  const W = 680, H = 340;
  const pad = { l: 54, r: 24, t: 24, b: 40 };
  const pW = W - pad.l - pad.r;
  const pH = H - pad.t - pad.b;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const data = useMemo(() => {
    const nadir = -0.65 * (r.acc / 1.5);
    return Array.from({ length: 37 }, (_, t) => {
      const R = recoveryFn(t, r.rInf, r.tau, r.gam);
      const Rv = nadir + (0 - nadir) * R;
      let I = 0;
      activeIvs.forEach((id) => {
        const iv = IVS.find((x) => x.id === id);
        if (iv) I += iv.dc * trapKernel(t - ivStart, iv.kernel);
      });
      I = clamp(I, -1.5, 1.5);
      const A = agingFn(t, age, r.acc);
      const net = Rv + I + A;
      const sdBand = Math.sqrt(0.06 + 0.01 * t + 0.005 * t * t);
      return { month: t, R: Rv, I, A, net, sdBand };
    });
  }, [cancer, age, activeIvs, ivStart, r]);

  const allY = data.flatMap((d) => [d.net - d.sdBand * 1.96, d.net + d.sdBand * 1.96, d.R]);
  const yMin = Math.min(...allY, -1.2) - 0.1;
  const yMax = Math.max(...allY, 0.3) + 0.1;
  const xS = (v: number) => pad.l + (v / 36) * pW;
  const yS = (v: number) => pad.t + pH - ((v - yMin) / (yMax - yMin)) * pH;
  const path = (key: "R" | "I" | "A" | "net") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xS(d.month).toFixed(1)},${yS(d[key]).toFixed(1)}`).join(" ");
  const bandUp = data.map((d) => `${xS(d.month).toFixed(1)},${yS(d.net + d.sdBand * 1.96).toFixed(1)}`).join(" ");
  const bandDn = data
    .map((d) => `${xS(d.month).toFixed(1)},${yS(d.net - d.sdBand * 1.96).toFixed(1)}`)
    .reverse()
    .join(" ");

  const onDrag = useCallback(
    (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      const m = Math.round(((x - pad.l) / pW) * 36);
      setIvStart(clamp(m, 0, 24));
    },
    [pW, setIvStart]
  );

  const hd = hover != null ? data[hover] : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Cognitive Trajectory: <Mono style={{ color: r.color, fontWeight: 700 }}>{r.label}</Mono>
        </div>
        <Mono style={{ fontSize: 10, color: T.ink3 }}>C(t) = R(t) + I(t) + A(t)</Mono>
      </div>
      <div style={{ fontSize: 11, color: T.ink2, marginBottom: 10 }}>
        r∞={r.rInf} · τ_R={r.tau}mo · γ={r.gam} · ACC={r.acc}×
        {activeIvs.length > 0 && (
          <span style={{ marginLeft: 8, color: T.blue }}>
            · Intervention start: month {ivStart} (drag to reposition)
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const m = Math.round(((x - pad.l) / pW) * 36);
          setHover(clamp(m, 0, 36));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="traj-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.blue} stopOpacity="0.18" />
            <stop offset="100%" stopColor={T.blue} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 6, 12, 18, 24, 30, 36].map((m) => (
          <g key={m}>
            <line x1={xS(m)} y1={pad.t} x2={xS(m)} y2={H - pad.b} stroke={T.borderLt} strokeWidth={0.5} />
            <text x={xS(m)} y={H - pad.b + 14} textAnchor="middle" style={{ fontSize: 9, fill: T.ink3, fontFamily: T.mono }}>
              {m}
            </text>
          </g>
        ))}
        {[-1, -0.5, 0, 0.5].filter((v) => v >= yMin && v <= yMax).map((v) => (
          <g key={v}>
            <line x1={pad.l} y1={yS(v)} x2={W - pad.r} y2={yS(v)} stroke={T.borderLt} strokeWidth={0.4} />
            <text x={pad.l - 6} y={yS(v) + 3} textAnchor="end" style={{ fontSize: 8, fill: T.ink3, fontFamily: T.mono }}>
              {v}
            </text>
          </g>
        ))}
        <line x1={pad.l} y1={yS(0)} x2={W - pad.r} y2={yS(0)} stroke={T.border} strokeWidth={0.8} strokeDasharray="4,4" />
        <polygon points={`${bandUp} ${bandDn}`} fill="url(#traj-band)" />
        <path d={path("R")} fill="none" stroke={T.ink3} strokeWidth={1.2} strokeDasharray="6,4" />
        {activeIvs.length > 0 && (
          <path
            d={data.map((d, i) => `${i === 0 ? "M" : "L"}${xS(d.month).toFixed(1)},${yS(d.R + d.I).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={T.blue}
            strokeWidth={1.4}
            strokeDasharray="4,3"
          />
        )}
        <path d={path("A")} fill="none" stroke={T.lo} strokeWidth={0.9} strokeDasharray="2,3" opacity={0.6} />
        <path d={path("net")} fill="none" stroke={T.ink} strokeWidth={2.5} />
        {activeIvs.length > 0 && (
          <g>
            <line x1={xS(ivStart)} y1={pad.t} x2={xS(ivStart)} y2={H - pad.b} stroke={T.blue} strokeWidth={1.5} strokeDasharray="3,2" opacity={0.65} />
            <rect
              x={xS(ivStart) - 4}
              y={pad.t - 4}
              width={8}
              height={H - pad.t - pad.b + 8}
              fill="transparent"
              style={{ cursor: "ew-resize" }}
              onMouseDown={() => {
                const up = () => document.removeEventListener("mousemove", onDrag);
                document.addEventListener("mousemove", onDrag);
                document.addEventListener("mouseup", () => { up(); document.removeEventListener("mouseup", up); }, { once: true });
              }}
            />
            <text x={xS(ivStart)} y={pad.t - 6} textAnchor="middle" style={{ fontSize: 9, fill: T.blue, fontFamily: T.mono, fontWeight: 600 }}>
              Rx start: {ivStart}mo
            </text>
          </g>
        )}
        {hd && (
          <g>
            <line x1={xS(hd.month)} y1={pad.t} x2={xS(hd.month)} y2={H - pad.b} stroke={T.ink3} strokeWidth={0.5} strokeDasharray="2,2" />
            <circle cx={xS(hd.month)} cy={yS(hd.net)} r={4.5} fill={T.ink} stroke={T.bg} strokeWidth={1.5} />
            <rect x={xS(hd.month) + 10} y={yS(hd.net) - 34} width={130} height={54} rx={5} fill={T.ink} opacity={0.94} />
            <text x={xS(hd.month) + 18} y={yS(hd.net) - 18} style={{ fontSize: 9, fill: "#94A3B8", fontFamily: T.mono }}>Month {hd.month}</text>
            <text x={xS(hd.month) + 18} y={yS(hd.net) - 4} style={{ fontSize: 12, fill: "#FFFFFF", fontFamily: T.mono, fontWeight: 700 }}>
              C(t) = {hd.net.toFixed(3)}
            </text>
            <text x={xS(hd.month) + 18} y={yS(hd.net) + 12} style={{ fontSize: 8, fill: "#94A3B8", fontFamily: T.mono }}>
              R={hd.R.toFixed(2)} I={hd.I.toFixed(2)} A={hd.A.toFixed(2)}
            </text>
          </g>
        )}
      </svg>

      <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 10, fontFamily: T.mono, color: T.ink2, justifyContent: "center" }}>
        {[
          [T.ink, "2.5", "none", "C(t) Net"],
          [T.ink3, "1.2", "6,4", "R(t) Recovery"],
          [T.blue, "1.4", "4,3", "R+I(t)"],
          [T.lo, "0.9", "2,3", "A(t) Aging"],
        ].map(([c, w, d, l], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={18} height={4}>
              <line x1={0} y1={2} x2={18} y2={2} stroke={c as string} strokeWidth={w as string} strokeDasharray={d as string} />
            </svg>
            <span>{l}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 5, flexWrap: "wrap" }}>
        {IVS.map((iv) => {
          const on = activeIvs.includes(iv.id);
          return (
            <button
              key={iv.id}
              onClick={() => setActiveIvs(on ? activeIvs.filter((x) => x !== iv.id) : [...activeIvs, iv.id])}
              style={{
                padding: "6px 12px",
                fontSize: 10,
                fontFamily: T.sans,
                fontWeight: on ? 600 : 400,
                border: `1.5px solid ${on ? iv.color : T.border}`,
                borderRadius: 5,
                cursor: "pointer",
                background: on ? iv.color + "14" : "transparent",
                color: on ? iv.color : T.ink3,
                transition: "all 0.15s",
              }}
            >
              {iv.name} (+{iv.dc})
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dose-response Panel ─────────────────────────────────────
function DosePanel() {
  const [selId, setSelId] = useState(IVS[0].id);
  const iv = IVS.find((x) => x.id === selId) || IVS[0];
  const [dose, setDose] = useState(iv.dr.opt);

  React.useEffect(() => setDose(iv.dr.opt), [selId, iv.dr.opt]);

  const W = 560, H = 220;
  const pad = { l: 50, r: 24, t: 18, b: 38 };
  const pW = W - pad.l - pad.r;
  const pH = H - pad.t - pad.b;
  const maxD = iv.dr.plat * 1.4;
  const pts = Array.from({ length: 101 }, (_, i) => {
    const d = (i * maxD) / 100;
    return { d, e: hillFn(d, iv.dr.emax, iv.dr.ec50, iv.dr.hill) };
  });
  const xS = (d: number) => pad.l + (d / maxD) * pW;
  const yS = (e: number) => pad.t + pH - (e / iv.dr.emax) * pH;
  const currentE = hillFn(dose, iv.dr.emax, iv.dr.ec50, iv.dr.hill);
  const pctMax = ((currentE / iv.dr.emax) * 100).toFixed(0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>
          Dose-Response: <span style={{ color: iv.color }}>{iv.name}</span>
        </div>
        <Mono style={{ fontSize: 10, color: T.ink3 }}>E_max / Hill</Mono>
      </div>

      <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
        {IVS.map((x) => (
          <button
            key={x.id}
            onClick={() => setSelId(x.id)}
            style={{
              padding: "5px 10px",
              fontSize: 9.5,
              fontFamily: T.mono,
              fontWeight: selId === x.id ? 700 : 400,
              border: `1.5px solid ${selId === x.id ? x.color : T.border}`,
              borderRadius: 4,
              cursor: "pointer",
              background: selId === x.id ? x.color + "14" : "transparent",
              color: selId === x.id ? x.color : T.ink3,
            }}
          >
            {x.name.split(" ")[0]}
          </button>
        ))}
      </div>

      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {([[iv.dr.minE, "Min effective", T.mid], [iv.dr.opt, "Optimal", T.hi], [iv.dr.plat, "Plateau", T.ink3]] as const).map(([d, lab, col]) => (
          <g key={lab}>
            <line x1={xS(d)} y1={pad.t} x2={xS(d)} y2={H - pad.b} stroke={col} strokeWidth={0.5} strokeDasharray="3,3" />
            <text x={xS(d)} y={pad.t - 4} textAnchor="middle" style={{ fontSize: 8, fill: col, fontFamily: T.mono }}>{lab}</text>
          </g>
        ))}
        <path
          d={`${pts.map((p, i) => `${i === 0 ? "M" : "L"}${xS(p.d).toFixed(1)},${yS(p.e).toFixed(1)}`).join(" ")} L${xS(maxD)},${yS(0)} L${xS(0)},${yS(0)} Z`}
          fill={iv.color}
          opacity={0.08}
        />
        <path d={pts.map((p, i) => `${i === 0 ? "M" : "L"}${xS(p.d).toFixed(1)},${yS(p.e).toFixed(1)}`).join(" ")} fill="none" stroke={iv.color} strokeWidth={2.5} />
        <line x1={xS(dose)} y1={yS(currentE)} x2={xS(dose)} y2={yS(0)} stroke={iv.color} strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />
        <circle cx={xS(dose)} cy={yS(currentE)} r={6} fill={iv.color} stroke={T.bg} strokeWidth={2} />
        <text x={xS(dose) + 10} y={yS(currentE) + 4} style={{ fontSize: 10, fill: iv.color, fontFamily: T.mono, fontWeight: 700 }}>
          +{currentE.toFixed(3)} ({pctMax}%)
        </text>
        <text x={pad.l + pW / 2} y={H - 4} textAnchor="middle" style={{ fontSize: 9, fill: T.ink2, fontFamily: T.mono }}>
          Dose ({iv.dr.unit})
        </text>
        {[0, iv.dr.minE, iv.dr.opt, iv.dr.plat].map((d) => (
          <text key={d} x={xS(d)} y={H - pad.b + 14} textAnchor="middle" style={{ fontSize: 8, fill: T.ink3, fontFamily: T.mono }}>
            {Math.round(d)}
          </text>
        ))}
        {[0, iv.dr.emax * 0.5, iv.dr.emax].map((e) => (
          <text key={e} x={pad.l - 4} y={yS(e) + 3} textAnchor="end" style={{ fontSize: 8, fill: T.ink3, fontFamily: T.mono }}>
            {e.toFixed(2)}
          </text>
        ))}
      </svg>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
        <Mono style={{ fontSize: 10, color: T.ink2, width: 40 }}>Dose:</Mono>
        <input
          type="range"
          min={0}
          max={iv.dr.plat * 1.3}
          step={1}
          value={dose}
          onChange={(e) => setDose(+e.target.value)}
          style={{ flex: 1, color: iv.color }}
        />
        <Mono style={{ fontSize: 12, fontWeight: 700, color: iv.color, width: 100, textAlign: "right" }}>
          {Math.round(dose)} {iv.dr.unit}
        </Mono>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
        {([
          ["Minimum Effective", iv.dr.minE, hillFn(iv.dr.minE, iv.dr.emax, iv.dr.ec50, iv.dr.hill), T.mid],
          ["Cost-Effective", iv.dr.opt, hillFn(iv.dr.opt, iv.dr.emax, iv.dr.ec50, iv.dr.hill), T.hi],
          ["Plateau (90%)", iv.dr.plat, iv.dr.emax * 0.9, T.ink2],
        ] as const).map(([lab, d, eff, col]) => (
          <div key={lab} style={{ padding: "10px 12px", background: T.raised, borderRadius: 6, border: `1px solid ${T.borderLt}` }}>
            <div style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 600, color: col, marginBottom: 3, letterSpacing: "0.04em" }}>{lab}</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color: T.ink }}>
              {Math.round(d)} {iv.dr.unit}
            </div>
            <div style={{ fontSize: 10, fontFamily: T.mono, color: T.ink3, marginTop: 2 }}>ΔC = +{eff.toFixed(3)} SD</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Heatmap ───────────────────────────────────────────────
function HeatmapPanel() {
  const cancers = Object.keys(VULN_MATRIX);
  const cellW = 68, cellH = 32, labelW = 150, topH = 46;
  const W = labelW + cancers.length * cellW + 10;
  const H = topH + PATHWAYS.length * cellH + 16;
  const [hl, setHl] = useState<string | null>(null);

  function cellColor(v: number) {
    if (v >= 0.7) return { bg: "#991B1B", fg: "#FECACA" };
    if (v >= 0.5) return { bg: "#92400E", fg: "#FDE68A" };
    if (v >= 0.3) return { bg: "rgba(30,64,175,0.14)", fg: T.blue };
    return { bg: T.raised, fg: T.ink3 };
  }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Pathway Vulnerability by Cancer Type</div>
      <div style={{ fontSize: 11, color: T.ink2, marginBottom: 14, lineHeight: 1.5 }}>
        Standardized activation scores (0–1) from composed chain effect magnitudes weighted by edge confidence.
        Higher = greater predicted cognitive impact through that mechanism.
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg width={W} height={H}>
          {cancers.map((c, ci) => {
            const sp = SUBPOPS.find((s) => s.id === c);
            return (
              <g key={c}>
                <text
                  x={labelW + ci * cellW + cellW / 2}
                  y={topH - 10}
                  textAnchor="middle"
                  style={{
                    fontSize: 10,
                    fill: hl === c ? sp?.color || T.ink : T.ink,
                    fontFamily: T.mono,
                    fontWeight: hl === c ? 700 : 500,
                    cursor: "pointer",
                  }}
                  onClick={() => setHl(hl === c ? null : c)}
                >
                  {c}
                </text>
              </g>
            );
          })}
          {PATHWAYS.map((pw, ri) => {
            const rowMax = Math.max(...cancers.map((c) => VULN_MATRIX[c][ri]));
            return (
              <g key={pw}>
                <text
                  x={labelW - 10}
                  y={topH + ri * cellH + cellH / 2 + 4}
                  textAnchor="end"
                  style={{ fontSize: 10, fill: T.ink, fontFamily: T.sans }}
                >
                  {pw}
                </text>
                {cancers.map((c, ci) => {
                  const v = VULN_MATRIX[c][ri];
                  const { bg, fg } = cellColor(v);
                  const isMax = v === rowMax;
                  const isHL = hl === c;
                  return (
                    <g key={c} style={{ cursor: "pointer" }} onClick={() => setHl(hl === c ? null : c)}>
                      <rect
                        x={labelW + ci * cellW + 2}
                        y={topH + ri * cellH + 2}
                        width={cellW - 4}
                        height={cellH - 4}
                        rx={4}
                        fill={bg}
                        stroke={isHL ? SUBPOPS.find((s) => s.id === c)?.color || T.blue : "transparent"}
                        strokeWidth={isHL ? 2 : 0}
                        opacity={isHL ? 1 : hl ? 0.35 : 1}
                        style={{ transition: "opacity 0.2s" }}
                      />
                      <text
                        x={labelW + ci * cellW + cellW / 2}
                        y={topH + ri * cellH + cellH / 2 + 4}
                        textAnchor="middle"
                        style={{
                          fontSize: 11,
                          fill: fg,
                          fontFamily: T.mono,
                          fontWeight: isMax ? 800 : 500,
                          opacity: isHL ? 1 : hl ? 0.4 : 1,
                        }}
                      >
                        {v.toFixed(2)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
        {cancers.map((c) => {
          const mean = VULN_MATRIX[c].reduce((a, b) => a + b, 0) / VULN_MATRIX[c].length;
          const sp = SUBPOPS.find((s) => s.id === c);
          return (
            <div
              key={c}
              onClick={() => setHl(hl === c ? null : c)}
              style={{
                flex: 1,
                padding: "8px 4px",
                textAlign: "center",
                borderRadius: 6,
                cursor: "pointer",
                background: hl === c ? (sp?.color || T.ink) + "14" : T.raised,
                border: `1px solid ${hl === c ? sp?.color || T.ink : T.borderLt}`,
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: T.mono, color: sp?.color || T.ink }}>
                {mean.toFixed(2)}
              </div>
              <div style={{ fontSize: 8, color: T.ink3, fontFamily: T.mono, marginTop: 2 }}>{c} mean</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────
function DashboardPanel() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div
        style={{
          gridColumn: "1 / 3",
          padding: "16px 18px",
          background: T.raised,
          borderRadius: 10,
          border: `1px solid ${T.borderLt}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Reference Patient: Domain Risk Assessment</div>
        <div style={{ fontSize: 10, color: T.ink2, marginBottom: 10 }}>
          55F, Breast (AC), 6mo post-treatment, standard biomarker panel
        </div>
        <svg width="100%" height={REF_DOMAINS.length * 32 + 40} viewBox="0 0 640 232">
          <line x1={310} y1={20} x2={310} y2={210} stroke={T.border} strokeWidth={0.5} strokeDasharray="3,3" />
          <text x={310} y={14} textAnchor="middle" style={{ fontSize: 8, fill: T.ink3, fontFamily: T.mono }}>0</text>
          {REF_DOMAINS.map((d, i) => {
            const y = 30 + i * 30;
            const s = 140;
            const color = d.z < -0.5 ? T.lo : d.z < -0.3 ? T.mid : T.ink2;
            return (
              <g key={i}>
                <text x={132} y={y + 4} textAnchor="end" style={{ fontSize: 11, fill: T.ink, fontFamily: T.sans }}>
                  {d.name}
                </text>
                <rect x={136} y={y - 2} width={48} height={4} rx={2} fill={T.borderLt} />
                <rect x={136} y={y - 2} width={(48 * d.obs) / 100} height={4} rx={2} fill={color} opacity={0.45} />
                <text x={188} y={y + 1} style={{ fontSize: 7, fill: T.ink3, fontFamily: T.mono }}>
                  {d.obs}% obs
                </text>
                <line x1={310 + d.ci[0] * s} y1={y} x2={310 + d.ci[1] * s} y2={y} stroke={color} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
                <circle cx={310 + d.z * s} cy={y} r={4.5} fill={color} />
                <text x={510} y={y + 4} style={{ fontSize: 9, fill: T.ink, fontFamily: T.mono }}>
                  {d.z.toFixed(2)} [{d.ci[0].toFixed(2)}, {d.ci[1].toFixed(2)}]
                </text>
                <text x={636} y={y + 4} textAnchor="end" style={{ fontSize: 8, fill: T.ink3, fontFamily: T.mono }}>
                  {d.edge}
                </text>
              </g>
            );
          })}
          <g>
            <line x1={200} y1={218} x2={636} y2={218} stroke={T.border} strokeWidth={0.5} />
            <text x={132} y={228} textAnchor="end" style={{ fontSize: 11, fill: T.ink, fontFamily: T.sans, fontWeight: 700 }}>
              CRCI Composite
            </text>
            <line x1={310 + -0.85 * 140} y1={224} x2={310 + -0.11 * 140} y2={224} stroke={T.ink} strokeWidth={3} strokeLinecap="round" opacity={0.55} />
            <circle cx={310 + -0.48 * 140} cy={224} r={5} fill={T.ink} />
            <text x={510} y={228} style={{ fontSize: 10, fill: T.ink, fontFamily: T.mono, fontWeight: 700 }}>
              -0.48 [-0.85, -0.11]
            </text>
          </g>
        </svg>
      </div>

      <div style={{ padding: "16px 18px", background: T.raised, borderRadius: 10, border: `1px solid ${T.borderLt}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Intervention Rankings</div>
        {IVS.map((iv, i) => (
          <div
            key={iv.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderBottom: i < IVS.length - 1 ? `1px solid ${T.borderLt}` : "none",
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: i === 0 ? iv.color : T.bg,
                color: i === 0 ? T.bg : T.ink,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: T.mono,
                border: i > 0 ? `1px solid ${T.border}` : "none",
                boxShadow: i === 0 ? `0 4px 10px ${iv.color}55` : "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: T.ink }}>{iv.name}</div>
              <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4, background: T.borderLt }}>
                {iv.mechParts.map((m, j) => (
                  <div key={j} style={{ width: `${m.p}%`, background: iv.color, opacity: 0.28 + j * 0.2 }} />
                ))}
              </div>
            </div>
            <Mono style={{ fontSize: 12, fontWeight: 700, color: T.hi, flexShrink: 0 }}>+{iv.dc.toFixed(2)}</Mono>
            <Mono style={{ fontSize: 9, color: T.ink3, width: 40, textAlign: "right", flexShrink: 0 }}>P={iv.ptop3}</Mono>
          </div>
        ))}
      </div>

      <div style={{ padding: "16px 18px", background: T.raised, borderRadius: 10, border: `1px solid ${T.borderLt}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Variance Decomposition</div>
        <div style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
          {([[38.2, T.blue, "Edge"], [23.2, T.purple, "Proxy"], [17.6, T.mid, "τ²"], [15.0, T.teal, "Latent"], [6.0, T.ink3, "Adh"]] as const).map(([p, c, l], i) => (
            <div key={i} style={{ width: `${p}%`, background: c, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {p > 12 && <span style={{ fontSize: 8, color: "#fff", fontFamily: T.mono, fontWeight: 600 }}>{p}%</span>}
            </div>
          ))}
        </div>
        {([
          [38.2, "Edge parameter uncertainty", T.blue, true, "More evidence per edge"],
          [23.2, "Measurement / proxy noise", T.purple, true, "More biomarkers measured"],
          [17.6, "Between-study heterogeneity", T.mid, "partial", "Better subgroup matching"],
          [15.0, "Unmeasured pathway variance", T.teal, true, "Add missing proxies"],
          [6.0, "Adherence / behavioral", T.ink3, "partial", "Adherence monitoring"],
        ] as const).map(([p, label, color, red, action]) => (
          <div key={label as string} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", fontSize: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color as string, flexShrink: 0 }} />
            <span style={{ flex: 1, color: T.ink2 }}>{label}</span>
            <Mono style={{ color: T.ink, fontWeight: 600, width: 40, textAlign: "right" }}>{p}%</Mono>
            <Pill color={red === true ? T.hi : T.mid}>{red === true ? "Yes" : "Partial"}</Pill>
          </div>
        ))}
        <div style={{ marginTop: 10, padding: "8px 12px", background: T.hiBg, borderRadius: 5, border: `1px solid ${T.hiLt}`, fontSize: 10.5, color: T.hi }}>
          <b>76%</b> reducible through targeted data collection.
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────
export default function TrajectoryWorkspace() {
  const [tab, setTab] = useState<"dashboard" | "trajectory" | "dose" | "heatmap">("dashboard");
  const [cancer, setCancer] = useState<CancerType>("BCA");
  const [age, setAge] = useState(55);
  const [ivStart, setIvStart] = useState(2);
  const [activeIvs, setActiveIvs] = useState(["exercise"]);

  const tabStyle = (t: string) => ({
    padding: "8px 18px",
    fontSize: 11,
    fontWeight: tab === t ? 600 : 400,
    fontFamily: T.sans,
    color: tab === t ? T.ink : T.ink3,
    borderBottom: tab === t ? `2px solid ${T.ink}` : "2px solid transparent",
    cursor: "pointer",
    background: "none",
    border: "none",
    letterSpacing: "0.02em",
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          borderBottom: `1px solid ${T.border}`,
          padding: "8px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          background: "rgba(255,255,255,0.7)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ display: "flex" }}>
          <button style={tabStyle("dashboard")} onClick={() => setTab("dashboard")}>Patient Dashboard</button>
          <button style={tabStyle("trajectory")} onClick={() => setTab("trajectory")}>Trajectory</button>
          <button style={tabStyle("dose")} onClick={() => setTab("dose")}>Dose-Response</button>
          <button style={tabStyle("heatmap")} onClick={() => setTab("heatmap")}>Vulnerability</button>
        </div>
        {(tab === "trajectory" || tab === "dashboard") && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Mono style={{ fontSize: 10, color: T.ink3 }}>Cancer:</Mono>
              <select
                value={cancer}
                onChange={(e) => setCancer(e.target.value as CancerType)}
                style={{ padding: "4px 8px", fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.sans, outline: "none" }}
              >
                {Object.entries(REC).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Mono style={{ fontSize: 10, color: T.ink3 }}>Age:</Mono>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(+e.target.value)}
                min={18}
                max={85}
                style={{ width: 52, padding: "4px 6px", fontSize: 11, fontFamily: T.mono, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none", textAlign: "center" }}
              />
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {tab === "dashboard" && <DashboardPanel />}
        {tab === "trajectory" && (
          <TrajectoryPanel
            cancer={cancer}
            age={age}
            ivStart={ivStart}
            setIvStart={setIvStart}
            activeIvs={activeIvs}
            setActiveIvs={setActiveIvs}
          />
        )}
        {tab === "dose" && <DosePanel />}
        {tab === "heatmap" && <HeatmapPanel />}
      </div>
    </div>
  );
}

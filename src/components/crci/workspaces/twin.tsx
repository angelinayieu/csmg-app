"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   CRCI COGNITIVE TWIN · CIRCULAR SIMULATOR
   Patient-specific live simulator. Drag any biomarker / behavioral input
   to forecast CRCI composite shift across 7d / 14d / 30d.
   Inputs map to the 63-node DAG: Activity→OIC, IL-6→OIC, Cortisol→HPA,
   Sleep→HPA, BDNF→Neuroplasticity, Phase→Fatigue Loop.
   ═══════════════════════════════════════════════════════════════════════ */

// ─── CSS (scoped by container class) ──────────────────────────────
const twinCSS = `
.twin-root {
  --canvas: #f1f1f3;
  --paper: #ffffff;
  --surface: #fafafa;
  --ink: #0a0b0f;
  --ink-2: #2a2c33;
  --ink-3: #6b6d77;
  --ink-4: #a4a6ad;
  --line: rgba(10, 11, 15, 0.08);
  --line-2: rgba(10, 11, 15, 0.05);
  --accent: #4f46e5;
  --accent-soft: #eef0fe;
  --c-activity: #4f46e5;
  --c-il6: #059669;
  --c-cortisol: #dc2626;
  --c-sleep: #0284c7;
  --c-bdnf: #d97706;
  --c-phase: #6b6d77;
  --signal-good: #059669;
  --signal-bad: #dc2626;
  --t-font: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --t-mono: 'IBM Plex Mono', ui-monospace, monospace;
  font-family: var(--t-font);
  color: var(--ink);
  width: 100%; height: 100%;
  background: var(--canvas);
  overflow: auto;
  padding: 14px;
  letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased;
}
.twin-root * { box-sizing: border-box; margin: 0; padding: 0; }
.twin-page { width: 100%; max-width: 1480px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
.twin-main { display: grid; grid-template-columns: 280px 1fr 300px; gap: 12px; min-height: 880px; }
.twin-panel { background: var(--paper); border-radius: 12px; border: 0.5px solid var(--line); overflow: hidden; display: flex; flex-direction: column; }
.twin-left { display: grid; grid-template-rows: auto 1fr auto; gap: 12px; min-height: 0; }
.twin-right { display: grid; grid-template-rows: auto 1fr auto; gap: 12px; min-height: 0; }

/* Lab profile card */
.lab-profile { padding: 18px 18px 16px; }
.lp-eyebrow { font-size: 10px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 7px; }
.lp-eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.lp-title { font-size: 20px; font-weight: 600; color: var(--ink); letter-spacing: -0.025em; line-height: 1.15; margin-bottom: 8px; }
.lp-sub { font-size: 12px; color: var(--ink-3); line-height: 1.5; margin-bottom: 14px; }
.lp-accuracy { padding: 13px; background: linear-gradient(135deg, var(--accent-soft) 0%, #f5f3ff 100%); border-radius: 10px; border: 0.5px solid rgba(79,70,229,0.15); }
.lpa-label { font-size: 9.5px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 6px; }
.lpa-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.lpa-value { font-size: 26px; font-weight: 700; color: var(--ink); letter-spacing: -0.04em; line-height: 1; font-feature-settings: 'tnum'; }
.lpa-unit { font-size: 14px; color: var(--ink-3); font-weight: 500; }
.lpa-trend { font-family: var(--t-mono); font-size: 10.5px; font-weight: 600; color: var(--signal-good); margin-left: auto; }
.lpa-bar { height: 3px; background: rgba(79,70,229,0.18); border-radius: 2px; overflow: hidden; margin-bottom: 5px; }
.lpa-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; }
.lpa-caption { font-size: 10px; color: var(--ink-3); display: flex; justify-content: space-between; font-weight: 500; }
.lpa-caption .target { font-family: var(--t-mono); }

.twin-panel-head { padding: 14px 18px 11px; border-bottom: 0.5px solid var(--line-2); display: flex; align-items: center; }
.twin-panel-head h3 { font-size: 13px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.twin-panel-count { margin-left: auto; font-family: var(--t-mono); font-size: 10px; color: var(--ink-3); padding: 2px 6px; background: var(--canvas); border-radius: 4px; font-weight: 500; }
.twin-panel-body { flex: 1; overflow-y: auto; padding: 6px; }
.infra-item { display: grid; grid-template-columns: 28px 1fr 14px; gap: 10px; align-items: center; padding: 9px 10px; border-radius: 8px; cursor: pointer; }
.infra-item:hover { background: var(--surface); }
.infra-icon { width: 28px; height: 28px; border-radius: 7px; background: var(--surface); border: 0.5px solid var(--line-2); display: flex; align-items: center; justify-content: center; color: var(--ink-2); }
.infra-icon.activity { color: var(--c-activity); background: var(--accent-soft); border-color: rgba(79,70,229,0.15); }
.infra-icon.il6 { color: var(--c-il6); background: rgba(5,150,105,0.08); border-color: rgba(5,150,105,0.15); }
.infra-icon.cortisol { color: var(--c-cortisol); background: rgba(220,38,38,0.06); border-color: rgba(220,38,38,0.15); }
.infra-icon.sleep { color: var(--c-sleep); background: rgba(2,132,199,0.07); border-color: rgba(2,132,199,0.15); }
.infra-icon.bdnf { color: var(--c-bdnf); background: rgba(217,119,6,0.07); border-color: rgba(217,119,6,0.15); }
.infra-name { font-size: 12.5px; color: var(--ink); font-weight: 500; line-height: 1.2; margin-bottom: 1px; }
.infra-meta { font-size: 10.5px; color: var(--ink-3); }
.infra-status { width: 6px; height: 6px; border-radius: 50%; background: var(--signal-good); margin: 0 auto; }

.connected-panel { padding: 14px 18px 16px; }
.conn-list { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.conn-row { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 7px 0; font-size: 11.5px; }
.conn-icon { width: 22px; height: 22px; border-radius: 5px; background: var(--surface); display: flex; align-items: center; justify-content: center; color: var(--ink-2); }
.conn-name { color: var(--ink); font-weight: 500; }
.conn-state { font-family: var(--t-mono); font-size: 9.5px; color: var(--signal-good); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

/* STAGE */
.twin-stage { background: var(--paper); border-radius: 12px; border: 0.5px solid var(--line); position: relative; overflow: hidden; min-height: 940px; }
.twin-stage::before { content: ''; position: absolute; inset: 0; background-image: radial-gradient(circle, rgba(10,11,15,0.05) 0.6px, transparent 0.6px); background-size: 22px 22px; pointer-events: none; z-index: 0; }

.stage-header { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; align-items: center; justify-content: space-between; z-index: 30; pointer-events: none; }
.sh-left, .sh-right { display: flex; align-items: center; gap: 10px; pointer-events: auto; }
.live-pill { display: flex; align-items: center; gap: 8px; padding: 7px 13px; background: var(--paper); border: 0.5px solid var(--line); border-radius: 9px; font-size: 11.5px; font-weight: 500; color: var(--ink); box-shadow: 0 1px 3px rgba(10,11,15,0.04); }
.live-pill .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--signal-good); box-shadow: 0 0 0 3px rgba(5,150,105,0.15); animation: twin-live-pulse 2s ease-in-out infinite; }
@keyframes twin-live-pulse { 0%,100% { box-shadow: 0 0 0 3px rgba(5,150,105,0.15); } 50% { box-shadow: 0 0 0 5px rgba(5,150,105,0.08); } }
.live-pill .muted { color: var(--ink-3); font-weight: 400; }

.horizon-toggle { display: flex; padding: 3px; background: var(--paper); border: 0.5px solid var(--line); border-radius: 8px; box-shadow: 0 1px 3px rgba(10,11,15,0.04); }
.horizon-btn { padding: 5px 10px; font-size: 10.5px; font-weight: 600; color: var(--ink-3); border-radius: 5px; cursor: pointer; font-family: var(--t-mono); }
.horizon-btn.active { background: var(--ink); color: #fff; }

.reset-btn { padding: 7px 12px; font-size: 11.5px; font-weight: 500; color: var(--ink); background: var(--paper); border: 0.5px solid var(--line); border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(10,11,15,0.04); }
.reset-btn:hover { background: var(--surface); }
.reset-btn.dirty { background: var(--accent); border-color: var(--accent); color: #fff; }

.insight-banner { position: absolute; top: 56px; left: 50%; transform: translateX(-50%) translateY(-6px); background: var(--ink); color: #fff; padding: 7px 13px; border-radius: 8px; font-size: 11.5px; font-weight: 500; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(10,11,15,0.2); opacity: 0; pointer-events: none; transition: opacity 0.25s, transform 0.25s; z-index: 30; }
.insight-banner.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.insight-banner .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px rgba(79,70,229,0.3); }
.insight-banner strong { font-weight: 700; }
.insight-banner .muted { opacity: 0.6; font-weight: 400; }

.twin-canvas { position: absolute; inset: 0; z-index: 1; overflow: hidden; cursor: grab; }
.twin-canvas:active { cursor: grabbing; }
.canvas-inner { position: absolute; inset: 0; transform-origin: 450px 470px; transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; }
.canvas-inner.no-transition { transition: none; }
.canvas-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

.canvas-controls { position: absolute; bottom: 16px; right: 16px; display: flex; background: var(--paper); border: 0.5px solid var(--line); border-radius: 9px; box-shadow: 0 1px 3px rgba(10,11,15,0.04); z-index: 30; overflow: hidden; }
.cc-btn { padding: 7px 11px; background: var(--paper); border: none; border-right: 0.5px solid var(--line); cursor: pointer; color: var(--ink-3); font-family: var(--t-font); font-size: 12px; font-weight: 500; min-width: 34px; }
.cc-btn:last-child { border-right: none; }
.cc-btn:hover { background: var(--surface); color: var(--ink); }
.cc-zoom-level { padding: 7px 12px; font-family: var(--t-mono); font-size: 10.5px; font-weight: 600; color: var(--ink-3); border-right: 0.5px solid var(--line); background: var(--surface); min-width: 52px; text-align: center; }

/* Sphere */
.center-sphere { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 420px; height: 420px; border-radius: 50%; background: radial-gradient(circle at 32% 28%, rgba(255,255,255,0.04) 0%, transparent 40%), radial-gradient(circle at 70% 80%, rgba(79,70,229,0.08) 0%, transparent 45%), #0a0b0f; box-shadow: 0 0 0 1px rgba(10,11,15,0.5), 0 16px 56px rgba(10,11,15,0.22), 0 4px 14px rgba(10,11,15,0.1); z-index: 4; overflow: hidden; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 70px; }
.center-sphere::before { content: ''; position: absolute; inset: 5px; border-radius: 50%; border: 0.5px solid rgba(255,255,255,0.06); pointer-events: none; }
.cs-eyebrow { font-family: var(--t-mono); font-size: 9.5px; font-weight: 700; color: rgba(255,255,255,0.5); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.cs-eyebrow .dot { width: 5px; height: 5px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,0.18); }
.cs-target-label { font-size: 12px; color: rgba(255,255,255,0.58); font-weight: 500; margin-bottom: 18px; text-align: center; letter-spacing: -0.01em; }
.cs-score-row { display: flex; align-items: baseline; gap: 4px; margin-bottom: 8px; justify-content: center; }
.cs-score-value { font-size: 68px; font-weight: 700; letter-spacing: -0.05em; line-height: 0.95; font-feature-settings: 'tnum'; color: #fff; transition: color 0.3s; }
.cs-score-value.changed { color: #a5b4fc; }
.cs-score-decimal { font-size: 30px; color: rgba(255,255,255,0.5); font-weight: 600; letter-spacing: -0.04em; }
.cs-score-of { font-size: 13px; color: rgba(255,255,255,0.4); font-weight: 500; margin-left: 6px; letter-spacing: 0.02em; }
.cs-delta { font-family: var(--t-mono); font-size: 11.5px; color: #34d399; font-weight: 600; margin-bottom: 20px; }
.cs-delta.negative { color: #fb7185; }
.cs-chart { width: 100%; height: 60px; margin-bottom: 4px; }
.cs-chart-labels { display: flex; justify-content: space-between; width: 100%; font-family: var(--t-mono); font-size: 8.5px; color: rgba(255,255,255,0.35); font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; }

.projection-pills { position: absolute; left: 50%; top: calc(50% + 240px); transform: translateX(-50%); display: flex; gap: 10px; z-index: 6; }
.proj-pill { background: var(--paper); border: 0.5px solid var(--line); border-radius: 10px; padding: 9px 14px 10px; display: flex; flex-direction: column; align-items: center; min-width: 102px; box-shadow: 0 2px 8px rgba(10,11,15,0.06); }
.proj-pill-label { font-family: var(--t-mono); font-size: 8.5px; font-weight: 700; color: var(--ink-3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 3px; }
.proj-pill-value { font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: -0.035em; line-height: 1; font-feature-settings: 'tnum'; transition: color 0.3s; }
.proj-pill-value.changed { color: var(--accent); }
.proj-pill-decimal { font-size: 11px; color: var(--ink-3); font-weight: 500; }
.proj-pill-delta { font-family: var(--t-mono); font-size: 9.5px; color: var(--signal-good); font-weight: 600; margin-top: 3px; }
.proj-pill-delta.negative { color: var(--signal-bad); }

/* Input nodes (observable proxies → RECTANGLE) */
.input-node { position: absolute; transform: translate(-50%, -50%); z-index: 5; pointer-events: none; }
.input-node-shape { width: 32px; height: 22px; border-radius: 4px; background: var(--ink); border: 2px solid var(--paper); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(10,11,15,0.15); pointer-events: auto; cursor: pointer; transition: transform 0.15s; position: relative; }
.input-node-shape::after { content: ''; width: 11px; height: 6px; border-radius: 1.5px; background: var(--paper); }
.input-node:hover .input-node-shape { transform: scale(1.12); }
.input-node.activity .input-node-shape { background: var(--c-activity); }
.input-node.il6 .input-node-shape { background: var(--c-il6); }
.input-node.cortisol .input-node-shape { background: var(--c-cortisol); }
.input-node.sleep .input-node-shape { background: var(--c-sleep); }
.input-node.bdnf .input-node-shape { background: var(--c-bdnf); }
.input-node.phase .input-node-shape { background: var(--c-phase); }
.input-node-label { position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-family: var(--t-mono); font-size: 10px; font-weight: 600; color: var(--ink); background: var(--paper); padding: 1px 5px; border-radius: 3px; border: 0.5px solid var(--line); pointer-events: none; white-space: nowrap; }
.input-node-label.below { top: auto; bottom: -22px; }

/* Features (latent pathways → DIAMOND) */
.feature-node { position: absolute; transform: translate(-50%, -50%); width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; z-index: 5; cursor: help; transition: transform 0.15s; }
.feature-node:hover { transform: translate(-50%, -50%) scale(1.12); z-index: 15; }
.feature-diamond { position: absolute; inset: 0; background: #F4F4F5; border: 1px solid #0a0b0f; transform: rotate(45deg); border-radius: 3px; box-shadow: 0 2px 6px rgba(10,11,15,0.08); transition: background 0.2s, border-color 0.2s; }
.feature-node:hover .feature-diamond { box-shadow: 0 4px 12px rgba(10,11,15,0.18); }
.feature-label { position: relative; z-index: 2; font-family: var(--t-mono); font-size: 11px; font-weight: 700; color: var(--ink); pointer-events: none; letter-spacing: -0.02em; }
.feature-node.pulse .feature-diamond { animation: twin-feature-pulse-d 0.9s ease-out; }
.feature-node.pulse .feature-label { animation: twin-feature-pulse-lab 0.9s ease-out; }
@keyframes twin-feature-pulse-d {
  0% { transform: rotate(45deg) scale(1); box-shadow: 0 0 0 0 rgba(79,70,229,0.5); }
  40% { transform: rotate(45deg) scale(1.25); box-shadow: 0 0 0 14px rgba(79,70,229,0); background: var(--accent); border-color: var(--accent); }
  100% { transform: rotate(45deg) scale(1); box-shadow: 0 0 0 0 rgba(79,70,229,0); background: #F4F4F5; }
}
@keyframes twin-feature-pulse-lab {
  0%, 100% { color: var(--ink); }
  40% { color: #fff; }
}

.feature-tooltip { position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%) translateY(4px); width: 236px; background: var(--ink); color: #fff; border-radius: 9px; padding: 10px 12px 11px; box-shadow: 0 8px 24px rgba(10,11,15,0.25), 0 2px 6px rgba(10,11,15,0.15); opacity: 0; pointer-events: none; transition: opacity 0.18s, transform 0.18s; z-index: 25; text-align: left; }
.feature-node:hover .feature-tooltip { opacity: 1; transform: translateX(-50%) translateY(0); }
.feature-tooltip::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 5px solid transparent; border-top-color: var(--ink); }
.ft-label { font-family: var(--t-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #a5b4fc; margin-bottom: 4px; }
.ft-name { font-size: 12.5px; font-weight: 600; letter-spacing: -0.015em; color: #fff; margin-bottom: 6px; line-height: 1.25; }
.ft-desc { font-size: 10.5px; line-height: 1.45; color: rgba(255,255,255,0.7); font-weight: 400; }
.ft-sources { margin-top: 7px; padding-top: 7px; border-top: 0.5px solid rgba(255,255,255,0.12); font-family: var(--t-mono); font-size: 9px; color: rgba(255,255,255,0.55); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
.ft-sources strong { color: #fff; font-weight: 700; }

/* Input cards */
.input-card { position: absolute; transform: translate(-50%, -50%); width: 200px; padding: 11px 13px 12px; background: var(--paper); border: 0.5px solid var(--line); border-radius: 12px; box-shadow: 0 4px 12px rgba(10,11,15,0.05), 0 1px 3px rgba(10,11,15,0.03); z-index: 6; }
.input-card.active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), 0 4px 12px rgba(10,11,15,0.05); }
.input-card.dirty::before { content: ''; position: absolute; top: 9px; right: 9px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
.ic-tag { display: inline-flex; align-items: center; gap: 4px; font-family: var(--t-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-bottom: 6px; }
.ict-activity { background: var(--accent-soft); color: var(--c-activity); }
.ict-il6 { background: rgba(5,150,105,0.08); color: var(--c-il6); }
.ict-cortisol { background: rgba(220,38,38,0.06); color: var(--c-cortisol); }
.ict-sleep { background: rgba(2,132,199,0.08); color: var(--c-sleep); }
.ict-bdnf { background: rgba(217,119,6,0.08); color: var(--c-bdnf); }
.ict-phase { background: var(--canvas); color: var(--ink-3); }
.ic-name { font-size: 12px; font-weight: 600; color: var(--ink); letter-spacing: -0.015em; margin-bottom: 6px; line-height: 1.2; }
.ic-value-row { display: flex; align-items: baseline; gap: 4px; margin-bottom: 6px; }
.ic-value { font-size: 19px; font-weight: 700; color: var(--ink); letter-spacing: -0.03em; line-height: 1; font-feature-settings: 'tnum'; transition: color 0.2s; }
.ic-value.changed { color: var(--accent); }
.ic-unit { font-size: 10.5px; color: var(--ink-3); font-weight: 500; }
.ic-weight { margin-left: auto; font-family: var(--t-mono); font-size: 9px; color: var(--ink-4); font-weight: 600; }
.ic-weight strong { color: var(--ink-3); font-weight: 700; }
.ic-spark { height: 16px; width: 100%; margin-bottom: 7px; }
.slider-wrap { position: relative; height: 22px; }
.slider-track { position: absolute; top: 10px; left: 0; right: 0; height: 3px; background: rgba(10,11,15,0.08); border-radius: 2px; }
.slider-baseline-mark { position: absolute; top: 6px; width: 1.5px; height: 11px; background: var(--ink-4); border-radius: 1px; transform: translateX(-50%); opacity: 0.5; }
.slider-fill { position: absolute; top: 10px; height: 3px; border-radius: 2px; transition: background 0.15s; }
.slider-fill.activity { background: var(--c-activity); }
.slider-fill.il6 { background: var(--c-il6); }
.slider-fill.cortisol { background: var(--c-cortisol); }
.slider-fill.sleep { background: var(--c-sleep); }
.slider-fill.bdnf { background: var(--c-bdnf); }
.slider-fill.phase { background: var(--c-phase); }
.slider-handle { position: absolute; top: 5px; width: 13px; height: 13px; background: var(--paper); border: 2px solid var(--ink); border-radius: 50%; transform: translateX(-50%); cursor: grab; box-shadow: 0 1px 3px rgba(10,11,15,0.12); z-index: 2; transition: box-shadow 0.15s, transform 0.15s; }
.slider-handle:hover { transform: translateX(-50%) scale(1.18); box-shadow: 0 2px 6px rgba(10,11,15,0.22); }
.slider-handle:active { cursor: grabbing; transform: translateX(-50%) scale(1.25); box-shadow: 0 3px 10px rgba(79,70,229,0.3); }
.slider-handle::after { content: ''; position: absolute; inset: 3px 5.5px; border-left: 1px solid currentColor; border-right: 1px solid currentColor; opacity: 0.4; }
.slider-handle.activity { border-color: var(--c-activity); color: var(--c-activity); }
.slider-handle.il6 { border-color: var(--c-il6); color: var(--c-il6); }
.slider-handle.cortisol { border-color: var(--c-cortisol); color: var(--c-cortisol); }
.slider-handle.sleep { border-color: var(--c-sleep); color: var(--c-sleep); }
.slider-handle.bdnf { border-color: var(--c-bdnf); color: var(--c-bdnf); }
.slider-handle.phase { border-color: var(--c-phase); color: var(--c-phase); }
.slider-handle.hint-pulse { animation: twin-hint-pulse 1.8s ease-in-out 3; }
@keyframes twin-hint-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(79,70,229,0); transform: translateX(-50%) scale(1); } 50% { box-shadow: 0 0 0 7px rgba(79,70,229,0.25); transform: translateX(-50%) scale(1.12); } }

/* Right column cards */
.objective-card { padding: 16px 18px; }
.obj-eyebrow { font-size: 10px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; margin-bottom: 8px; }
.obj-statement { font-size: 13.5px; font-weight: 600; color: var(--ink); letter-spacing: -0.015em; line-height: 1.4; }
.obj-statement .key { color: var(--accent); background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }
.update-card { padding: 12px; background: var(--surface); border-radius: 10px; margin-bottom: 7px; cursor: pointer; border: 0.5px solid var(--line-2); }
.update-card.featured { background: var(--accent-soft); border-color: rgba(79,70,229,0.18); }
.uc-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.uc-tag { font-family: var(--t-mono); font-size: 9px; padding: 2px 6px; border-radius: 3px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.uct-proposal { background: var(--accent-soft); color: var(--accent); }
.uct-finding { background: rgba(5,150,105,0.1); color: var(--c-il6); }
.uct-update { background: rgba(217,119,6,0.1); color: var(--c-bdnf); }
.uc-time { margin-left: auto; font-family: var(--t-mono); font-size: 10px; color: var(--ink-3); }
.uc-title { font-size: 12px; color: var(--ink); font-weight: 600; line-height: 1.35; margin-bottom: 5px; letter-spacing: -0.01em; }
.uc-desc { font-size: 11px; color: var(--ink-3); line-height: 1.45; margin-bottom: 9px; }
.uc-actions { display: flex; gap: 5px; }
.uc-btn { padding: 5px 10px; font-size: 11px; font-weight: 500; border-radius: 6px; cursor: pointer; flex: 1; text-align: center; }
.ucb-pri { background: var(--ink); color: #fff; }
.ucb-sec { background: var(--paper); color: var(--ink); border: 0.5px solid var(--line); }

.schedule-panel { padding: 14px 18px; }
.sched-row { display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 0.5px solid var(--line-2); font-size: 11.5px; }
.sched-row:last-child { border-bottom: none; padding-bottom: 0; }
.sched-row:first-child { padding-top: 4px; }
.sched-icon { width: 24px; height: 24px; border-radius: 6px; background: var(--surface); border: 0.5px solid var(--line-2); display: flex; align-items: center; justify-content: center; color: var(--ink-2); }
.sched-name { color: var(--ink); font-weight: 500; font-size: 11.5px; }
.sched-meta { color: var(--ink-3); font-size: 10px; margin-top: 1px; }
.sched-when { font-family: var(--t-mono); font-size: 10px; color: var(--ink-3); text-align: right; font-weight: 500; }
`;

// ─── CRCI-CUSTOMIZED MODEL ────────────────────────────────────────
type InputKey = "x1" | "x2" | "x3" | "x4" | "x5" | "c1";

interface InputDef {
  baseline: number;
  min: number;
  max: number;
  coef: number;
  unit: string;
  name: string;
  tagClass: string;
  category: string;
  value: number;
  formatValue?: (v: number) => string;
}

const INPUTS: Record<InputKey, InputDef> = {
  // Activity → OIC (anti-inflammatory) — higher is better
  x1: { baseline: 90, min: 0, max: 300, coef: 0.22, unit: "min/wk", name: "Physical activity", tagClass: "activity", category: "ACTIVITY", value: 90 },
  // IL-6 → OIC — higher is worse (negative coef)
  x2: { baseline: 1.8, min: 0, max: 6, coef: -0.20, unit: "pg/mL", name: "IL-6", tagClass: "il6", category: "INFLAMMATION", value: 1.8, formatValue: (v) => v.toFixed(1) },
  // Cortisol slope → HPA — higher is worse
  x3: { baseline: 0.6, min: -2, max: 3, coef: -0.14, unit: "z-score", name: "Cortisol slope", tagClass: "cortisol", category: "HPA", value: 0.6, formatValue: (v) => v.toFixed(2) },
  // Sleep efficiency → HPA/Cognition — higher is better
  x4: { baseline: 78, min: 30, max: 100, coef: 0.18, unit: "%", name: "Sleep efficiency", tagClass: "sleep", category: "CIRCADIAN", value: 78 },
  // BDNF → Neuroplasticity — higher is better
  x5: { baseline: -0.5, min: -3, max: 2, coef: 0.18, unit: "z-score", name: "BDNF", tagClass: "bdnf", category: "NEUROPLASTICITY", value: -0.5, formatValue: (v) => v.toFixed(2) },
  // Phase post-treatment (weeks) — recovery improves with time
  c1: { baseline: 12, min: 0, max: 48, coef: 0.10, unit: "wks", name: "Weeks post-Tx", tagClass: "phase", category: "CONTEXT", value: 12 },
};

const INPUT_FEATURES: Record<InputKey, string[]> = {
  x1: ["f1", "f3"],
  x2: ["f1", "f2"],
  x3: ["f2", "f3"],
  x4: ["f2", "f4"],
  x5: ["f3", "f4"],
  c1: ["f4"],
};

const EDGE_WEIGHTS: Record<string, number> = {
  "x1-f1": 0.72, "x1-f3": 0.54,
  "x2-f1": 0.88, "x2-f2": 0.41,
  "x3-f2": 0.76, "x3-f3": 0.30,
  "x4-f2": 0.62, "x4-f4": 0.58,
  "x5-f3": 0.48, "x5-f4": 0.84,
  "c1-f4": 0.35,
};

const COLOR_OF_CLASS: Record<string, string> = {
  activity: "#4f46e5", il6: "#059669", cortisol: "#dc2626",
  sleep: "#0284c7", bdnf: "#d97706", phase: "#6b6d77",
};

const FEATURES = {
  f1: {
    name: "Neuroinflammation (OIC)",
    desc: "Composite of chronic inflammatory load driving OIC activation — the primary mediator of chemo-related cognitive impairment.",
    sources: "FROM x₁ Activity + x₂ IL-6 + x₃ Cortisol",
  },
  f2: {
    name: "HPA dysregulation",
    desc: "Cortisol-rhythm disruption combined with sleep architecture — modulates episodic and working memory circuits.",
    sources: "FROM x₂ IL-6 + x₃ Cortisol + x₄ Sleep",
  },
  f3: {
    name: "Neuroplasticity reserve",
    desc: "Activity-dependent BDNF and recovery state — determines cognitive training responsiveness and episodic memory recovery.",
    sources: "FROM x₁ Activity + x₃ Cortisol + x₅ BDNF",
  },
  f4: {
    name: "Fatigue / encoding capacity",
    desc: "Symptom-mediated bottleneck on processing speed and working memory — recovers as treatment recedes and sleep consolidates.",
    sources: "FROM x₄ Sleep + x₅ BDNF + c₁ Phase",
  },
};

const PAST_DATA = [68.2, 67.1, 66.8, 68.5, 69.2, 70.4, 71.1, 70.8, 72.3, 73.5, 72.9, 74.1, 74.8, 75.6];
const FUTURE_POINTS = 14;
const CS_W = 280, CS_H = 70;
const CS_NOW_X = 168;
const Y_MIN = 50, Y_MAX = 95;

function predictScore(inputs: Record<InputKey, InputDef>) {
  let contribution = 0;
  (Object.keys(inputs) as InputKey[]).forEach((k) => {
    const inp = inputs[k];
    const delta = inp.value - inp.baseline;
    const range = inp.max - inp.min;
    const normalized = delta / (range / 2);
    contribution += inp.coef * normalized * 10;
  });
  return 75.6 + contribution;
}

function generateFuture(inputs: Record<InputKey, InputDef>) {
  const data: number[] = [];
  for (let i = 0; i < FUTURE_POINTS; i++) {
    const t = (i + 1) / FUTURE_POINTS;
    let contribution = 0;
    (Object.keys(inputs) as InputKey[]).forEach((k) => {
      const inp = inputs[k];
      const delta = inp.value - inp.baseline;
      const range = inp.max - inp.min;
      const normalized = delta / (range / 2);
      const compound = 1 - Math.exp(-t * 2);
      contribution += inp.coef * normalized * 10 * (1 + compound * 0.6);
    });
    const noise = Math.sin(i * 0.8) * 0.3;
    data.push(75.6 + contribution + noise);
  }
  return data;
}

function csValueToY(v: number) {
  const pct = (v - Y_MIN) / (Y_MAX - Y_MIN);
  return CS_H - pct * CS_H * 0.85 - 5;
}

function pointsToPath(points: number[], startX: number, endX: number, valueToYFn: (v: number) => number) {
  if (points.length === 0) return "";
  const step = (endX - startX) / (points.length - 1);
  let d = `M ${startX} ${valueToYFn(points[0])}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = startX + (i - 1) * step;
    const x1 = startX + i * step;
    const y0 = valueToYFn(points[i - 1]);
    const y1 = valueToYFn(points[i]);
    const midX = (x0 + x1) / 2;
    d += ` C ${midX} ${y0}, ${midX} ${y1}, ${x1} ${y1}`;
  }
  return d;
}
function pointsToAreaPath(points: number[], startX: number, endX: number, valueToYFn: (v: number) => number, height: number) {
  return `${pointsToPath(points, startX, endX, valueToYFn)} L ${endX} ${height} L ${startX} ${height} Z`;
}

// ─── Main Component ──────────────────────────────────────────────
export default function TwinWorkspace() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasInnerRef = useRef<HTMLDivElement>(null);
  const edgesGroupRef = useRef<SVGGElement>(null);
  const inputsRef = useRef<Record<InputKey, InputDef>>(structuredClone(INPUTS));
  const [, forceRender] = useState(0);

  // Canvas transform state
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const panRef = useRef({ isPanning: false, startX: 0, startY: 0 });

  // ── Apply transform to inner canvas
  const applyTransform = useCallback(() => {
    if (!canvasInnerRef.current) return;
    const { scale, tx, ty } = transformRef.current;
    canvasInnerRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    const zl = rootRef.current?.querySelector("[data-zoom-level]");
    if (zl) zl.textContent = `${Math.round(scale * 100)}%`;
  }, []);

  // ── Update DOM to reflect current inputs state
  const renderSphereChart = useCallback(() => {
    const inputs = inputsRef.current;
    const future = generateFuture(inputs);

    const $past = rootRef.current?.querySelector("[data-cs-past]");
    const $pastArea = rootRef.current?.querySelector("[data-cs-past-area]");
    const $future = rootRef.current?.querySelector("[data-cs-future]");
    const $futureArea = rootRef.current?.querySelector("[data-cs-future-area]");
    const $baseline = rootRef.current?.querySelector("[data-cs-baseline]") as SVGPathElement | null;
    const $nowDot = rootRef.current?.querySelector("[data-cs-now-dot]");

    $past?.setAttribute("d", pointsToPath(PAST_DATA, 0, CS_NOW_X, csValueToY));
    $pastArea?.setAttribute("d", pointsToAreaPath(PAST_DATA, 0, CS_NOW_X, csValueToY, CS_H));
    const futureAnchored = [PAST_DATA[PAST_DATA.length - 1], ...future];
    $future?.setAttribute("d", pointsToPath(futureAnchored, CS_NOW_X, CS_W, csValueToY));
    $futureArea?.setAttribute("d", pointsToAreaPath(futureAnchored, CS_NOW_X, CS_W, csValueToY, CS_H));
    $nowDot?.setAttribute("cy", String(csValueToY(PAST_DATA[PAST_DATA.length - 1])));

    // Baseline ghost (when dirty)
    const dirty = isSimulationDirty();
    if (dirty) {
      const savedValues: Record<InputKey, number> = {} as Record<InputKey, number>;
      (Object.keys(inputs) as InputKey[]).forEach((k) => { savedValues[k] = inputs[k].value; inputs[k].value = inputs[k].baseline; });
      const baselineFuture = generateFuture(inputs);
      const baselineToday = predictScore(inputs);
      (Object.keys(inputs) as InputKey[]).forEach((k) => { inputs[k].value = savedValues[k]; });
      const baselineAnchored = [baselineToday, ...baselineFuture];
      if ($baseline) {
        $baseline.setAttribute("d", pointsToPath(baselineAnchored, CS_NOW_X, CS_W, csValueToY));
        $baseline.style.opacity = "0.55";
      }
    } else if ($baseline) {
      $baseline.style.opacity = "0";
    }

    // Update score displays
    const today = predictScore(inputs);
    const day7 = future[6];
    const day14 = future[13];

    const setScore = (sel: string, v: number) => {
      const el = rootRef.current?.querySelector(sel);
      if (!el) return;
      const whole = Math.floor(v);
      const dec = Math.floor((v % 1) * 10);
      el.innerHTML = `${whole}<span class="cs-score-decimal">.${dec}</span>`;
    };
    setScore("[data-score-today]", today);
    const setPill = (sel: string, v: number) => {
      const el = rootRef.current?.querySelector(sel);
      if (!el) return;
      const whole = Math.floor(v);
      const dec = Math.floor((v % 1) * 10);
      el.innerHTML = `${whole}<span class="proj-pill-decimal">.${dec}</span>`;
    };
    setPill("[data-score-7d]", day7);
    setPill("[data-score-14d]", day14);

    const yesterdayActual = PAST_DATA[PAST_DATA.length - 2];
    const todayActual = PAST_DATA[PAST_DATA.length - 1];
    const setDelta = (sel: string, d: number, suf: string) => {
      const el = rootRef.current?.querySelector(sel);
      if (!el) return;
      const sign = d >= 0 ? "↑" : "↓";
      el.textContent = `${sign} ${Math.abs(d).toFixed(1)}${suf ? " " + suf : ""}`;
      el.classList.toggle("negative", d < 0);
    };
    setDelta("[data-delta-today]", today - yesterdayActual, "vs. yesterday");
    setDelta("[data-delta-7d]", day7 - todayActual, "");
    setDelta("[data-delta-14d]", day14 - todayActual, "");

    rootRef.current?.querySelector("[data-score-today]")?.classList.toggle("changed", dirty);
    rootRef.current?.querySelector("[data-score-7d]")?.classList.toggle("changed", dirty);
    rootRef.current?.querySelector("[data-score-14d]")?.classList.toggle("changed", dirty);
  }, []);

  const isSimulationDirty = useCallback(() => {
    const inputs = inputsRef.current;
    return (Object.keys(inputs) as InputKey[]).some((k) => Math.abs(inputs[k].value - inputs[k].baseline) > 0.001);
  }, []);

  const updateDirtyState = useCallback(() => {
    const dirty = isSimulationDirty();
    rootRef.current?.querySelector("[data-reset-btn]")?.classList.toggle("dirty", dirty);

    (Object.keys(inputsRef.current) as InputKey[]).forEach((k) => {
      const card = rootRef.current?.querySelector(`.input-card[data-input="${k}"]`);
      if (!card) return;
      const isDirtyInput = Math.abs(inputsRef.current[k].value - inputsRef.current[k].baseline) > 0.001;
      card.classList.toggle("dirty", isDirtyInput);
      const valueEl = card.querySelector(`[data-value-for="${k}"]`);
      valueEl?.classList.toggle("changed", isDirtyInput);
    });

    const banner = rootRef.current?.querySelector("[data-insight-banner]");
    const insightText = rootRef.current?.querySelector("[data-insight-text]");
    if (dirty && banner && insightText) {
      const current = predictScore(inputsRef.current);
      const delta = current - 75.6;
      const sign = delta >= 0 ? "↑" : "↓";
      insightText.innerHTML = `<strong>Simulated</strong> <span class="muted">· CRCI shifts ${sign} ${Math.abs(delta).toFixed(1)} pts</span>`;
      banner.classList.add("show");
    } else if (banner) {
      banner.classList.remove("show");
    }
  }, [isSimulationDirty]);

  // ── Render edges from DOM positions
  const renderEdges = useCallback(() => {
    const g = edgesGroupRef.current;
    const inner = canvasInnerRef.current;
    if (!g || !inner) return;
    g.innerHTML = "";

    const innerW = inner.clientWidth;
    const innerH = inner.clientHeight;
    const scaleX = 900 / innerW;
    const scaleY = 940 / innerH;
    const toSvg = (p: { x: number; y: number }) => ({ x: p.x * scaleX, y: p.y * scaleY });
    const scale = transformRef.current.scale || 1;

    const getCenter = (el: Element | null) => {
      if (!el) return null;
      const innerRect = inner.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        x: (r.left + r.width / 2 - innerRect.left) / scale,
        y: (r.top + r.height / 2 - innerRect.top) / scale,
      };
    };

    const getSphere = () => {
      const sphere = inner.querySelector(".center-sphere");
      if (!sphere) return null;
      const innerRect = inner.getBoundingClientRect();
      const r = sphere.getBoundingClientRect();
      return {
        x: (r.left + r.width / 2 - innerRect.left) / scale,
        y: (r.top + r.height / 2 - innerRect.top) / scale,
        r: (r.width / 2) / scale,
      };
    };

    const inputKeys: InputKey[] = ["x1", "x2", "x3", "x4", "x5", "c1"];

    // 1) Connector from input card to input node
    inputKeys.forEach((id) => {
      const nodeC = getCenter(inner.querySelector(`[data-input-node="${id}"]`));
      const card = inner.querySelector(`.input-card[data-input="${id}"]`);
      if (!nodeC || !card) return;
      const innerRect = inner.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const cardCx = (cardRect.left + cardRect.width / 2 - innerRect.left) / scale;
      const cardCy = (cardRect.top + cardRect.height / 2 - innerRect.top) / scale;
      const dx = nodeC.x - cardCx;
      const dy = nodeC.y - cardCy;
      const halfW = cardRect.width / 2 / scale;
      const halfH = cardRect.height / 2 / scale;
      let tx: number, ty: number;
      if (Math.abs(dx) * halfH > Math.abs(dy) * halfW) {
        const sign = dx > 0 ? 1 : -1;
        tx = cardCx + sign * halfW;
        ty = cardCy + dy * (halfW / Math.max(0.0001, Math.abs(dx)));
      } else {
        const sign = dy > 0 ? 1 : -1;
        ty = cardCy + sign * halfH;
        tx = cardCx + dx * (halfH / Math.max(0.0001, Math.abs(dy)));
      }
      // Input node is now a 32×22 rectangle — approximate with nearest-edge intercept
      const nodeHW = 18, nodeHH = 13;
      const a = Math.atan2(nodeC.y - ty, nodeC.x - tx);
      const nodeR = Math.abs(Math.cos(a)) * nodeHW > Math.abs(Math.sin(a)) * nodeHH
        ? nodeHW / Math.max(0.0001, Math.abs(Math.cos(a)))
        : nodeHH / Math.max(0.0001, Math.abs(Math.sin(a)));
      const endX = nodeC.x - Math.cos(a) * nodeR;
      const endY = nodeC.y - Math.sin(a) * nodeR;
      const s = toSvg({ x: tx, y: ty });
      const e = toSvg({ x: endX, y: endY });
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${s.x} ${s.y} L ${e.x} ${e.y}`);
      path.setAttribute("stroke", COLOR_OF_CLASS[inputsRef.current[id].tagClass]);
      path.setAttribute("stroke-width", "1");
      path.setAttribute("stroke-opacity", "0.35");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-dasharray", "3 3");
      g.appendChild(path);
    });

    // 2) Input → Feature edges
    inputKeys.forEach((id) => {
      const features = INPUT_FEATURES[id];
      const fromC = getCenter(inner.querySelector(`[data-input-node="${id}"]`));
      if (!fromC) return;
      features.forEach((fId) => {
        const toC = getCenter(inner.querySelector(`[data-feature="${fId}"]`));
        if (!toC) return;
        const w = EDGE_WEIGHTS[`${id}-${fId}`] || 0.5;
        // Input node (rectangle 32x22) → diamond feature (56x56 rotated 45°, ≈ circle r=28 at tips)
        const nodeHW = 18, nodeHH = 13;
        const dx = toC.x - fromC.x;
        const dy = toC.y - fromC.y;
        const aNode = Math.atan2(dy, dx);
        const nodeR = Math.abs(Math.cos(aNode)) * nodeHW > Math.abs(Math.sin(aNode)) * nodeHH
          ? nodeHW / Math.max(0.0001, Math.abs(Math.cos(aNode)))
          : nodeHH / Math.max(0.0001, Math.abs(Math.sin(aNode)));
        const startX = fromC.x + Math.cos(aNode) * nodeR;
        const startY = fromC.y + Math.sin(aNode) * nodeR;
        // Diamond intercept: for a 56×56 square rotated 45°, the boundary along angle a satisfies
        // |cos(a)| + |sin(a)| = R, so distance = halfDiag / (|cos|+|sin|). halfDiag ≈ 28.
        const halfDiag = 28;
        const aFeat = Math.atan2(fromC.y - toC.y, fromC.x - toC.x);
        const featR = halfDiag / (Math.abs(Math.cos(aFeat)) + Math.abs(Math.sin(aFeat)));
        const endX = toC.x + Math.cos(aFeat) * featR;
        const endY = toC.y + Math.sin(aFeat) * featR;
        const cp1x = startX + dx * 0.5;
        const cp1y = startY + dy * 0.15;
        const cp2x = startX + dx * 0.5;
        const cp2y = startY + dy * 0.85;
        const s = toSvg({ x: startX, y: startY });
        const c1s = toSvg({ x: cp1x, y: cp1y });
        const c2s = toSvg({ x: cp2x, y: cp2y });
        const e = toSvg({ x: endX, y: endY });
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${s.x} ${s.y} C ${c1s.x} ${c1s.y}, ${c2s.x} ${c2s.y}, ${e.x} ${e.y}`);
        path.setAttribute("stroke", COLOR_OF_CLASS[inputsRef.current[id].tagClass]);
        path.setAttribute("stroke-width", (0.8 + w * 1.8).toFixed(2));
        path.setAttribute("stroke-opacity", (0.35 + w * 0.4).toFixed(2));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke-linecap", "round");
        if (id === "c1") path.setAttribute("stroke-dasharray", "4 3");
        g.appendChild(path);
      });
    });

    // 3) Feature → Sphere edges
    const sphere = getSphere();
    if (sphere) {
      (["f1", "f2", "f3", "f4"] as const).forEach((fId) => {
        const fromC = getCenter(inner.querySelector(`[data-feature="${fId}"]`));
        if (!fromC) return;
        // Diamond boundary intercept
        const halfDiag = 28;
        const aFeat = Math.atan2(sphere.y - fromC.y, sphere.x - fromC.x);
        const featR = halfDiag / (Math.abs(Math.cos(aFeat)) + Math.abs(Math.sin(aFeat)));
        const sx = fromC.x + Math.cos(aFeat) * featR;
        const sy = fromC.y + Math.sin(aFeat) * featR;
        const aSphere = Math.atan2(fromC.y - sphere.y, fromC.x - sphere.x);
        const ex = sphere.x + Math.cos(aSphere) * sphere.r;
        const ey = sphere.y + Math.sin(aSphere) * sphere.r;
        const s = toSvg({ x: sx, y: sy });
        const e = toSvg({ x: ex, y: ey });
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${s.x} ${s.y} L ${e.x} ${e.y}`);
        path.setAttribute("stroke", "#0a0b0f");
        path.setAttribute("stroke-width", "1.5");
        path.setAttribute("stroke-opacity", "0.45");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke-linecap", "round");
        g.appendChild(path);
      });
    }
  }, []);

  // ── Setup: sliders, pan/zoom, initial render
  useEffect(() => {
    if (!rootRef.current) return;

    // Slider drag
    const sliderHandles = rootRef.current.querySelectorAll<HTMLDivElement>(".slider-handle");
    const cleanupFns: Array<() => void> = [];

    sliderHandles.forEach((handle) => {
      const inputId = handle.getAttribute("data-handle-for") as InputKey;
      const min = parseFloat(handle.getAttribute("data-min") || "0");
      const max = parseFloat(handle.getAttribute("data-max") || "100");
      let isDragging = false;

      const start = (e: MouseEvent | TouchEvent) => {
        isDragging = true;
        handle.classList.remove("hint-pulse");
        handle.closest(".input-card")?.classList.add("active");
        e.preventDefault();
      };
      const move = (e: MouseEvent | TouchEvent) => {
        if (!isDragging) return;
        const clientX = (e as MouseEvent).clientX ?? (e as TouchEvent).touches?.[0]?.clientX ?? 0;
        const track = handle.parentElement;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        let pct = (clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const value = min + pct * (max - min);
        inputsRef.current[inputId].value = value;
        const pctV = pct * 100;
        handle.style.left = `${pctV}%`;
        const fill = rootRef.current?.querySelector<HTMLElement>(`[data-fill-for="${inputId}"]`);
        if (fill) fill.style.width = `${pctV}%`;
        const valueEl = rootRef.current?.querySelector(`.input-card [data-value-for="${inputId}"]`);
        if (valueEl) {
          const fmt = inputsRef.current[inputId].formatValue;
          valueEl.textContent = fmt ? fmt(value) : String(Math.round(value));
        }
        // Pulse features
        (INPUT_FEATURES[inputId] || []).forEach((fId) => {
          const fNode = rootRef.current?.querySelector<HTMLElement>(`[data-feature="${fId}"]`);
          if (fNode) {
            fNode.classList.remove("pulse");
            void fNode.offsetWidth;
            fNode.classList.add("pulse");
          }
        });
        renderSphereChart();
        updateDirtyState();
      };
      const end = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.closest(".input-card")?.classList.remove("active");
      };

      handle.addEventListener("mousedown", start);
      handle.addEventListener("touchstart", start, { passive: false });
      window.addEventListener("mousemove", move);
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("mouseup", end);
      window.addEventListener("touchend", end);
      cleanupFns.push(() => {
        handle.removeEventListener("mousedown", start);
        handle.removeEventListener("touchstart", start);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("touchend", end);
      });
    });

    // Reset button
    const resetBtn = rootRef.current.querySelector("[data-reset-btn]");
    const onReset = () => {
      (Object.keys(inputsRef.current) as InputKey[]).forEach((k) => {
        const inp = inputsRef.current[k];
        inp.value = inp.baseline;
        const pct = ((inp.baseline - inp.min) / (inp.max - inp.min)) * 100;
        const handle = rootRef.current?.querySelector<HTMLElement>(`[data-handle-for="${k}"]`);
        const fill = rootRef.current?.querySelector<HTMLElement>(`[data-fill-for="${k}"]`);
        if (handle) {
          handle.style.transition = "left 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
          handle.style.left = `${pct}%`;
          setTimeout(() => { handle.style.transition = ""; }, 400);
        }
        if (fill) {
          fill.style.transition = "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
          fill.style.width = `${pct}%`;
          setTimeout(() => { fill.style.transition = ""; }, 400);
        }
        const valueEl = rootRef.current?.querySelector(`.input-card [data-value-for="${k}"]`);
        if (valueEl) {
          const fmt = inp.formatValue;
          valueEl.textContent = fmt ? fmt(inp.baseline) : String(Math.round(inp.baseline));
        }
      });
      renderSphereChart();
      updateDirtyState();
      rootRef.current?.querySelectorAll(".feature-node").forEach((f, i) => {
        setTimeout(() => {
          f.classList.remove("pulse");
          void (f as HTMLElement).offsetWidth;
          f.classList.add("pulse");
        }, i * 80);
      });
    };
    resetBtn?.addEventListener("click", onReset);
    cleanupFns.push(() => resetBtn?.removeEventListener("click", onReset));

    // Horizon buttons
    const horizonBtns = rootRef.current.querySelectorAll("[data-horizon]");
    const horizonHandlers: Array<{ el: Element; fn: () => void }> = [];
    horizonBtns.forEach((btn) => {
      const fn = () => {
        horizonBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      };
      btn.addEventListener("click", fn);
      horizonHandlers.push({ el: btn, fn });
    });
    cleanupFns.push(() => horizonHandlers.forEach(({ el, fn }) => el.removeEventListener("click", fn)));

    // Pan/zoom
    const canvasEl = rootRef.current.querySelector<HTMLDivElement>("[data-canvas]");
    if (canvasEl) {
      const onMouseDown = (e: MouseEvent) => {
        const t = e.target as Element;
        if (
          t.closest(".slider-handle") || t.closest(".input-card") || t.closest(".center-sphere") ||
          t.closest(".feature-node") || t.closest(".input-node") || t.closest(".proj-pill")
        ) return;
        panRef.current.isPanning = true;
        panRef.current.startX = e.clientX - transformRef.current.tx;
        panRef.current.startY = e.clientY - transformRef.current.ty;
        canvasInnerRef.current?.classList.add("no-transition");
        e.preventDefault();
      };
      const onMove = (e: MouseEvent) => {
        if (!panRef.current.isPanning) return;
        transformRef.current.tx = e.clientX - panRef.current.startX;
        transformRef.current.ty = e.clientY - panRef.current.startY;
        applyTransform();
      };
      const onUp = () => {
        if (!panRef.current.isPanning) return;
        panRef.current.isPanning = false;
        canvasInnerRef.current?.classList.remove("no-transition");
      };
      const onWheel = (e: WheelEvent) => {
        const t = e.target as Element;
        if (t.closest(".input-card") || t.closest(".center-sphere")) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        const ns = Math.max(0.5, Math.min(2, transformRef.current.scale + delta));
        const rect = canvasEl.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const k = ns / transformRef.current.scale;
        transformRef.current.tx = cx - (cx - transformRef.current.tx) * k;
        transformRef.current.ty = cy - (cy - transformRef.current.ty) * k;
        transformRef.current.scale = ns;
        applyTransform();
      };
      canvasEl.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      canvasEl.addEventListener("wheel", onWheel, { passive: false });
      cleanupFns.push(() => {
        canvasEl.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        canvasEl.removeEventListener("wheel", onWheel);
      });
    }

    // Zoom controls
    const zi = rootRef.current.querySelector("[data-zoom-in]");
    const zo = rootRef.current.querySelector("[data-zoom-out]");
    const zf = rootRef.current.querySelector("[data-zoom-fit]");
    const onZoomIn = () => { transformRef.current.scale = Math.min(2, transformRef.current.scale + 0.15); applyTransform(); };
    const onZoomOut = () => { transformRef.current.scale = Math.max(0.5, transformRef.current.scale - 0.15); applyTransform(); };
    const onZoomFit = () => { transformRef.current = { scale: 1, tx: 0, ty: 0 }; applyTransform(); };
    zi?.addEventListener("click", onZoomIn);
    zo?.addEventListener("click", onZoomOut);
    zf?.addEventListener("click", onZoomFit);
    cleanupFns.push(() => {
      zi?.removeEventListener("click", onZoomIn);
      zo?.removeEventListener("click", onZoomOut);
      zf?.removeEventListener("click", onZoomFit);
    });

    // Initial paint
    const initFrame = () => {
      renderEdges();
      renderSphereChart();
      updateDirtyState();
      // Entry pulse
      setTimeout(() => {
        rootRef.current?.querySelectorAll(".feature-node").forEach((f, i) => {
          setTimeout(() => {
            f.classList.remove("pulse");
            void (f as HTMLElement).offsetWidth;
            f.classList.add("pulse");
          }, i * 120);
        });
      }, 300);
    };
    requestAnimationFrame(() => requestAnimationFrame(initFrame));

    // Resize
    let rt: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => renderEdges(), 100);
    };
    window.addEventListener("resize", onResize);
    cleanupFns.push(() => window.removeEventListener("resize", onResize));

    return () => cleanupFns.forEach((f) => f());
  }, [renderEdges, renderSphereChart, updateDirtyState, applyTransform]);

  // Initial slider positions (computed from baseline)
  const initialPct = (k: InputKey) => {
    const inp = INPUTS[k];
    return ((inp.baseline - inp.min) / (inp.max - inp.min)) * 100;
  };

  return (
    <div className="twin-root" ref={rootRef}>
      <style>{twinCSS}</style>

      <div className="twin-page">
        <div className="twin-main">
          {/* LEFT COLUMN */}
          <div className="twin-left">
            <div className="twin-panel lab-profile">
              <div className="lp-eyebrow"><span className="dot" />ACTIVE TWIN · DAY 84 POST-CHEMO</div>
              <div className="lp-title">Cognitive Performance Twin</div>
              <div className="lp-sub">Patient-specific model predicting CRCI composite trajectory from tracked biomarker and behavioral proxies</div>
              <div className="lp-accuracy">
                <div className="lpa-label">MODEL CONCORDANCE</div>
                <div className="lpa-row">
                  <div className="lpa-value">84<span className="lpa-unit">%</span></div>
                  <div className="lpa-trend">↑ 3% in 14d</div>
                </div>
                <div className="lpa-bar"><div className="lpa-bar-fill" style={{ width: "84%" }} /></div>
                <div className="lpa-caption">
                  <span>9 of 18 chains concordant</span>
                  <span className="target">target: 90%</span>
                </div>
              </div>
            </div>

            <div className="twin-panel" style={{ minHeight: 0, flex: 1 }}>
              <div className="twin-panel-head">
                <h3>Supporting instruments</h3>
                <span className="twin-panel-count">5 live</span>
              </div>
              <div className="twin-panel-body">
                {[
                  { cls: "activity", name: "FACT-Cog PCI", meta: "weekly · PRO", icon: <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.2" fill="none" /> },
                  { cls: "il6", name: "IL-6 / CRP panel", meta: "biweekly · serum", icon: <path d="M2 7.5 L5 4 L7 10 L10 5 L13 8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /> },
                  { cls: "cortisol", name: "Cortisol diurnal", meta: "salivary · 4 samples/day", icon: <path d="M7.5 2 V13 M2 7.5 H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> },
                  { cls: "sleep", name: "Sleep architecture", meta: "Oura · nightly", icon: <path d="M11 6 C11 9 8.5 11 6 10.5 C7.5 10 9 8 9 6 C9 4 7.5 2 6 1.5 C8.5 1 11 3 11 6 Z" stroke="currentColor" strokeWidth="1.2" fill="none" /> },
                  { cls: "bdnf", name: "NIH Toolbox Cog", meta: "monthly · digital", icon: <rect x="2" y="5" width="11" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" /> },
                ].map((s, i) => (
                  <div key={i} className="infra-item">
                    <div className={`infra-icon ${s.cls}`}>
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">{s.icon}</svg>
                    </div>
                    <div>
                      <div className="infra-name">{s.name}</div>
                      <div className="infra-meta">{s.meta}</div>
                    </div>
                    <div className="infra-status" />
                  </div>
                ))}
              </div>
            </div>

            <div className="twin-panel connected-panel">
              <div className="twin-panel-head" style={{ padding: 0, border: "none", marginBottom: 4 }}>
                <h3>Data sources</h3>
                <span className="twin-panel-count">5 live</span>
              </div>
              <div className="conn-list">
                {["Oura Ring", "Apple Watch", "EHR (Epic)", "Patient Portal", "Lab Corp"].map((n) => (
                  <div key={n} className="conn-row">
                    <div className="conn-icon">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.1" />
                      </svg>
                    </div>
                    <div>
                      <div className="conn-name">{n}</div>
                    </div>
                    <div className="conn-state">live</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CENTER STAGE */}
          <div className="twin-stage">
            <div className="stage-header">
              <div className="sh-left">
                <div className="live-pill">
                  <span className="pulse" />
                  Live simulator <span className="muted">· drag any biomarker to forecast CRCI</span>
                </div>
              </div>
              <div className="sh-right">
                <div className="horizon-toggle">
                  <div className="horizon-btn" data-horizon="7">7D</div>
                  <div className="horizon-btn active" data-horizon="14">14D</div>
                  <div className="horizon-btn" data-horizon="30">30D</div>
                </div>
                <div className="reset-btn" data-reset-btn>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M2 5.5C2 3.5 3.5 2 5.5 2C7 2 8.3 2.9 8.8 4M9 2.5V4.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Reset
                </div>
              </div>
            </div>

            <div className="insight-banner" data-insight-banner>
              <span className="dot" />
              <span data-insight-text><strong>Simulated</strong> <span className="muted">· CRCI shifts</span></span>
            </div>

            <div className="twin-canvas" data-canvas>
              <div className="canvas-inner" ref={canvasInnerRef}>
                <svg className="canvas-svg" viewBox="0 0 900 940" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <radialGradient id="twinCenterGlow" cx="50%" cy="50%">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.06" />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <circle cx="450" cy="470" r="300" fill="url(#twinCenterGlow)" />
                  <circle cx="450" cy="470" r="275" fill="none" stroke="#0a0b0f" strokeWidth="0.4" opacity="0.06" strokeDasharray="2 4" />
                  <circle cx="450" cy="470" r="360" fill="none" stroke="#0a0b0f" strokeWidth="0.4" opacity="0.04" strokeDasharray="2 5" />
                  <g ref={edgesGroupRef} />
                </svg>

                {/* CENTER SPHERE */}
                <div className="center-sphere">
                  <div className="cs-eyebrow"><span className="dot" />PREDICTED · TODAY</div>
                  <div className="cs-target-label">CRCI composite (cognitive capacity)</div>
                  <div className="cs-score-row">
                    <span className="cs-score-value" data-score-today>75<span className="cs-score-decimal">.6</span></span>
                    <span className="cs-score-of">/ 100</span>
                  </div>
                  <div className="cs-delta" data-delta-today>↑ 0.8 vs. yesterday</div>
                  <svg className="cs-chart" viewBox="0 0 280 60" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="twinGradPast" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="twinGradFuture" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#a5b4fc" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <line x1="168" y1="0" x2="168" y2="60" stroke="#fff" strokeWidth="0.6" opacity="0.2" strokeDasharray="2 2" />
                    <path data-cs-past-area fill="url(#twinGradPast)" d="" />
                    <path data-cs-past stroke="#ffffff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" d="" />
                    <path data-cs-baseline stroke="#a4a6ad" strokeWidth="1.2" fill="none" strokeDasharray="3 3" opacity="0" d="" />
                    <path data-cs-future-area fill="url(#twinGradFuture)" d="" />
                    <path data-cs-future stroke="#a5b4fc" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" d="" />
                    <circle data-cs-now-dot cx="168" cy="30" r="3" fill="#fff" />
                  </svg>
                  <div className="cs-chart-labels">
                    <span>14d ago</span>
                    <span>now</span>
                    <span>+14d</span>
                  </div>
                </div>

                {/* Projection pills */}
                <div className="projection-pills">
                  <div className="proj-pill">
                    <div className="proj-pill-label">DAY 7</div>
                    <span className="proj-pill-value" data-score-7d>77<span className="proj-pill-decimal">.2</span></span>
                    <div className="proj-pill-delta" data-delta-7d>↑ 1.6</div>
                  </div>
                  <div className="proj-pill">
                    <div className="proj-pill-label">DAY 14</div>
                    <span className="proj-pill-value" data-score-14d>78<span className="proj-pill-decimal">.9</span></span>
                    <div className="proj-pill-delta" data-delta-14d>↑ 3.3</div>
                  </div>
                </div>

                {/* INPUT NODES */}
                {([
                  { id: "x1", cls: "activity", left: 270, top: 158, labelBelow: false },
                  { id: "x2", cls: "il6", left: 630, top: 158, labelBelow: false },
                  { id: "x3", cls: "cortisol", left: 90, top: 470, labelBelow: false },
                  { id: "x4", cls: "sleep", left: 810, top: 470, labelBelow: false },
                  { id: "x5", cls: "bdnf", left: 270, top: 782, labelBelow: true },
                  { id: "c1", cls: "phase", left: 630, top: 782, labelBelow: true },
                ] as const).map((n) => (
                  <div key={n.id} className={`input-node ${n.cls}`} data-input-node={n.id} style={{ left: n.left, top: n.top }}>
                    <div className="input-node-shape" />
                    <div className={`input-node-label${n.labelBelow ? " below" : ""}`}>{n.id === "c1" ? "c₁" : `x${n.id.slice(1)}`}</div>
                  </div>
                ))}

                {/* FEATURE NODES */}
                {(["f1", "f2", "f3", "f4"] as const).map((fId, i) => {
                  const coords = [
                    [256, 276], [644, 276], [256, 664], [644, 664],
                  ][i];
                  const f = FEATURES[fId];
                  const label = fId === "f1" ? "f₁" : fId === "f2" ? "f₂" : fId === "f3" ? "f₃" : "f₄";
                  return (
                    <div key={fId} className="feature-node" data-feature={fId} style={{ left: coords[0], top: coords[1] }}>
                      <div className="feature-diamond" />
                      <span className="feature-label">{label}</span>
                      <div className="feature-tooltip">
                        <div className="ft-label">LATENT PATHWAY · L3</div>
                        <div className="ft-name">{f.name}</div>
                        <div className="ft-desc">{f.desc}</div>
                        <div className="ft-sources" dangerouslySetInnerHTML={{ __html: f.sources.replace(/(x\d|c\d)/g, "<strong>$1</strong>") }} />
                      </div>
                    </div>
                  );
                })}

                {/* INPUT CARDS */}
                {([
                  { id: "x1" as InputKey, left: 145, top: 60, hint: true },
                  { id: "x2" as InputKey, left: 755, top: 60, hint: false },
                  { id: "x3" as InputKey, left: 125, top: 470, hint: false },
                  { id: "x4" as InputKey, left: 775, top: 470, hint: false },
                  { id: "x5" as InputKey, left: 145, top: 880, hint: false },
                  { id: "c1" as InputKey, left: 755, top: 880, hint: false },
                ]).map(({ id, left, top, hint }) => {
                  const inp = INPUTS[id];
                  const pct = initialPct(id);
                  const w = EDGE_WEIGHTS[`${id}-${INPUT_FEATURES[id][0]}`] || 0.5;
                  return (
                    <div key={id} className="input-card" data-input={id} style={{ left, top }}>
                      <div className={`ic-tag ict-${inp.tagClass}`}>
                        <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                          <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1" />
                        </svg>
                        {inp.category}
                      </div>
                      <div className="ic-name">{inp.name}</div>
                      <div className="ic-value-row">
                        <span className="ic-value" data-value-for={id}>{inp.formatValue ? inp.formatValue(inp.baseline) : Math.round(inp.baseline)}</span>
                        <span className="ic-unit">{inp.unit}</span>
                        <span className="ic-weight">w=<strong>{w.toFixed(2)}</strong></span>
                      </div>
                      <svg className="ic-spark" viewBox="0 0 180 16" preserveAspectRatio="none">
                        <path d={`M0 ${10 - Math.sin(0) * 4} L20 ${9 - Math.sin(1) * 3} L40 ${11 - Math.sin(2) * 3} L60 ${8 - Math.sin(3) * 4} L80 ${7} L100 ${9 - Math.sin(5) * 3} L120 ${6} L140 ${5} L160 ${4} L180 ${3}`}
                          stroke={COLOR_OF_CLASS[inp.tagClass]} strokeWidth="1.2" fill="none" strokeLinecap="round" />
                      </svg>
                      <div className="slider-wrap">
                        <div className="slider-track" />
                        <div className="slider-baseline-mark" style={{ left: `${pct}%` }} />
                        <div className={`slider-fill ${inp.tagClass}`} data-fill-for={id} style={{ left: 0, width: `${pct}%` }} />
                        <div
                          className={`slider-handle ${inp.tagClass}${hint ? " hint-pulse" : ""}`}
                          data-handle-for={id}
                          data-min={inp.min}
                          data-max={inp.max}
                          data-baseline={inp.baseline}
                          style={{ left: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="canvas-controls">
                <button className="cc-btn" data-zoom-out title="Zoom out">−</button>
                <div className="cc-zoom-level" data-zoom-level>100%</div>
                <button className="cc-btn" data-zoom-in title="Zoom in">+</button>
                <button className="cc-btn" data-zoom-fit title="Fit" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>FIT</button>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="twin-right">
            <div className="twin-panel objective-card">
              <div className="obj-eyebrow">TWIN OBJECTIVE</div>
              <div className="obj-statement">
                Find the <span className="key">minimum proxy set</span> that reliably predicts CRCI trajectory for this patient — so the clinic knows what to actually measure
              </div>
            </div>

            <div className="twin-panel" style={{ minHeight: 0, flex: 1 }}>
              <div className="twin-panel-head">
                <h3>Proposed updates</h3>
                <span className="twin-panel-count">3 new</span>
              </div>
              <div className="twin-panel-body" style={{ padding: 10 }}>
                <div className="update-card featured">
                  <div className="uc-top">
                    <span className="uc-tag uct-finding">New finding</span>
                    <span className="uc-time">12m ago</span>
                  </div>
                  <div className="uc-title">NfL may outperform IL-6 as a myelin-pathway proxy</div>
                  <div className="uc-desc">Sałat et al. (2024) · ER_NFL_MYELIN now k=3, concordance +0.04</div>
                  <div className="uc-actions">
                    <div className="uc-btn ucb-pri">Add proxy</div>
                    <div className="uc-btn ucb-sec">Read</div>
                  </div>
                </div>
                <div className="update-card">
                  <div className="uc-top">
                    <span className="uc-tag uct-proposal">Proxy proposal</span>
                    <span className="uc-time">1h ago</span>
                  </div>
                  <div className="uc-title">Add glymphatic clearance as sleep-pathway proxy</div>
                  <div className="uc-desc">Would resolve Sleep→OIC chain (k=0 currently)</div>
                  <div className="uc-actions">
                    <div className="uc-btn ucb-pri">Plan</div>
                    <div className="uc-btn ucb-sec">Defer</div>
                  </div>
                </div>
                <div className="update-card">
                  <div className="uc-top">
                    <span className="uc-tag uct-update">Model update</span>
                    <span className="uc-time">3h ago</span>
                  </div>
                  <div className="uc-title">Drop Phase proxy — weight = 0.10, not significant</div>
                  <div className="uc-desc">Week-post-Tx not predictive for this patient after 84 days</div>
                  <div className="uc-actions">
                    <div className="uc-btn ucb-pri">Drop</div>
                    <div className="uc-btn ucb-sec">Keep</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="twin-panel schedule-panel">
              <div className="twin-panel-head" style={{ padding: 0, border: "none", marginBottom: 4 }}>
                <h3>Scheduled research</h3>
                <span className="twin-panel-count">next: tonight</span>
              </div>
              {[
                { name: "PubMed sweep", meta: "CRCI + NfL biomarkers · 2026", when: "tonight" },
                { name: "Model retrain", meta: "incorporates last 7d biomarkers", when: "6am" },
                { name: "Weekly CRCI report", meta: "Sun · into clinician Core", when: "Sun 9am" },
              ].map((s, i) => (
                <div key={i} className="sched-row">
                  <div className="sched-icon">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  </div>
                  <div>
                    <div className="sched-name">{s.name}</div>
                    <div className="sched-meta">{s.meta}</div>
                  </div>
                  <div className="sched-when">{s.when}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

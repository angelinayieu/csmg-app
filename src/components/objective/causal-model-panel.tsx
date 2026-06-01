"use client";

// Full read-out for SpecForge's upgraded problem model. The board card stays
// compact; this panel renders the deeper model only when the user asks for it.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, GitBranch, Network, Trophy, X } from "lucide-react";
import type {
  CausalLink,
  CausalVariable,
  ProblemTreeResult,
} from "@/lib/objective-canvas/specforge/types";

const C = {
  ink: "rgba(15,23,42,0.92)",
  inkSoft: "rgba(15,23,42,0.66)",
  inkMuted: "rgba(15,23,42,0.48)",
  rule: "rgba(15,23,42,0.09)",
  bg: "#fafafa",
  paper: "#ffffff",
  accent: "#EE6B6E",
  accentSoft: "rgba(238,107,110,0.10)",
  blue: "#5A8DEE",
  green: "#23B197",
};
const FONT =
  'Pretendard, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

interface Props {
  model: ProblemTreeResult;
  title: string;
  onClose: () => void;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function topLeverage(model: ProblemTreeResult) {
  return [...(model.leverage_points ?? [])].sort(
    (a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999),
  );
}

function nodePosition(index: number, total: number) {
  const cx = 430;
  const cy = 250;
  const rx = 292;
  const ry = 172;
  const angle = -Math.PI / 2 + (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    x: cx + Math.cos(angle) * rx,
    y: cy + Math.sin(angle) * ry,
  };
}

function variableLabel(v: CausalVariable): string {
  return clean(v.name) || clean(v.id) || "Variable";
}

function Diagram({
  variables,
  links,
  selectedId,
  onSelect,
}: {
  variables: CausalVariable[];
  links: CausalLink[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const shownVars = variables.slice(0, 12);
  const ids = new Set(shownVars.map((v) => v.id));
  const positions = new Map(
    shownVars.map((v, i) => [v.id, nodePosition(i, shownVars.length)]),
  );
  const shownLinks = links
    .filter((l) => ids.has(l.source_id) && ids.has(l.target_id))
    .slice(0, 18);

  return (
    <svg
      viewBox="0 0 860 500"
      role="img"
      aria-label="Causal loop diagram"
      style={{
        width: "100%",
        aspectRatio: "1.72 / 1",
        borderRadius: 8,
        background:
          "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,1) 100%)",
        border: `1px solid ${C.rule}`,
      }}
    >
      <defs>
        <marker
          id="cld-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(15,23,42,0.38)" />
        </marker>
      </defs>
      {shownLinks.map((link, i) => {
        const from = positions.get(link.source_id);
        const to = positions.get(link.target_id);
        if (!from || !to) return null;
        const sign = link.polarity === "negative" ? "-" : link.polarity === "mixed" ? "+/-" : "+";
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        return (
          <g key={`${link.source_id}-${link.target_id}-${i}`}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgba(15,23,42,0.28)"
              strokeWidth={link.strength === "high" ? 1.8 : 1.2}
              markerEnd="url(#cld-arrow)"
            />
            <circle cx={mx} cy={my} r="10" fill="white" stroke="rgba(15,23,42,0.12)" />
            <text
              x={mx}
              y={my + 3.5}
              textAnchor="middle"
              fontFamily={FONT}
              fontSize="10"
              fontWeight="700"
              fill={link.polarity === "negative" ? C.accent : C.green}
            >
              {sign}
            </text>
          </g>
        );
      })}
      {shownVars.map((v, i) => {
        const p = positions.get(v.id) ?? nodePosition(i, shownVars.length);
        const selected = selectedId === v.id;
        const label = variableLabel(v);
        return (
          <g
            key={v.id || i}
            onClick={() => onSelect(v.id)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={selected ? 39 : 34}
              fill={selected ? C.accentSoft : "white"}
              stroke={selected ? C.accent : "rgba(15,23,42,0.14)"}
              strokeWidth={selected ? 2 : 1}
            />
            <text
              x={p.x}
              y={p.y - 3}
              textAnchor="middle"
              fontFamily={FONT}
              fontSize="10.5"
              fontWeight="720"
              fill={C.ink}
            >
              {label.length > 18 ? `${label.slice(0, 17)}...` : label}
            </text>
            <text
              x={p.x}
              y={p.y + 13}
              textAnchor="middle"
              fontFamily={FONT}
              fontSize="9.5"
              fontWeight="600"
              fill={C.inkMuted}
            >
              {clean(v.category).slice(0, 16)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        border: `1px solid ${C.rule}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: C.paper,
      }}
    >
      <div style={{ color: C.inkMuted, fontSize: 11.5, fontWeight: 650 }}>{label}</div>
      <div style={{ color: C.ink, fontSize: 18, fontWeight: 760, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: C.ink,
          fontSize: 13,
          fontWeight: 760,
          marginBottom: 10,
        }}
      >
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  const cleanItems = items.map(clean).filter(Boolean);
  if (!cleanItems.length) return null;
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {cleanItems.map((item, i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${C.rule}`,
            borderRadius: 8,
            padding: "9px 11px",
            background: C.paper,
            color: C.inkSoft,
            fontSize: 13.5,
            lineHeight: 1.45,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function CausalModelPanel({ model, title, onClose }: Props) {
  const variables = useMemo(() => model.variables ?? [], [model.variables]);
  const firstVariable = variables[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(firstVariable);
  const selected = useMemo(
    () => variables.find((v) => v.id === selectedId) ?? variables[0],
    [selectedId, variables],
  );
  const loops = model.feedback_loops ?? [];
  const reinforcing = loops.filter((loop) => loop.kind === "reinforcing").length;
  const balancing = loops.filter((loop) => loop.kind === "balancing").length;
  const ranked = topLeverage(model);
  const root = model.root_constraint_tournament?.selected_root_constraint;
  const need = model.first_principles_need?.selected;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: C.bg, fontFamily: FONT, color: C.ink }}
    >
      <div
        className="sticky top-0 z-10"
        style={{
          background: "rgba(250,250,250,0.92)",
          borderBottom: `1px solid ${C.rule}`,
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          className="mx-auto flex items-center gap-2 px-6 py-3"
          style={{ maxWidth: 1120 }}
        >
          <Network className="h-4 w-4" color={C.accent} strokeWidth={2.4} />
          <span style={{ fontSize: 12.5, fontWeight: 760, color: C.accent }}>
            Causal Model
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-full"
            style={{ border: `1px solid ${C.rule}`, color: C.inkSoft, padding: 7 }}
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <main className="mx-auto px-6 pb-20 pt-8" style={{ maxWidth: 1120 }}>
        <div style={{ maxWidth: 860 }}>
          <h1 style={{ fontSize: 28, fontWeight: 780, letterSpacing: "-0.01em" }}>
            {root || title}
          </h1>
          <p style={{ marginTop: 10, color: C.inkSoft, fontSize: 15.5, lineHeight: 1.55 }}>
            {need || model.phenomenon?.phenomenon_statement || title}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: 9,
            marginTop: 22,
          }}
        >
          <Metric label="Variables" value={variables.length} />
          <Metric label="Links" value={(model.causal_links ?? []).length} />
          <Metric label="Loops" value={`${reinforcing}R/${balancing}B`} />
          <Metric label="Contradictions" value={(model.contradictions ?? []).length} />
          <Metric label="Leverage" value={(model.leverage_points ?? []).length} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            gap: 18,
            marginTop: 18,
            alignItems: "start",
          }}
        >
          <Diagram
            variables={variables}
            links={model.causal_links ?? []}
            selectedId={selected?.id ?? ""}
            onSelect={setSelectedId}
          />
          <aside
            style={{
              border: `1px solid ${C.rule}`,
              borderRadius: 8,
              padding: 14,
              background: C.paper,
              minHeight: 280,
            }}
          >
            <div style={{ fontSize: 12, color: C.inkMuted, fontWeight: 700 }}>
              Selected variable
            </div>
            <div style={{ marginTop: 7, fontSize: 18, fontWeight: 760 }}>
              {selected ? variableLabel(selected) : "No variable"}
            </div>
            {selected?.category && (
              <div style={{ marginTop: 6, color: C.accent, fontSize: 12, fontWeight: 700 }}>
                {selected.category}
              </div>
            )}
            <p style={{ marginTop: 12, color: C.inkSoft, fontSize: 13.5, lineHeight: 1.5 }}>
              {selected?.definition || selected?.current_state || "Select a node to inspect it."}
            </p>
            {selected?.current_state && (
              <p style={{ marginTop: 10, color: C.inkMuted, fontSize: 13, lineHeight: 1.45 }}>
                {selected.current_state}
              </p>
            )}
          </aside>
        </div>

        <Section title="Root Constraint Tournament" icon={<Trophy className="h-4 w-4" />}>
          <div style={{ display: "grid", gap: 8 }}>
            {(model.root_constraint_tournament?.candidates ?? []).slice(0, 5).map((c, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "42px minmax(0, 1fr) 72px",
                  gap: 10,
                  alignItems: "center",
                  border: `1px solid ${i === 0 ? "rgba(238,107,110,0.28)" : C.rule}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: i === 0 ? C.accentSoft : C.paper,
                }}
              >
                <strong style={{ color: C.inkMuted, fontSize: 12 }}>#{i + 1}</strong>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{c.constraint}</div>
                  <div style={{ marginTop: 3, color: C.inkMuted, fontSize: 12.5 }}>
                    {c.why}
                  </div>
                </div>
                <div style={{ textAlign: "right", color: C.accent, fontWeight: 760 }}>
                  {Math.round(Number(c.score) || 0)}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Feedback Loops" icon={<GitBranch className="h-4 w-4" />}>
          <Bullets
            items={loops
              .slice(0, 6)
              .map((loop) => `${loop.kind.toUpperCase()}: ${loop.name} - ${loop.effect_on_problem}`)}
          />
        </Section>

        <Section title="Contradictions" icon={<AlertTriangle className="h-4 w-4" />}>
          <Bullets
            items={(model.contradictions ?? []).map(
              (c) => `${c.tension} - ${c.resolution_principle}`,
            )}
          />
        </Section>

        <Section title="Leverage Points" icon={<Network className="h-4 w-4" />}>
          <Bullets
            items={ranked
              .slice(0, 6)
              .map(
                (p) =>
                  `#${p.rank}: ${p.name} - impact: ${p.downstream_impact}; buildability: ${p.buildability}`,
              )}
          />
        </Section>

        <Section title="Solution Constraints" icon={<Network className="h-4 w-4" />}>
          <Bullets items={model.solution_constraints ?? []} />
        </Section>
      </main>
    </div>
  );
}

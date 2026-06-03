"use client";

// Preflight — redesign of the Prompt Sharpening flashcard. Reframes the
// messy 10-cell ambiguity heatmap into a calm "generator list": each
// dimension produces ONE specific artifact and accepts context you feed it
// (papers, images). Severity → sort order (not a visual). 3 directions,
// mock data. Public route. SAFE TO DELETE. Promotes into
// shapes/prompt-sharpening-card-shape.tsx once a direction is picked.

import { useState } from "react";
import {
  Sparkles,
  Plus,
  Check,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── palette ──
const INK = "#0F172A";
const SLATE = "#334155";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const HAIR = "rgba(15,23,42,0.07)";
const ACCENT = "#2563EB"; // SHARPEN_COLOR
const GREEN = "#16A34A";

type State = "gap" | "drafted" | "grounded";
type Severity = "high" | "medium" | "low";
interface Dim {
  key: string;
  name: string;
  artifact: string;
  severity: Severity;
  state: State;
  fed?: string[]; // grounded → the sources fed in
}

const OBJECTIVE = "linkedin coffee chat matching app personalized";
const SHARPENED =
  "Design a personalized matching app that pairs LinkedIn users for high-signal coffee chats based on goals, not just titles.";

// Ranked by severity (high → low); top 3 surface by default.
const DIMS: Dim[] = [
  { key: "target_user", name: "Target user", artifact: "persona", severity: "high", state: "gap" },
  { key: "mechanism", name: "Mechanism", artifact: "matching logic", severity: "high", state: "drafted" },
  { key: "problem", name: "Problem", artifact: "problem map", severity: "high", state: "grounded", fed: ["networking-friction.pdf"] },
  { key: "outcome", name: "Outcome", artifact: "success metric", severity: "high", state: "gap" },
  { key: "scope", name: "Scope", artifact: "scope frame", severity: "medium", state: "drafted" },
  { key: "output_format", name: "Output format", artifact: "deliverable spec", severity: "medium", state: "gap" },
  { key: "source_context", name: "Source / context", artifact: "evidence base", severity: "low", state: "grounded", fed: ["2 sources"] },
  { key: "intent", name: "Intent", artifact: "intent statement", severity: "low", state: "drafted" },
  { key: "constraint", name: "Constraint", artifact: "constraint set", severity: "low", state: "gap" },
  { key: "routing", name: "Routing", artifact: "next steps", severity: "low", state: "gap" },
];

const SEV_OPACITY: Record<Severity, number> = { high: 1, medium: 0.4, low: 0.18 };

// ── shared atoms ──

function StatePill({ state }: { state: State }) {
  if (state === "grounded")
    return (
      <span style={pill(`${GREEN}14`, GREEN)}>
        <Check style={{ width: 11, height: 11 }} strokeWidth={3} />
        Grounded
      </span>
    );
  if (state === "drafted")
    return (
      <span style={pill(`${ACCENT}12`, ACCENT)}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: ACCENT, opacity: 0.7 }} />
        Drafted
      </span>
    );
  return <span style={pill("rgba(15,23,42,0.045)", FAINT)}>Gap</span>;
}
function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2.5px 8px",
    borderRadius: 999,
    background: bg,
    color,
    fontSize: 10.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

function CardShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: 372,
        borderRadius: 20,
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.99), rgba(246,250,255,0.97))",
        border: `1px solid ${ACCENT}26`,
        boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 22px 48px -20px ${ACCENT}40, 0 8px 22px -12px rgba(11,18,40,0.12)`,
        padding: "15px 16px 13px",
        fontFamily:
          '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Sparkles style={{ width: 13, height: 13, color: ACCENT }} strokeWidth={2.2} />
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em", color: ACCENT }}>
          Sharpened
        </span>
        {footer}
      </div>
      <div style={{ marginTop: 9, fontSize: 16, fontWeight: 700, lineHeight: 1.16, color: INK }}>
        Personalized coffee-chat matching
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 450, lineHeight: 1.42, color: SLATE }}>
        {SHARPENED}
      </div>
      <div style={{ height: 1, background: HAIR, margin: "12px 0 10px" }} />
      {children}
    </div>
  );
}

function useExpand() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

function MoreToggle({ open, setOpen, n }: { open: boolean; setOpen: (b: boolean) => void; n: number }) {
  return (
    <button
      onClick={() => setOpen(!open)}
      style={{
        marginTop: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: 11.5,
        fontWeight: 600,
        color: MUTED,
        padding: "4px 2px",
      }}
    >
      {open ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
      {open ? "Show less" : `${n} more dimensions`}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: FAINT,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

// ── Variant A · Ledger (calmest) ──
// Single-column rows, hairline dividers, left severity tick (opacity),
// name → artifact, right state pill. Hover reveals a ⊕ feed; grounded
// rows show their fed source.
function LedgerCard() {
  const { open, setOpen } = useExpand();
  const shown = open ? DIMS : DIMS.slice(0, 3);
  return (
    <CardShell>
      <SectionLabel>Worth grounding</SectionLabel>
      <div>
        {shown.map((d, i) => (
          <div
            key={d.key}
            className="sc-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 6px",
              borderTop: i === 0 ? "none" : `1px solid ${HAIR}`,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 2.5, alignSelf: "stretch", borderRadius: 2, background: ACCENT, opacity: SEV_OPACITY[d.severity] }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              <span style={{ fontSize: 13, fontWeight: 550, color: INK }}>{d.name}</span>
              <span style={{ fontSize: 11.5, fontWeight: 400, color: FAINT }}>{" → "}{d.artifact}</span>
            </span>
            {d.state === "grounded" && d.fed ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: MUTED, maxWidth: 130, overflow: "hidden" }}>
                <FileText style={{ width: 11, height: 11, color: FAINT, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.fed[0]}</span>
              </span>
            ) : (
              <span className="sc-feed" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: MUTED, opacity: 0 }}>
                <Plus style={{ width: 12, height: 12 }} strokeWidth={2.4} /> feed
              </span>
            )}
            <StatePill state={d.state} />
          </div>
        ))}
      </div>
      <MoreToggle open={open} setOpen={setOpen} n={DIMS.length - 3} />
    </CardShell>
  );
}

// ── Variant B · Progress (most "filling up") ──
// Rows as A + a thin baseline that fills by state, and a header
// "N / 10 grounded" with a slim overall bar.
function ProgressCard() {
  const { open, setOpen } = useExpand();
  const shown = open ? DIMS : DIMS.slice(0, 3);
  const grounded = DIMS.filter((d) => d.state === "grounded").length;
  const fillFor = (s: State) => (s === "grounded" ? 1 : s === "drafted" ? 0.4 : 0);
  return (
    <CardShell
      footer={
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 54, height: 3, borderRadius: 999, background: "rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <span style={{ display: "block", width: `${(grounded / DIMS.length) * 100}%`, height: "100%", background: GREEN }} />
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>{grounded}/{DIMS.length} grounded</span>
        </span>
      }
    >
      <SectionLabel>Worth grounding</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {shown.map((d) => (
          <div key={d.key} className="sc-row" style={{ padding: "8px 6px 9px", borderRadius: 8, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                <span style={{ fontSize: 13, fontWeight: 550, color: INK }}>{d.name}</span>
                <span style={{ fontSize: 11.5, fontWeight: 400, color: FAINT }}>{" → "}{d.artifact}</span>
              </span>
              {d.state === "grounded" && d.fed ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: MUTED }}>
                  <FileText style={{ width: 11, height: 11, color: FAINT }} />
                  {d.fed[0]}
                </span>
              ) : (
                <span className="sc-feed" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: MUTED, opacity: 0 }}>
                  <Plus style={{ width: 12, height: 12 }} strokeWidth={2.4} /> feed
                </span>
              )}
              <StatePill state={d.state} />
            </div>
            <div style={{ marginTop: 7, height: 2, borderRadius: 999, background: "rgba(15,23,42,0.06)", overflow: "hidden" }}>
              <span style={{ display: "block", width: `${fillFor(d.state) * 100}%`, height: "100%", background: d.state === "grounded" ? GREEN : ACCENT, opacity: d.state === "drafted" ? 0.7 : 1 }} />
            </div>
          </div>
        ))}
      </div>
      <MoreToggle open={open} setOpen={setOpen} n={DIMS.length - 3} />
    </CardShell>
  );
}

// ── Variant C · Drop tiles (most literal "feed → output") ──
// Each dimension is a tile: left = name + artifact; right = an explicit
// drop zone (dashed when gap → "drop a paper/image", filled chip when
// grounded). Boldest, most obviously feedable.
function DropTilesCard() {
  const { open, setOpen } = useExpand();
  const shown = open ? DIMS : DIMS.slice(0, 3);
  return (
    <CardShell>
      <SectionLabel>Feed context → generate</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {shown.map((d) => (
          <div
            key={d.key}
            className="sc-tile"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              borderRadius: 12,
              border: `1px solid ${HAIR}`,
              background: "rgba(255,255,255,0.6)",
              cursor: "pointer",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: ACCENT, opacity: SEV_OPACITY[d.severity], flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: INK }}>{d.name}</span>
              <span style={{ display: "block", fontSize: 10.5, color: FAINT }}>produces a {d.artifact}</span>
            </span>
            {d.state === "grounded" && d.fed ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px", borderRadius: 9, background: `${GREEN}10`, border: `1px solid ${GREEN}26`, color: GREEN, fontSize: 10.5, fontWeight: 600 }}>
                <FileText style={{ width: 11, height: 11 }} />
                {d.fed[0]}
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 11px",
                  borderRadius: 9,
                  border: `1.5px dashed ${d.state === "drafted" ? `${ACCENT}55` : "rgba(15,23,42,0.16)"}`,
                  color: d.state === "drafted" ? ACCENT : FAINT,
                  fontSize: 10.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                <Plus style={{ width: 12, height: 12 }} strokeWidth={2.4} />
                {d.state === "drafted" ? "ground it" : "drop paper / image"}
              </span>
            )}
          </div>
        ))}
      </div>
      <MoreToggle open={open} setOpen={setOpen} n={DIMS.length - 3} />
    </CardShell>
  );
}

// ── objective card (for context) ──
function ObjectiveCard() {
  return (
    <div
      style={{
        width: 372,
        borderRadius: 20,
        background: "#fff",
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 14px 36px -18px rgba(11,18,40,0.22)",
        padding: "16px 18px 14px",
        fontFamily: '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: FAINT }}>
        Objective
      </div>
      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 700, lineHeight: 1.2, color: INK }}>{OBJECTIVE}</div>
      <div style={{ marginTop: 26, fontSize: 11.5, color: FAINT }}>Press to open ↗</div>
    </div>
  );
}

const VARIANTS: Array<{ name: string; intent: string; Comp: () => React.ReactElement }> = [
  {
    name: "A · Ledger",
    intent:
      "Calmest. Single column, hairline rows, severity as a faint left tick, name → artifact, state pill. Hover a row to feed it. Recommended default.",
    Comp: LedgerCard,
  },
  {
    name: "B · Progress",
    intent:
      "Most alive. Same rows + a thin baseline that fills by state, and a header 'N/10 grounded' bar — the card visibly fills as you ground dimensions.",
    Comp: ProgressCard,
  },
  {
    name: "C · Drop tiles",
    intent:
      "Boldest / most literal. Each dimension is a tile with an explicit drop zone (dashed 'drop a paper/image' → filled artifact chip when grounded).",
    Comp: DropTilesCard,
  },
];

export default function SharpeningCardPreviewPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FAFAFB",
        backgroundImage: "radial-gradient(circle, rgba(15,23,42,0.06) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
        padding: "44px 32px 80px",
      }}
    >
      <style>{`
        .sc-row:hover, .sc-tile:hover { background: rgba(37,99,235,0.045) !important; }
        .sc-row:hover .sc-feed { opacity: 1 !important; }
      `}</style>
      <div style={{ maxWidth: 1240, margin: "0 auto", fontFamily: '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: FAINT }}>
          Preflight · Sharpening card redesign (mock)
        </div>
        <h1 style={{ margin: "6px 0 4px", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: INK }}>
          Generator list — feed context, get one artifact per dimension
        </h1>
        <p style={{ margin: 0, maxWidth: 720, fontSize: 13.5, fontWeight: 400, lineHeight: 1.5, color: MUTED }}>
          The 10-cell heatmap becomes a calm, ranked list. Severity → sort order. Each row produces one specific
          artifact and accepts files you feed it. Click a row to fork that artifact onto the board. Three directions
          below — each shows the three states (Gap · Drafted · Grounded) in its top rows.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 40, marginTop: 36, alignItems: "flex-start" }}>
          {VARIANTS.map(({ name, intent, Comp }) => (
            <div key={name} style={{ width: 372 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{name}</div>
              <p style={{ margin: "3px 0 16px", fontSize: 12, fontWeight: 400, lineHeight: 1.45, color: MUTED, minHeight: 52 }}>
                {intent}
              </p>
              {/* in context: objective → connector → card */}
              <ObjectiveCard />
              <svg width="372" height="40" style={{ display: "block" }} aria-hidden>
                <path d="M 186 2 C 186 18, 186 22, 186 38" fill="none" stroke="#C3CAD7" strokeWidth={1.75} />
                <circle cx="186" cy="2" r="3" fill="#fff" stroke="#C3CAD7" strokeWidth={1.5} />
                <circle cx="186" cy="38" r="3" fill="#fff" stroke="#C3CAD7" strokeWidth={1.5} />
              </svg>
              <Comp />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

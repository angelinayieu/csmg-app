"use client";

// Per-card (+) action menu — appears on hover at the top-right corner
// of any KG-node card. Three actions:
//   • Connect → enters global pick-mode; user clicks another card to
//     pick the target → opens ProposeBridgeModal → POSTs to
//     /api/edges/bridge.
//   • Decompose (depth) → POSTs to /api/entities/[id]/deepen?depth=...
//     for light/medium/deep/first_principles. Reuses the existing
//     route's recursion path.
//   • Add related → POSTs to /api/entities/[id]/related?action=suggest,
//     shows suggestions inline, user picks → POSTs ?action=accept.
//
// All three reuse existing endpoints + components (ProposeBridgeModal,
// the deepen pipeline, the entity sanitize/insert helpers). No
// parallel subsystems.

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Loader2,
  Sparkles,
  Link as LinkIcon,
  Network,
  Check,
  X,
  ChevronRight,
  FlaskConical,
} from "lucide-react";
import { useCardConnectMode } from "./card-connect-mode-context";
import { ProposeBridgeModal, type BridgeType, type CouplingStrength, type CouplingDirection } from "./propose-bridge-modal";
import { cn } from "@/lib/utils";

type DeepenDepth = "light" | "medium" | "deep" | "first_principles";

interface DepthOption {
  value: DeepenDepth;
  label: string;
  hint: string;
}

const DEPTH_OPTIONS: DepthOption[] = [
  { value: "light", label: "Light", hint: "1 level · 3-5 children" },
  { value: "medium", label: "Medium", hint: "2 levels deep" },
  { value: "deep", label: "Deep", hint: "3 levels deep" },
  {
    value: "first_principles",
    label: "First principles",
    hint: "Auto-recurse to atoms (capped)",
  },
];

interface RelatedSuggestion {
  entity_id: string;
  name: string;
  description: string;
  relationship_type: string;
  rationale: string;
  importance?: string;
  entity_category?: string;
  confidence?: number;
}

interface ResearchQuestionSuggestion {
  question: string;
  rationale: string;
  search_hint: string;
  priority: "high" | "medium" | "low";
}

type ProspectStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; edgesProposed: number; pairsExamined: number }
  | { kind: "skipped"; reason: string };

type MenuPhase =
  | { kind: "closed" }
  | { kind: "root" }
  | { kind: "decompose-depths" }
  | { kind: "decompose-running"; depth: DeepenDepth }
  | {
      kind: "decompose-done";
      depth: DeepenDepth;
      created: number;
      reached: number;
      budgetExhausted: boolean;
      prospect: ProspectStatus;
    }
  | { kind: "decompose-error"; message: string }
  | { kind: "related-suggesting" }
  | { kind: "related-picking"; suggestions: RelatedSuggestion[]; selected: Set<string> }
  | { kind: "related-accepting" }
  | { kind: "related-done"; created: number }
  | { kind: "related-error"; message: string }
  | { kind: "research-suggesting" }
  | {
      kind: "research-picking";
      suggestions: ResearchQuestionSuggestion[];
      selected: Set<string>;
      scopedPrompt: string;
      spaceId: string;
    }
  | { kind: "research-kicking-off" }
  | { kind: "research-started"; runId: string | null; questionCount: number }
  | { kind: "research-error"; message: string };

interface CardActionMenuProps {
  entityId: string;          // entity UUID
  entityName: string;
  isHero: boolean;
  // Optional: number of subunits already known. We surface a count
  // hint in the Decompose menu when > 0.
  subunitCount?: number;
}

export function CardActionMenu({
  entityId,
  entityName,
  isHero,
  subunitCount,
}: CardActionMenuProps) {
  const [phase, setPhase] = useState<MenuPhase>({ kind: "closed" });
  const [bridgeDraft, setBridgeDraft] = useState<{
    source_entity_id: string;
    target_entity_id: string;
    source_entity_name: string;
    target_entity_name: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const connect = useCardConnectMode();

  // Pick-up the target when the user has chosen another card. The
  // context tracks { source, target } pairs; we only react when this
  // card was the source.
  useEffect(() => {
    const pp = connect.pendingPick;
    if (!pp) return;
    if (pp.source.entityId !== entityId) return;
    setBridgeDraft({
      source_entity_id: pp.source.entityId,
      target_entity_id: pp.target.entityId,
      source_entity_name: pp.source.entityName,
      target_entity_name: pp.target.entityName,
    });
    connect.consumePick();
  }, [connect, entityId]);

  // Close menu on outside click.
  useEffect(() => {
    if (phase.kind === "closed") return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setPhase({ kind: "closed" });
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [phase.kind]);

  async function runDeepen(depth: DeepenDepth) {
    setPhase({ kind: "decompose-running", depth });
    try {
      const res = await fetch(
        `/api/entities/${entityId}/deepen?depth=${depth}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        total_entities_created?: number;
        depth_reached?: number;
        budget_exhausted?: boolean;
      };
      const created = data.total_entities_created ?? 0;
      const reached = data.depth_reached ?? 0;
      const budgetExhausted = data.budget_exhausted ?? false;

      // Auto-prospect: when deepen actually created new children, the
      // parent's neighborhood was flagged via invalidateCoverageForNewEntities
      // (server-side, inside the deepen route). Fire prospect-connections
      // so those revisit-flagged pairs + the brand-new children
      // (zero-examination, naturally surfacing via least-examined ranking)
      // get pairwise-checked. Result: children connect to OTHER concepts on
      // the canvas, not just back to their parent. This is the loop-closer
      // for the "are children isolated?" question.
      const spaceId = resolveSpaceIdFromUrl();
      if (created > 0 && spaceId) {
        setPhase({
          kind: "decompose-done",
          depth,
          created,
          reached,
          budgetExhausted,
          prospect: { kind: "running" },
        });
        // Fire-and-forget; the menu re-renders with the prospect result
        // when it returns. SSE will paint any new edges on the canvas.
        void fetch(`/api/pipeline/prospect-connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            entitiesToExamine: 5,
            pairsPerRun: 8,
          }),
        })
          .then(async (pres) => {
            if (!pres.ok) {
              setPhase((p) =>
                p.kind === "decompose-done"
                  ? {
                      ...p,
                      prospect: {
                        kind: "skipped",
                        reason: `prospect HTTP ${pres.status}`,
                      },
                    }
                  : p,
              );
              return;
            }
            const pdata = (await pres.json().catch(() => ({}))) as {
              summary?: { edges_proposed?: number; pairs_examined?: number };
            };
            setPhase((p) =>
              p.kind === "decompose-done"
                ? {
                    ...p,
                    prospect: {
                      kind: "done",
                      edgesProposed: pdata.summary?.edges_proposed ?? 0,
                      pairsExamined: pdata.summary?.pairs_examined ?? 0,
                    },
                  }
                : p,
            );
          })
          .catch((err) => {
            setPhase((p) =>
              p.kind === "decompose-done"
                ? {
                    ...p,
                    prospect: {
                      kind: "skipped",
                      reason: err instanceof Error ? err.message : "prospect failed",
                    },
                  }
                : p,
            );
          });
      } else {
        setPhase({
          kind: "decompose-done",
          depth,
          created,
          reached,
          budgetExhausted,
          prospect: { kind: "idle" },
        });
      }
    } catch (err) {
      setPhase({
        kind: "decompose-error",
        message: err instanceof Error ? err.message : "Decompose failed",
      });
    }
  }

  function resolveSpaceIdFromUrl(): string | null {
    const m = window.location.pathname.match(/\/space\/([^/]+)/);
    return m ? m[1] : null;
  }

  async function runResearchSuggest() {
    setPhase({ kind: "research-suggesting" });
    try {
      const res = await fetch(
        `/api/entities/${entityId}/research-questions`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        suggestions: ResearchQuestionSuggestion[];
        scoped_prompt: string;
        space_id: string;
      };
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      if (suggestions.length === 0) {
        setPhase({
          kind: "research-error",
          message: "No research questions could be generated",
        });
        return;
      }
      // Pre-select the high-priority questions; user can adjust.
      const initial = new Set(
        suggestions
          .filter((s) => s.priority === "high")
          .map((s) => s.question),
      );
      // If nothing high, default to first 2.
      if (initial.size === 0) {
        suggestions.slice(0, 2).forEach((s) => initial.add(s.question));
      }
      setPhase({
        kind: "research-picking",
        suggestions,
        selected: initial,
        scopedPrompt: data.scoped_prompt,
        spaceId: data.space_id,
      });
    } catch (err) {
      setPhase({
        kind: "research-error",
        message: err instanceof Error ? err.message : "Suggest failed",
      });
    }
  }

  async function runResearchKickoff(
    picking: Extract<MenuPhase, { kind: "research-picking" }>,
  ) {
    const picked = picking.suggestions.filter((s) =>
      picking.selected.has(s.question),
    );
    if (picked.length === 0) {
      setPhase({ kind: "closed" });
      return;
    }
    setPhase({ kind: "research-kicking-off" });
    // Hits the existing research-deep route directly. We don't wrap it
    // in our own /research-questions kickoff because that would just
    // duplicate the orchestration this endpoint already owns
    // (pipeline_run creation, structural events, response_id storage).
    try {
      const focusAreas = picked.map((p) => p.question);
      const promptBody =
        picking.scopedPrompt +
        "\n\nFocus areas:\n" +
        focusAreas.map((q, i) => `${i + 1}. ${q}`).join("\n");
      const res = await fetch(`/api/pipeline/research-deep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          spaceId: picking.spaceId,
          prompt: promptBody,
          focusAreas,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { runId?: string };
      setPhase({
        kind: "research-started",
        runId: data.runId ?? null,
        questionCount: picked.length,
      });
    } catch (err) {
      setPhase({
        kind: "research-error",
        message: err instanceof Error ? err.message : "Research kickoff failed",
      });
    }
  }

  async function runRelatedSuggest() {
    setPhase({ kind: "related-suggesting" });
    try {
      const res = await fetch(`/api/entities/${entityId}/related`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { suggestions: RelatedSuggestion[] };
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      if (suggestions.length === 0) {
        setPhase({
          kind: "related-error",
          message: "No related concepts found",
        });
        return;
      }
      setPhase({
        kind: "related-picking",
        suggestions,
        selected: new Set(suggestions.map((s) => s.entity_id)),
      });
    } catch (err) {
      setPhase({
        kind: "related-error",
        message: err instanceof Error ? err.message : "Suggest failed",
      });
    }
  }

  async function runRelatedAccept(picking: Extract<MenuPhase, { kind: "related-picking" }>) {
    const accepted = picking.suggestions.filter((s) =>
      picking.selected.has(s.entity_id),
    );
    if (accepted.length === 0) {
      setPhase({ kind: "closed" });
      return;
    }
    setPhase({ kind: "related-accepting" });
    try {
      const res = await fetch(`/api/entities/${entityId}/related`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", accepted }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        created: Array<{ id: string }>;
      };
      setPhase({
        kind: "related-done",
        created: Array.isArray(data.created) ? data.created.length : 0,
      });
    } catch (err) {
      setPhase({
        kind: "related-error",
        message: err instanceof Error ? err.message : "Accept failed",
      });
    }
  }

  async function confirmBridge(payload: {
    bridge_type: BridgeType;
    coupling_strength: CouplingStrength;
    coupling_direction: CouplingDirection;
    shared_variable_name: string;
    description?: string;
    rationale?: string;
  }) {
    if (!bridgeDraft) return;
    const space_id = resolveSpaceIdFromUrl();
    if (!space_id) throw new Error("Could not resolve space_id from URL");
    const res = await fetch(`/api/edges/bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        space_id,
        source_entity_id: bridgeDraft.source_entity_id,
        target_entity_id: bridgeDraft.target_entity_id,
        relationship_type: `${payload.bridge_type}: ${payload.shared_variable_name}`,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    setBridgeDraft(null);
    setPhase({ kind: "closed" });
  }

  const isOpen = phase.kind !== "closed";
  const buttonBg = isHero ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.98)";
  const buttonBorder = isHero ? "rgba(255,255,255,0.55)" : "rgba(10,30,80,0.18)";
  const buttonColor = isHero ? "#0a1020" : "#0a1020";

  return (
    <div
      ref={containerRef}
      className="card-action-menu"
      style={{
        position: "absolute",
        top: -10,
        right: -10,
        zIndex: 20,
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => isOpen && e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={isOpen ? "Close card actions" : "Card actions"}
        title="Connect, decompose, or find related concepts"
        className="card-action-menu-trigger"
        data-open={isOpen ? "true" : "false"}
        onClick={(e) => {
          e.stopPropagation();
          setPhase((p) =>
            p.kind === "closed" ? { kind: "root" } : { kind: "closed" },
          );
        }}
        style={{
          display: "grid",
          placeItems: "center",
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: buttonBg,
          border: `1px solid ${buttonBorder}`,
          color: buttonColor,
          boxShadow: "0 2px 8px rgba(8,30,80,0.18), 0 0 0 1px rgba(255,255,255,0.5) inset",
          cursor: "pointer",
          transition: "opacity 140ms ease, transform 140ms ease",
          transform: isOpen ? "scale(1.06)" : "scale(1)",
        }}
      >
        <Plus
          style={{
            width: 14,
            height: 14,
            transform: isOpen ? "rotate(45deg)" : "none",
            transition: "transform 180ms ease",
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: 30,
            right: 0,
            minWidth: 240,
            maxWidth: 340,
            background: "white",
            borderRadius: 12,
            border: "1px solid rgba(10,30,80,0.12)",
            boxShadow:
              "0 18px 48px -12px rgba(8,30,80,0.28), 0 4px 16px rgba(0,0,0,0.08)",
            padding: 6,
            color: "#0a1020",
            fontFamily:
              '-apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
          }}
        >
          {phase.kind === "root" && (
            <RootMenu
              onConnect={() => {
                connect.start({ entityId, entityName });
                setPhase({ kind: "closed" });
              }}
              onDecompose={() => setPhase({ kind: "decompose-depths" })}
              onRelated={runRelatedSuggest}
              onResearch={runResearchSuggest}
              connectActiveOnSelf={connect.active?.entityId === entityId}
              subunitCount={subunitCount}
            />
          )}

          {phase.kind === "decompose-depths" && (
            <DepthsMenu
              entityName={entityName}
              onPick={runDeepen}
              onBack={() => setPhase({ kind: "root" })}
              subunitCount={subunitCount}
            />
          )}

          {phase.kind === "decompose-running" && (
            <StatusRow label={`Decomposing (${phase.depth.replace("_", " ")})…`} />
          )}

          {phase.kind === "decompose-done" && (
            <DecomposeDoneRow
              created={phase.created}
              reached={phase.reached}
              budgetExhausted={phase.budgetExhausted}
              prospect={phase.prospect}
              onClose={() => setPhase({ kind: "closed" })}
            />
          )}

          {phase.kind === "decompose-error" && (
            <ErrorRow
              message={phase.message}
              onClose={() => setPhase({ kind: "closed" })}
            />
          )}

          {phase.kind === "related-suggesting" && (
            <StatusRow label="Finding related concepts…" />
          )}

          {phase.kind === "related-picking" && (
            <RelatedPicker
              suggestions={phase.suggestions}
              selected={phase.selected}
              onToggle={(id) => {
                const next = new Set(phase.selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setPhase({ ...phase, selected: next });
              }}
              onCancel={() => setPhase({ kind: "closed" })}
              onAccept={() => runRelatedAccept(phase)}
            />
          )}

          {phase.kind === "related-accepting" && (
            <StatusRow label="Adding related concepts…" />
          )}

          {phase.kind === "related-done" && (
            <DoneRow
              title={`+${phase.created} related`}
              detail="Added with relates-to edges"
              onClose={() => setPhase({ kind: "closed" })}
            />
          )}

          {phase.kind === "related-error" && (
            <ErrorRow
              message={phase.message}
              onClose={() => setPhase({ kind: "closed" })}
            />
          )}

          {phase.kind === "research-suggesting" && (
            <StatusRow label="Generating research questions…" />
          )}

          {phase.kind === "research-picking" && (
            <ResearchPicker
              suggestions={phase.suggestions}
              selected={phase.selected}
              onToggle={(q) => {
                const next = new Set(phase.selected);
                if (next.has(q)) next.delete(q);
                else next.add(q);
                setPhase({ ...phase, selected: next });
              }}
              onCancel={() => setPhase({ kind: "closed" })}
              onKickoff={() => runResearchKickoff(phase)}
            />
          )}

          {phase.kind === "research-kicking-off" && (
            <StatusRow label="Starting deep research…" />
          )}

          {phase.kind === "research-started" && (
            <DoneRow
              title="Research running"
              detail={`${phase.questionCount} question${phase.questionCount === 1 ? "" : "s"} dispatched · ~2-10 min · check the run panel`}
              onClose={() => setPhase({ kind: "closed" })}
            />
          )}

          {phase.kind === "research-error" && (
            <ErrorRow
              message={phase.message}
              onClose={() => setPhase({ kind: "closed" })}
            />
          )}
        </div>
      )}

      {bridgeDraft && (
        <ProposeBridgeModal
          draft={bridgeDraft}
          onCancel={() => setBridgeDraft(null)}
          onConfirm={confirmBridge}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function RootMenu({
  onConnect,
  onDecompose,
  onRelated,
  onResearch,
  connectActiveOnSelf,
  subunitCount,
}: {
  onConnect: () => void;
  onDecompose: () => void;
  onRelated: () => void;
  onResearch: () => void;
  connectActiveOnSelf: boolean;
  subunitCount?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <ActionRow
        icon={LinkIcon}
        label={connectActiveOnSelf ? "Pick a target card…" : "Connect"}
        hint={
          connectActiveOnSelf
            ? "Click any card on canvas"
            : "Bridge to another concept"
        }
        onClick={onConnect}
        disabled={connectActiveOnSelf}
      />
      <ActionRow
        icon={Sparkles}
        label="Decompose"
        hint={
          subunitCount && subunitCount > 0
            ? `${subunitCount} subunits · go deeper`
            : "Break into sub-concepts"
        }
        onClick={onDecompose}
        trailing={<ChevronRight style={{ width: 12, height: 12, opacity: 0.55 }} />}
      />
      <ActionRow
        icon={Network}
        label="Add related"
        hint="Find sibling concepts"
        onClick={onRelated}
      />
      <ActionRow
        icon={FlaskConical}
        label="Research"
        hint="Pick questions · run deep research"
        onClick={onResearch}
      />
    </div>
  );
}

function DepthsMenu({
  entityName,
  onPick,
  onBack,
  subunitCount,
}: {
  entityName: string;
  onPick: (d: DeepenDepth) => void;
  onBack: () => void;
  subunitCount?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: "#556479",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        ← Back
      </button>
      <div
        style={{
          padding: "2px 10px 6px",
          fontSize: 10,
          color: "#556479",
          lineHeight: 1.4,
        }}
      >
        Decompose <strong style={{ color: "#0a1020" }}>{entityName}</strong>
        {subunitCount && subunitCount > 0 ? (
          <span style={{ display: "block", marginTop: 2, opacity: 0.7 }}>
            {subunitCount} subunits already exist · deeper depths recurse into them
          </span>
        ) : null}
      </div>
      {DEPTH_OPTIONS.map((d) => (
        <ActionRow
          key={d.value}
          icon={Sparkles}
          label={d.label}
          hint={d.hint}
          onClick={() => onPick(d.value)}
        />
      ))}
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  hint,
  onClick,
  trailing,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  hint?: string;
  onClick: () => void;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        border: 0,
        background: "transparent",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "rgba(8,30,80,0.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          background: "rgba(8,30,80,0.05)",
          color: "#0a1020",
          flexShrink: 0,
        }}
      >
        <Icon style={{ width: 13, height: 13 }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0a1020" }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: 10.5, color: "#556479", marginTop: 1 }}>
            {hint}
          </div>
        )}
      </span>
      {trailing}
    </button>
  );
}

function StatusRow({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 500,
        color: "#556479",
      }}
    >
      <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
      {label}
    </div>
  );
}

function DoneRow({
  title,
  detail,
  onClose,
}: {
  title: string;
  detail: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(34,197,94,0.12)",
          color: "#15803d",
          flexShrink: 0,
        }}
      >
        <Check style={{ width: 12, height: 12 }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#0a1020" }}>
          {title}
        </div>
        <div style={{ fontSize: 10.5, color: "#556479", marginTop: 1 }}>
          {detail}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: 0,
          color: "#556479",
          cursor: "pointer",
          padding: 2,
        }}
      >
        <X style={{ width: 13, height: 13 }} />
      </button>
    </div>
  );
}

function DecomposeDoneRow({
  created,
  reached,
  budgetExhausted,
  prospect,
  onClose,
}: {
  created: number;
  reached: number;
  budgetExhausted: boolean;
  prospect: ProspectStatus;
  onClose: () => void;
}) {
  const title =
    created === 0 ? "Already decomposed" : `+${created} entities`;
  const detail =
    created === 0
      ? "This concept already had children"
      : `${reached} level${reached === 1 ? "" : "s"} deep${budgetExhausted ? " · budget reached" : ""}`;
  return (
    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "rgba(34,197,94,0.12)",
            color: "#15803d",
            flexShrink: 0,
          }}
        >
          <Check style={{ width: 12, height: 12 }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#0a1020" }}>
            {title}
          </div>
          <div style={{ fontSize: 10.5, color: "#556479", marginTop: 1 }}>
            {detail}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            border: 0,
            color: "#556479",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <X style={{ width: 13, height: 13 }} />
        </button>
      </div>

      {prospect.kind !== "idle" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderTop: "1px dashed rgba(10,30,80,0.10)",
            marginTop: 2,
            fontSize: 10.5,
            color: "#556479",
          }}
        >
          <Network style={{ width: 11, height: 11, flexShrink: 0, opacity: 0.7 }} />
          {prospect.kind === "running" && (
            <>
              <Loader2
                className="animate-spin"
                style={{ width: 11, height: 11, flexShrink: 0 }}
              />
              <span>Looking for cross-canvas links…</span>
            </>
          )}
          {prospect.kind === "done" && (
            <span>
              {prospect.edgesProposed > 0
                ? `+${prospect.edgesProposed} new edge${prospect.edgesProposed === 1 ? "" : "s"} found · ${prospect.pairsExamined} pair${prospect.pairsExamined === 1 ? "" : "s"} checked`
                : `${prospect.pairsExamined} pair${prospect.pairsExamined === 1 ? "" : "s"} checked · no new links`}
            </span>
          )}
          {prospect.kind === "skipped" && (
            <span style={{ opacity: 0.7 }} title={prospect.reason}>
              Cross-link scan skipped
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorRow({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "10px 12px",
      }}
    >
      <div style={{ flex: 1, fontSize: 11.5, color: "#b42318", lineHeight: 1.4 }}>
        {message}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: 0,
          color: "#556479",
          cursor: "pointer",
          padding: 2,
        }}
      >
        <X style={{ width: 13, height: 13 }} />
      </button>
    </div>
  );
}

function ResearchPicker({
  suggestions,
  selected,
  onToggle,
  onCancel,
  onKickoff,
}: {
  suggestions: ResearchQuestionSuggestion[];
  selected: Set<string>;
  onToggle: (question: string) => void;
  onCancel: () => void;
  onKickoff: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 2px" }}>
      <div
        style={{
          padding: "2px 10px 4px",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#556479",
        }}
      >
        Pick questions to research
      </div>
      <div
        style={{
          maxHeight: 320,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {suggestions.map((s) => {
          const isOn = selected.has(s.question);
          const priorityColor =
            s.priority === "high"
              ? "#b42318"
              : s.priority === "low"
                ? "#556479"
                : "#a16207";
          return (
            <button
              key={s.question}
              type="button"
              onClick={() => onToggle(s.question)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 8,
                border: 0,
                background: isOn ? "rgba(8,108,232,0.06)" : "transparent",
                textAlign: "left",
                cursor: "pointer",
                transition: "background 120ms ease",
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${isOn ? "#086ce8" : "rgba(10,30,80,0.25)"}`,
                  background: isOn ? "#086ce8" : "white",
                  color: "white",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {isOn && <Check style={{ width: 10, height: 10 }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0a1020",
                    lineHeight: 1.35,
                  }}
                >
                  {s.question}
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: priorityColor,
                      verticalAlign: "1px",
                    }}
                  >
                    {s.priority}
                  </span>
                </div>
                {s.rationale && (
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "#556479",
                      marginTop: 2,
                      lineHeight: 1.4,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {s.rationale}
                  </div>
                )}
                {s.search_hint && (
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 9.5,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                      color: "#556479",
                      opacity: 0.7,
                    }}
                  >
                    🔎 {s.search_hint}
                  </div>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "4px 8px 2px",
          borderTop: "1px solid rgba(10,30,80,0.08)",
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#556479",
            background: "transparent",
            border: 0,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onKickoff}
          disabled={selected.size === 0}
          className={cn(
            "btn-gradient-outline",
            selected.size === 0 && "cursor-not-allowed opacity-50",
          )}
          style={{
            flex: 1.6,
            padding: "6px 10px",
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: 6,
          }}
        >
          Start research {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
      </div>
    </div>
  );
}

function RelatedPicker({
  suggestions,
  selected,
  onToggle,
  onCancel,
  onAccept,
}: {
  suggestions: RelatedSuggestion[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onAccept: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 2px" }}>
      <div
        style={{
          padding: "2px 10px 4px",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#556479",
        }}
      >
        Pick which to add
      </div>
      <div
        style={{
          maxHeight: 280,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {suggestions.map((s) => {
          const isOn = selected.has(s.entity_id);
          return (
            <button
              key={s.entity_id}
              type="button"
              onClick={() => onToggle(s.entity_id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 8,
                border: 0,
                background: isOn ? "rgba(8,108,232,0.06)" : "transparent",
                textAlign: "left",
                cursor: "pointer",
                transition: "background 120ms ease",
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${isOn ? "#086ce8" : "rgba(10,30,80,0.25)"}`,
                  background: isOn ? "#086ce8" : "white",
                  color: "white",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {isOn && <Check style={{ width: 10, height: 10 }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0a1020",
                  }}
                >
                  {s.name}
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "#556479",
                      background: "rgba(8,30,80,0.06)",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}
                  >
                    {s.relationship_type.replace(/_/g, " ")}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "#556479",
                    marginTop: 2,
                    lineHeight: 1.4,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {s.description}
                </div>
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "4px 8px 2px",
          borderTop: "1px solid rgba(10,30,80,0.08)",
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#556479",
            background: "transparent",
            border: 0,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={selected.size === 0}
          className={cn(
            "btn-gradient-outline",
            selected.size === 0 && "cursor-not-allowed opacity-50",
          )}
          style={{
            flex: 1.4,
            padding: "6px 10px",
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: 6,
          }}
        >
          Add {selected.size > 0 ? selected.size : ""}
        </button>
      </div>
    </div>
  );
}

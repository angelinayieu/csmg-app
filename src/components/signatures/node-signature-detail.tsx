"use client";

// ── NodeSignatureDetail (Batch 8 — signature detail drawer) ────────────
//
// Click a ring → this panel slides in with the full story: every basis
// element, its evidence citation, the resolution plane position, and
// the consequence surface. The drawer's whole job is "reasoning density
// per token" in the UI — a user should be able to understand why the
// system thinks what it thinks about a node without a second query.
//
// Intentionally stateless. Consumer owns open/closed state so it can
// coordinate with URL params, keyboard nav, etc. We just render what
// we're given.

import { motion, AnimatePresence } from "framer-motion";
import type {
  BasisElement,
  BasisEvidence,
  NodeSignature,
  RelationType,
  ResolutionLevel,
} from "@/types/node-signature";
import { NodeSignatureRing } from "./node-signature-ring";
import { cn } from "@/lib/utils";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";

const EASE = [0.22, 1, 0.36, 1] as const;

// Mirrors the materializer's controllability→accent. Kept in sync so
// the ring's visual grammar carries into the drawer.
const CONTROL_LABEL: Record<BasisElement["controllability"], string> = {
  direct: "Actionable lever",
  indirect: "Indirect influence",
  uncontrollable: "Ambient context",
};

const CONTROL_DOT: Record<BasisElement["controllability"], string> = {
  direct: "#10b981",
  indirect: "#f59e0b",
  uncontrollable: "#6b7280",
};

const EVIDENCE_SOURCE_LABEL: Record<BasisEvidence["source"], string> = {
  entity: "Entity row",
  edge: "Incident edge",
  expansion: "Expansion sub-components",
  axis: "Probability axis",
  cross_space_link: "Cross-axis link",
  llm_inference: "LLM inference",
};

// Human labels for the typed relation enum so the drawer doesn't read
// like a schema dump. Matches the 10 members in RelationType.
const RELATION_LABEL: Record<RelationType, string> = {
  causes: "causes",
  enables: "enables",
  inhibits: "inhibits",
  moderates: "moderates",
  mediates: "mediates",
  constrains: "constrains",
  composes: "composes",
  competes: "competes",
  temporally_precedes: "precedes in time",
  relates_to: "relates to",
};

export interface NodeSignatureDetailProps {
  signature: NodeSignature | null;
  /** Optional entity name — when present, headers the drawer. */
  entityName?: string;
  /** Controlled close. Called when the user clicks the backdrop or close button. */
  onClose: () => void;
  /**
   * Phase 1.2 — when provided, `composes_with[]` codes render as
   * clickable chips. The parent resolves the code → sibling
   * NodeSignature (typically by walking entitiesByUuid and matching
   * signature.canonical_code) and swaps the drawer's contents to
   * that signature. When omitted (e.g. on the standalone signature
   * detail page that has no sibling map), chips render as inert
   * mono-text — same visual, just non-interactive.
   */
  onSelectByCode?: (code: string) => void;
  /**
   * Phase 1.3 — resolves consequence_surface target_entity_id values
   * to human names. Without this the drawer falls back to truncated
   * UUIDs, which renders as line noise. Optional so the standalone
   * signature page (no entity map) keeps working.
   */
  resolveEntityName?: (entityId: string) => string | null;
}

export function NodeSignatureDetail({
  signature,
  entityName,
  onClose,
  onSelectByCode,
  resolveEntityName,
}: NodeSignatureDetailProps) {
  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(signature !== null);
  return (
    <AnimatePresence>
      {signature && (
        <>
          {/* Backdrop — click anywhere outside the panel to dismiss.
              Semi-opaque so the underlying canvas/page stays legible. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
          />
          <motion.aside
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className={cn(
              "fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-hidden border-l border-black/10 bg-white shadow-2xl transition-[max-width] duration-200",
              isFullscreen ? "max-w-none" : "max-w-md",
            )}
            role="dialog"
            aria-label={`Signature detail ${signature.canonical_code}`}
          >
            <DrawerHeader
              signature={signature}
              entityName={entityName}
              onClose={onClose}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
            <div className="flex-1 overflow-y-auto">
              <BasisSection basis={signature.basis} evidence={signature.evidence} />
              <ResolutionSection resolution={signature.resolution} />
              <ConsequenceSection
                surface={signature.consequence_surface}
                resolveEntityName={resolveEntityName}
              />
              <CompositionSection
                composes_with={signature.composes_with}
                onSelectByCode={onSelectByCode}
              />
              <MetaSection signature={signature} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Header ─────────────────────────────────────────────────────────────

function DrawerHeader({
  signature,
  entityName,
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: {
  signature: NodeSignature;
  entityName?: string;
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <header className="flex items-start gap-4 border-b border-black/5 bg-gradient-to-b from-gray-50 to-white px-6 py-5">
      <NodeSignatureRing signature={signature} size={72} showCode={false} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          Canonical signature
        </div>
        <div className="font-mono text-[13px] font-semibold text-gray-900">
          {signature.canonical_code}
        </div>
        {entityName && (
          <div className="mt-0.5 truncate text-[13px] text-gray-700">{entityName}</div>
        )}
        <div className="mt-1 text-[10.5px] text-gray-500">
          {signature.rings} ring{signature.rings === 1 ? "" : "s"} · residual{" "}
          {Math.round(signature.residual_uncertainty * 100)}%
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <DrawerFullscreenButton
          isFullscreen={isFullscreen}
          onToggle={onToggleFullscreen}
        />
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-700"
          aria-label="Close signature detail"
          title="Close signature detail"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

// ── Basis section — one row per ring ──────────────────────────────────

function BasisSection({
  basis,
  evidence,
}: {
  basis: BasisElement[];
  evidence: BasisEvidence[];
}) {
  return (
    <section className="border-b border-black/5 px-6 py-4">
      <SectionTitle>Basis · rings (inner → outer)</SectionTitle>
      <ol className="mt-3 flex flex-col gap-2">
        {basis.map((b) => {
          const matchingEvidence = evidence.filter((e) => e.basis_index === b.index);
          return (
            <li
              key={b.index}
              className="rounded-xl border border-black/5 bg-gray-50/60 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 font-mono text-[10px] font-bold text-white">
                    {b.code}
                  </span>
                  <span className="text-[12px] font-medium text-gray-900">{b.label}</span>
                </div>
                <span className="text-[10px] font-mono text-gray-500">#{b.index}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px]">
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 font-medium"
                  style={{ color: CONTROL_DOT[b.controllability] }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: CONTROL_DOT[b.controllability] }}
                  />
                  {CONTROL_LABEL[b.controllability]}
                </span>
                <span className="text-gray-500">
                  resolved {Math.round(b.contribution * 100)}% · conf{" "}
                  {Math.round(b.confidence * 100)}%
                </span>
                {b.source_axis && (
                  <span className="rounded-full bg-black/5 px-1.5 py-0.5 font-medium text-gray-700">
                    {b.source_axis}
                  </span>
                )}
              </div>
              {matchingEvidence.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {matchingEvidence.map((ev, i) => (
                    <li key={i} className="text-[10.5px] text-gray-600">
                      <span className="font-semibold text-gray-700">
                        {EVIDENCE_SOURCE_LABEL[ev.source]}:
                      </span>{" "}
                      {ev.claim}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Resolution section ─────────────────────────────────────────────────

function ResolutionSection({ resolution }: { resolution: ResolutionLevel }) {
  const pinLabel: Record<ResolutionLevel["pinned_because"], string> = {
    budget: "paused on budget",
    saturated: "fully resolved",
    awaiting_evidence: "waiting on evidence",
    user_locked: "locked by user",
  };
  return (
    <section className="border-b border-black/5 px-6 py-4">
      <SectionTitle>Resolution plane</SectionTitle>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <ResolutionCell label="Zoom" value={`${resolution.zoom}/5`} />
        <ResolutionCell label="Horizon" value={resolution.horizon} />
        <ResolutionCell label="Status" value={pinLabel[resolution.pinned_because]} />
      </div>
    </section>
  );
}

function ResolutionCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/5 bg-gray-50/60 px-2 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-400">
        {label}
      </div>
      <div className="mt-0.5 text-[11.5px] font-semibold text-gray-900 capitalize">
        {value}
      </div>
    </div>
  );
}

// ── Consequence surface ────────────────────────────────────────────────

function ConsequenceSection({
  surface,
  resolveEntityName,
}: {
  surface: NodeSignature["consequence_surface"];
  resolveEntityName?: (entityId: string) => string | null;
}) {
  if (!surface || surface.length === 0) {
    return (
      <section className="border-b border-black/5 px-6 py-4">
        <SectionTitle>Consequence surface</SectionTitle>
        <p className="mt-2 text-[11.5px] text-gray-500">
          No downstream outcomes resolved at this zoom level yet.
        </p>
      </section>
    );
  }
  const POL_ACCENT = {
    positive: "#10b981",
    negative: "#ef4444",
    neutral: "#6b7280",
    conditional: "#f59e0b",
  } as const;
  return (
    <section className="border-b border-black/5 px-6 py-4">
      <SectionTitle>Consequence surface</SectionTitle>
      <ul className="mt-3 flex flex-col gap-1.5">
        {surface.map((c) => {
          // Phase 1.3 — prefer resolved entity names; fall back to a
          // short UUID prefix when the resolver is absent or misses.
          // Width budget is tight (drawer is 400px), so truncate with
          // ellipsis rather than wrapping.
          const resolved = resolveEntityName?.(c.target_entity_id) ?? null;
          return (
            <li
              key={c.target_entity_id}
              className="flex items-center justify-between gap-2 rounded-lg border border-black/5 bg-gray-50/60 px-2.5 py-1.5"
              title={resolved ? `${resolved} · ${c.target_entity_id}` : c.target_entity_id}
            >
              <span
                className={`truncate text-[10.5px] ${
                  resolved ? "text-gray-800" : "font-mono text-gray-700"
                }`}
              >
                → {resolved ?? c.target_entity_id.slice(0, 8)}
              </span>
              <span
                className="flex items-center gap-1.5 text-[10.5px] font-semibold"
                style={{ color: POL_ACCENT[c.polarity] }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: POL_ACCENT[c.polarity] }}
                />
                {Math.round(c.probability * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Composition (combination lattice) ─────────────────────────────────
//
// Phase 1.2 — chips become clickable when the parent provides
// `onSelectByCode`. Wrapping the same visual in a <button> means we
// don't have to duplicate styles for the interactive vs. inert state;
// `disabled` strips the cursor + click affordance for the standalone
// case where the parent has no sibling map to resolve into.

function CompositionSection({
  composes_with,
  onSelectByCode,
}: {
  composes_with: string[];
  onSelectByCode?: (code: string) => void;
}) {
  if (!composes_with || composes_with.length === 0) return null;
  const interactive = typeof onSelectByCode === "function";
  return (
    <section className="border-b border-black/5 px-6 py-4">
      <SectionTitle>Composes with</SectionTitle>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {composes_with.map((code) => (
          <button
            key={code}
            type="button"
            disabled={!interactive}
            onClick={interactive ? () => onSelectByCode!(code) : undefined}
            className={`rounded-full bg-black/5 px-2 py-0.5 font-mono text-[10.5px] text-gray-700 transition-colors ${
              interactive
                ? "cursor-pointer hover:bg-black/10 hover:text-gray-900"
                : "cursor-default"
            }`}
            title={
              interactive
                ? `Open sibling signature ${code}`
                : `Combination signature ${code}`
            }
          >
            {code}
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Meta footer ────────────────────────────────────────────────────────

function MetaSection({ signature }: { signature: NodeSignature }) {
  const ts = new Date(signature.materialized_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section className="px-6 py-4">
      <SectionTitle>Provenance</SectionTitle>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10.5px]">
        <dt className="text-gray-500">Materialized</dt>
        <dd className="text-gray-800">{ts}</dd>
        <dt className="text-gray-500">Version</dt>
        <dd className="text-gray-800">v{signature.version}</dd>
        <dt className="text-gray-500">Entity UUID</dt>
        <dd className="truncate font-mono text-gray-800">{signature.entity_id}</dd>
      </dl>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gray-500">
      {children}
    </div>
  );
}

// Export relation label helper so widgets can use it without re-declaring.
export { RELATION_LABEL };

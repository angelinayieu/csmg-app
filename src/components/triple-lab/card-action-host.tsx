"use client";

// Card-action host — page-level controller for the hover actions that
// need cross-card state (Connect: pick a target) or modals (Solve,
// Probe). Per-card actions like Decompose and Add Related don't go
// through here — they're handled inside the card itself.
//
// Architecture:
//   <CardActionHost> owns the modal/panel state machine.
//   Each card calls the hooks it needs: useStartConnect(), useOpenSolve(),
//   useOpenProbe(). The host renders the modal/panel + handles all the
//   API plumbing.
//
// Why a host (not per-card modals): Connect needs to span TWO cards (a
// source + a target), and modals stacked per-card create z-index hell.
// One host = one modal at a time = clean.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Entity } from "@/types";
import {
  ProposeBridgeModal,
  type BridgeType,
  type CouplingStrength,
  type CouplingDirection,
} from "@/components/canvas/propose-bridge-modal";
import { SolveModal } from "./solve-modal";
import { ProbeTrailSidePanel } from "./probe-trail-side-panel";
import { colors } from "./tokens";
import type { ProbeTrail } from "@/lib/pipeline/probe-orchestrator";

// ── Context shape ────────────────────────────────────────────────────
interface CardActionContextValue {
  // Connect mode — when active, every card shows a "Connect to →" hint
  // on hover and clicking a non-source card opens the bridge modal.
  connectSource: Entity | null;
  startConnect: (source: Entity) => void;
  pickConnectTarget: (target: Entity) => void;
  cancelConnect: () => void;

  // Solve modal — single entity context, simple text input
  openSolve: (anchor: Entity) => void;

  // Probe panel — single entity context, slide-out from the right edge
  openProbe: (anchor: Entity) => Promise<void>;
}

const Ctx = createContext<CardActionContextValue | null>(null);

export function useCardActions(): CardActionContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useCardActions must be used inside a <CardActionHost>",
    );
  }
  return v;
}

// ── Host component ───────────────────────────────────────────────────
interface CardActionHostProps {
  spaceId: string;
  children: React.ReactNode;
}

export function CardActionHost({ spaceId, children }: CardActionHostProps) {
  const router = useRouter();

  // ── Connect state machine ──
  const [connectSource, setConnectSource] = useState<Entity | null>(null);
  const [bridgeDraft, setBridgeDraft] = useState<{
    source_entity_id: string;
    target_entity_id: string;
    source_entity_name: string;
    target_entity_name: string;
  } | null>(null);

  const startConnect = useCallback((source: Entity) => {
    setConnectSource(source);
    setBridgeDraft(null);
  }, []);
  const pickConnectTarget = useCallback(
    (target: Entity) => {
      if (!connectSource) return;
      if (target.id === connectSource.id) return;
      setBridgeDraft({
        source_entity_id: connectSource.id,
        target_entity_id: target.id,
        source_entity_name: connectSource.name,
        target_entity_name: target.name,
      });
    },
    [connectSource],
  );
  const cancelConnect = useCallback(() => {
    setConnectSource(null);
    setBridgeDraft(null);
  }, []);

  // ── Bridge modal confirm ──
  const confirmBridge = useCallback(
    async (payload: {
      bridge_type: BridgeType;
      coupling_strength: CouplingStrength;
      coupling_direction: CouplingDirection;
      shared_variable_name: string;
      description?: string;
      rationale?: string;
    }) => {
      if (!bridgeDraft) return;
      // Bridge endpoint expects relationship_type as a string; we map
      // the bridge_type + coupling info into a sensible relation_type.
      // Identity → "is-equivalent-to", Influence → "causes",
      // Structural → "shares-mechanism-with" (custom but stored as-is).
      const relationType =
        payload.bridge_type === "identity"
          ? "is_equivalent_to"
          : payload.bridge_type === "influence"
          ? "causes"
          : "shares_mechanism_with";
      try {
        await fetch("/api/edges/bridge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            space_id: spaceId,
            source_entity_id: bridgeDraft.source_entity_id,
            target_entity_id: bridgeDraft.target_entity_id,
            relationship_type: relationType,
          }),
        });
        router.refresh();
      } catch (err) {
        console.warn("[card-action-host] bridge create failed:", err);
      } finally {
        setConnectSource(null);
        setBridgeDraft(null);
      }
    },
    [bridgeDraft, spaceId, router],
  );

  // ── Solve modal state ──
  const [solveAnchor, setSolveAnchor] = useState<Entity | null>(null);
  const openSolve = useCallback((anchor: Entity) => {
    setSolveAnchor(anchor);
  }, []);
  const closeSolve = useCallback(() => setSolveAnchor(null), []);

  // ── Probe panel state ──
  // The actual orchestrator call happens here so the spinner is owned
  // by the host (avoids one-shot-per-card hooks repeating the same
  // request when the user clicks Probe multiple times).
  const [probeTrail, setProbeTrail] = useState<ProbeTrail | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const openProbe = useCallback(
    async (anchor: Entity) => {
      setProbeLoading(true);
      setProbeError(null);
      try {
        const res = await fetch("/api/canvas/probe-rabbit-hole", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entity_id: anchor.id,
            question: `What's the mechanism behind ${anchor.name}?`,
          }),
        });
        if (!res.ok) {
          setProbeError(`Probe failed (HTTP ${res.status})`);
          return;
        }
        const trail = (await res.json()) as ProbeTrail;
        setProbeTrail(trail);
      } catch (err) {
        setProbeError(
          err instanceof Error ? err.message : "Probe request threw",
        );
      } finally {
        setProbeLoading(false);
      }
    },
    [],
  );
  const closeProbe = useCallback(() => {
    setProbeTrail(null);
    setProbeError(null);
  }, []);

  // ── Memoize context value ──
  const value = useMemo<CardActionContextValue>(
    () => ({
      connectSource,
      startConnect,
      pickConnectTarget,
      cancelConnect,
      openSolve,
      openProbe,
    }),
    [
      connectSource,
      startConnect,
      pickConnectTarget,
      cancelConnect,
      openSolve,
      openProbe,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* ── Connect-mode header banner ─────────────────────────── */}
      {connectSource && !bridgeDraft && (
        <div
          className="pointer-events-auto fixed left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border px-4 py-2 shadow-lg"
          style={{
            background: colors.brand.gradient,
            borderColor: colors.brand.halo,
            boxShadow: `0 8px 22px ${colors.brand.shadowStrong}`,
          }}
        >
          <div className="flex items-center gap-3 text-[11px] font-medium text-white">
            <span>
              Connecting{" "}
              <span className="font-bold">{connectSource.name}</span> · pick a
              target card
            </span>
            <button
              type="button"
              onClick={cancelConnect}
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-white/15"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Bridge modal ─────────────────────────────────────────── */}
      {bridgeDraft && (
        <ProposeBridgeModal
          draft={bridgeDraft}
          onCancel={cancelConnect}
          onConfirm={confirmBridge}
        />
      )}

      {/* ── Solve modal ──────────────────────────────────────────── */}
      {solveAnchor && (
        <SolveModal
          anchor={solveAnchor}
          spaceId={spaceId}
          onClose={closeSolve}
        />
      )}

      {/* ── Probe side panel ─────────────────────────────────────── */}
      {(probeTrail || probeLoading || probeError) && (
        <ProbeTrailSidePanel
          trail={probeTrail}
          loading={probeLoading}
          error={probeError}
          onClose={closeProbe}
        />
      )}
    </Ctx.Provider>
  );
}

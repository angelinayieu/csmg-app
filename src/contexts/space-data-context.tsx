"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { ImprovementGoal, SuggestedObjective } from "@/types/goals";
import type { ShellLevel } from "@/lib/hooks/use-space-chat";
import type {
  Space,
  Entity,
  Edge,
  Cycle,
  Proposition,
  NovelConnection,
  Contradiction,
  Scenario,
  ActionItem,
  Bridge,
  Claim,
} from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceDataProps {
  space: Space;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  propositions: Proposition[];
  novelConnections: NovelConnection[];
  contradictions: Contradiction[];
  scenarios: Scenario[];
  actionItems: ActionItem[];
  claims: Claim[];
  siblingEntities: Entity[];
  siblingEdges: Edge[];
  domainMap: Record<string, { name: string; index: number }>;
  bridges: Bridge[];
  goals: ImprovementGoal[];
  liveCounts: { entities: number; edges: number; cycles: number };
}

export interface SpaceUIState {
  // Goals
  activeGoal: ImprovementGoal | null;
  setActiveGoal: (goal: ImprovementGoal | null) => void;
  goalList: ImprovementGoal[];
  setGoalList: React.Dispatch<React.SetStateAction<ImprovementGoal[]>>;
  childGoals: ImprovementGoal[];

  // Goal setter
  showGoalSetter: boolean;
  setShowGoalSetter: (show: boolean) => void;
  goalPrefill: SuggestedObjective | null;
  setGoalPrefill: (prefill: SuggestedObjective | null) => void;

  // Entity selection (for NodeDetail slide-out)
  selectedEntity: Entity | null;
  setSelectedEntity: (entity: Entity | null) => void;

  // Chat panel
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatExpanded: boolean;
  setChatExpanded: (expanded: boolean) => void;
  chatApiRef: React.MutableRefObject<{
    pushFocus: (level: ShellLevel) => void;
    clearFocus: () => void;
  } | null>;
  handleChatReady: (api: {
    pushFocus: (level: ShellLevel) => void;
    clearFocus: () => void;
  }) => void;

  // Objective review
  objectivesReviewed: boolean;
  setObjectivesReviewed: (reviewed: boolean) => void;
  pendingObjectives: SuggestedObjective[];

  // Strategy approval (gates Digital Twin)
  strategyApproved: boolean;
  setStrategyApproved: (approved: boolean) => void;

  // Router refresh
  refresh: () => void;

  // Bridges live-refresh — lets subscribers (synthesis view) pull fresh
  // cross-space bridges without a full SSR re-fetch. Updates the local
  // `bridges` state without touching the rest of the payload.
  refreshBridges: () => Promise<void>;
  bridgesRefreshing: boolean;

  // Derived
  hasSynthesis: boolean;
  stage: number;
}

export type SpaceContextValue = SpaceDataProps & SpaceUIState;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SpaceDataContext = createContext<SpaceContextValue | null>(null);

export function useSpaceData(): SpaceContextValue {
  const ctx = useContext(SpaceDataContext);
  if (!ctx) {
    throw new Error("useSpaceData must be used within a SpaceDataProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SpaceDataProvider({
  children,
  ...data
}: SpaceDataProps & { children: ReactNode }) {
  const router = useRouter();

  // ── Goals ──
  const [activeGoal, setActiveGoal] = useState<ImprovementGoal | null>(() => {
    const topLevel = data.goals.find(
      (g) => g.status === "active" && !g.parent_goal_id
    );
    if (topLevel) return topLevel;
    return data.goals.find((g) => g.status === "active") ?? null;
  });
  const [goalList, setGoalList] = useState<ImprovementGoal[]>(data.goals);
  const [showGoalSetter, setShowGoalSetter] = useState(false);
  const [goalPrefill, setGoalPrefill] =
    useState<SuggestedObjective | null>(null);

  const childGoals = useMemo(
    () =>
      activeGoal
        ? goalList.filter((g) => g.parent_goal_id === activeGoal.id)
        : [],
    [goalList, activeGoal]
  );

  // Cross-module one-click goal creation (e.g., Intelligence Radar decisions)
  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{ prefill?: SuggestedObjective }>;
      const prefill = custom.detail?.prefill;
      if (!prefill) return;
      setGoalPrefill(prefill);
      setShowGoalSetter(true);
    };
    window.addEventListener(
      "interaxis:create-goal-from-intel",
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        "interaxis:create-goal-from-intel",
        handler as EventListener
      );
    };
  }, []);

  // ── Entity selection ──
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

  // ── Chat ──
  const [chatOpen, setChatOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const chatApiRef = useRef<{
    pushFocus: (level: ShellLevel) => void;
    clearFocus: () => void;
  } | null>(null);
  const handleChatReady = useCallback(
    (api: {
      pushFocus: (level: ShellLevel) => void;
      clearFocus: () => void;
    }) => {
      chatApiRef.current = api;
    },
    []
  );

  // ── Objective review ──
  const [objectivesReviewed, setObjectivesReviewed] = useState(() => {
    if (!data.space.synthesis_data) return true;
    const sd =
      typeof data.space.synthesis_data === "string"
        ? JSON.parse(data.space.synthesis_data)
        : data.space.synthesis_data;
    return sd?.objectives_pending_review !== true;
  });

  useEffect(() => {
    if (!data.space.synthesis_data) {
      setObjectivesReviewed(true);
      return;
    }
    const sd =
      typeof data.space.synthesis_data === "string"
        ? JSON.parse(data.space.synthesis_data)
        : data.space.synthesis_data;
    if (sd?.objectives_pending_review === true) {
      setObjectivesReviewed(false);
    }
  }, [data.space.synthesis_data]);

  const pendingObjectives = useMemo<SuggestedObjective[]>(() => {
    if (objectivesReviewed) return [];
    if (!data.space.synthesis_data) return [];
    const sd =
      typeof data.space.synthesis_data === "string"
        ? JSON.parse(data.space.synthesis_data)
        : data.space.synthesis_data;
    return Array.isArray(sd?.suggested_objectives)
      ? sd.suggested_objectives
      : [];
  }, [data.space.synthesis_data, objectivesReviewed]);

  // ── Strategy approval ──
  // Authoritative source: `spaces.strategy_committed_at` (set by the confirm endpoint).
  // Falls back to `synthesis_data.strategy_approved` / `strategic_recommendation.status`
  // for spaces confirmed before the commit column existed.
  const [strategyApproved, setStrategyApproved] = useState(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const space = data.space as any;
    if (space?.strategy_committed_at) return true;
    if (!space?.synthesis_data) return false;
    const sd =
      typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data;
    if (sd?.strategy_approved === true) return true;
    const status = sd?.strategic_recommendation?.status;
    return status === "confirmed";
  });

  // ── Derived ──
  const hasSynthesis = !!data.space.synthesis_data;
  const stage = useMemo(() => {
    if (data.entities.length === 0) return 1;
    if (!data.space.synthesis_data) return 2;
    return 3;
  }, [data.entities.length, data.space.synthesis_data]);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  // ── Bridges live state ──
  // Seeded from the SSR prop; refreshBridges() re-fetches just the bridges
  // list and updates state in-place. Avoids the full router.refresh() when
  // synthesis only cares about new cross-area connections.
  const [bridges, setBridges] = useState<Bridge[]>(data.bridges);
  useEffect(() => {
    // If the SSR prop changes (e.g. after router.refresh), re-seed state.
    setBridges(data.bridges);
  }, [data.bridges]);
  const [bridgesRefreshing, setBridgesRefreshing] = useState(false);
  const refreshBridges = useCallback(async () => {
    if (bridgesRefreshing) return;
    setBridgesRefreshing(true);
    try {
      const res = await fetch(`/api/spaces/${data.space.id}/bridges`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { bridges: Bridge[] };
      setBridges(body.bridges ?? []);
    } catch (err) {
      console.warn("[refreshBridges] failed:", err);
    } finally {
      setBridgesRefreshing(false);
    }
  }, [bridgesRefreshing, data.space.id]);

  // ── Build context value ──
  const value = useMemo<SpaceContextValue>(
    () => ({
      ...data,
      // Shadow the SSR prop with the live bridges state so subscribers
      // always see the most recently refetched list.
      bridges,
      activeGoal,
      setActiveGoal,
      goalList,
      setGoalList,
      childGoals,
      showGoalSetter,
      setShowGoalSetter,
      goalPrefill,
      setGoalPrefill,
      selectedEntity,
      setSelectedEntity,
      chatOpen,
      setChatOpen,
      chatExpanded,
      setChatExpanded,
      chatApiRef,
      handleChatReady,
      objectivesReviewed,
      setObjectivesReviewed,
      pendingObjectives,
      strategyApproved,
      setStrategyApproved,
      hasSynthesis,
      stage,
      refresh,
      refreshBridges,
      bridgesRefreshing,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      data,
      bridges,
      activeGoal,
      goalList,
      childGoals,
      showGoalSetter,
      goalPrefill,
      selectedEntity,
      chatOpen,
      chatExpanded,
      objectivesReviewed,
      pendingObjectives,
      strategyApproved,
      hasSynthesis,
      stage,
      refreshBridges,
      bridgesRefreshing,
    ]
  );

  return (
    <SpaceDataContext.Provider value={value}>
      {children}
    </SpaceDataContext.Provider>
  );
}

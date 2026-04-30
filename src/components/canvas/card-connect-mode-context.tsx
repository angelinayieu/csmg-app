"use client";

// Per-card "Connect" pick mode — when the user clicks Connect on the
// (+) menu, we enter a global "pick a target" mode. Every other card
// listens to this context, dims itself slightly, and reports its own
// entity id when clicked. The originating menu receives the pick and
// opens ProposeBridgeModal.
//
// Same composition pattern as canvas-reactions-context / canvas-
// hierarchy-context — context lives at the canvas root, shape utils
// read it via a hook.

import { createContext, useCallback, useContext, useState } from "react";

export interface ConnectModeSource {
  entityId: string;     // entity UUID
  entityName: string;
}

export interface ConnectModeContextValue {
  active: ConnectModeSource | null;
  start: (source: ConnectModeSource) => void;
  cancel: () => void;
  pick: (target: { entityId: string; entityName: string }) => void;
  pendingPick: {
    source: ConnectModeSource;
    target: { entityId: string; entityName: string };
  } | null;
  consumePick: () => void;
}

const CardConnectModeContext = createContext<ConnectModeContextValue>({
  active: null,
  start: () => {},
  cancel: () => {},
  pick: () => {},
  pendingPick: null,
  consumePick: () => {},
});

export function useCardConnectMode() {
  return useContext(CardConnectModeContext);
}

export function CardConnectModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<ConnectModeSource | null>(null);
  const [pendingPick, setPendingPick] = useState<
    ConnectModeContextValue["pendingPick"]
  >(null);

  const start = useCallback((source: ConnectModeSource) => {
    setActive(source);
    setPendingPick(null);
  }, []);

  const cancel = useCallback(() => {
    setActive(null);
    setPendingPick(null);
  }, []);

  const pick = useCallback(
    (target: { entityId: string; entityName: string }) => {
      setActive((current) => {
        if (!current) return null;
        if (current.entityId === target.entityId) return current; // no self-link
        setPendingPick({ source: current, target });
        return null;
      });
    },
    [],
  );

  const consumePick = useCallback(() => setPendingPick(null), []);

  return (
    <CardConnectModeContext.Provider
      value={{ active, start, cancel, pick, pendingPick, consumePick }}
    >
      {children}
    </CardConnectModeContext.Provider>
  );
}

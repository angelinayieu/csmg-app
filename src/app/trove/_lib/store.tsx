"use client";

// Trove client store — one bootstrap fetch shared by every tab (Library,
// Folders, Map, Agents) + the mutations that grow the graph. Context-based so
// the layout mounts it once.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Ghost, TroveCollection, TroveEdge, TroveNode } from "./types";

export interface IngestPayload {
  text?: string;
  url?: string;
  image?: { base64: string; mediaType: string };
  ghost?: Ghost & { relatedNodeId?: string; collectionId?: string };
}

export interface IngestOutcome {
  ok: boolean;
  error?: string;
  rootTitle?: string;
  childCount?: number;
  collectionName?: string;
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "err";
}

interface TroveStore {
  loading: boolean;
  error: string | null;
  nodes: TroveNode[];
  collections: TroveCollection[];
  edges: TroveEdge[];
  refresh: () => Promise<void>;
  ingest: (payload: IngestPayload) => Promise<IngestOutcome>;
  syncSpaces: () => Promise<void>;
  organize: () => Promise<void>;
  busy: string | null; // 'sync' | 'organize' | null — global background ops
  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  toasts: Toast[];
  toast: (text: string, tone?: "ok" | "err") => void;
  childrenOf: (parentId: string | null) => TroveCollection[];
  nodesIn: (collectionId: string) => TroveNode[];
  collectionById: (id: string | null) => TroveCollection | undefined;
}

const Ctx = createContext<TroveStore | null>(null);

export function useTrove(): TroveStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTrove outside TroveProvider");
  return ctx;
}

export function TroveProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<TroveNode[]>([]);
  const [collections, setCollections] = useState<TroveCollection[]>([]);
  const [edges, setEdges] = useState<TroveEdge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const toast = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/trove/bootstrap", { cache: "no-store" });
      if (!resp.ok) {
        const j = await resp.json().catch(() => null);
        throw new Error(j?.error ?? `Load failed (${resp.status})`);
      }
      const data = await resp.json();
      setNodes(data.nodes ?? []);
      setCollections(data.collections ?? []);
      setEdges(data.edges ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your trove");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ingest = useCallback(
    async (payload: IngestPayload): Promise<IngestOutcome> => {
      try {
        const resp = await fetch("/api/trove/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) {
          return { ok: false, error: data?.error ?? `Ingest failed (${resp.status})` };
        }
        await refresh();
        return {
          ok: true,
          rootTitle: data?.root?.title,
          childCount: Array.isArray(data?.children) ? data.children.length : 0,
          collectionName: data?.collection?.name,
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Ingest failed" };
      }
    },
    [refresh],
  );

  const syncSpaces = useCallback(async () => {
    setBusy("sync");
    try {
      const resp = await fetch("/api/trove/sync-spaces", { method: "POST" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error ?? "Sync failed");
      await refresh();
      toast(
        data.imported
          ? `Imported ${data.imported} item${data.imported === 1 ? "" : "s"} from your boards`
          : "Already up to date with your boards",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed", "err");
    } finally {
      setBusy(null);
    }
  }, [refresh, toast]);

  const organize = useCallback(async () => {
    setBusy("organize");
    try {
      const resp = await fetch("/api/trove/organize", { method: "POST" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error ?? "Organize failed");
      await refresh();
      toast(
        data.moved
          ? `Filed ${data.moved} item${data.moved === 1 ? "" : "s"} into ${data.folders} folder${data.folders === 1 ? "" : "s"}`
          : (data.message ?? "Everything is already filed"),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Organize failed", "err");
    } finally {
      setBusy(null);
    }
  }, [refresh, toast]);

  const childrenOf = useCallback(
    (parentId: string | null) =>
      collections
        .filter((c) => (c.parent_id ?? null) === parentId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [collections],
  );
  const nodesIn = useCallback(
    (collectionId: string) => nodes.filter((n) => n.collection_id === collectionId),
    [nodes],
  );
  const collectionById = useCallback(
    (id: string | null) => (id ? collections.find((c) => c.id === id) : undefined),
    [collections],
  );

  const value = useMemo<TroveStore>(
    () => ({
      loading,
      error,
      nodes,
      collections,
      edges,
      refresh,
      ingest,
      syncSpaces,
      organize,
      busy,
      composerOpen,
      setComposerOpen,
      searchQuery,
      setSearchQuery,
      toasts,
      toast,
      childrenOf,
      nodesIn,
      collectionById,
    }),
    [
      loading,
      error,
      nodes,
      collections,
      edges,
      refresh,
      ingest,
      syncSpaces,
      organize,
      busy,
      composerOpen,
      searchQuery,
      toasts,
      toast,
      childrenOf,
      nodesIn,
      collectionById,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

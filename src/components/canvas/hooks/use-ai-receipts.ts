"use client";

// Phase 44 — AI Receipts.
//
// A per-space log of AI-driven actions — auto-decompositions, manual
// decompositions, file ingests, and future receipt types. Surfaces in
// the canvas HUD as a drawer so users see *what the AI just did* with a
// timestamp, a dismiss button, and (Phase 45) an Undo.
//
// The category-positioning move: Miro has no concept of AI accountability
// because Miro's AI is superficial. Our AI writes entities into user
// space — and anything that writes needs a receipt.
//
// Persistence: localStorage for v1 (matches Phase 39 clusters). A future
// phase swaps to a Supabase `ai_receipts` table so receipts sync across
// devices + collaborators.

import { useCallback, useEffect, useState } from "react";

export type ReceiptKind =
  | "auto-decompose"
  | "decompose"
  | "ingest"
  | "reaction-save"
  | "bridge-suggest";

export interface AIReceipt {
  id: string;
  kind: ReceiptKind;
  /** Short imperative summary, e.g. "Decomposed Customer LTV". */
  title: string;
  /** Optional longer line, shown under the title. */
  detail?: string | null;
  /** Entities created, touched, or referenced by the action. */
  entity_ids: string[];
  /** True when the action can be reversed. */
  undoable: boolean;
  /**
   * Phase 46 — explicit list of entity ids to delete when the user hits
   * Undo. For decompose receipts this is the children only (parent is
   * preserved). For ingest, every materialized entity. Undefined for
   * pre-Phase-46 receipts, in which case the Undo button is hidden.
   */
  undo_target_ids?: string[];
  /** Phase 46 — set once the user undoes this receipt (read-only after). */
  undone_at?: string | null;
  /** Whether the user has already dismissed this receipt. Dismissed
   *  receipts stay in storage (for audit) but don't render in the drawer
   *  unless `showDismissed` is enabled. */
  dismissed: boolean;
  at: string;
}

const VERSION = 1;
const MAX_RECEIPTS = 100;

interface PersistedShape {
  v: number;
  receipts: AIReceipt[];
}

function storageKey(spaceId: string): string {
  return `ai-receipts:${spaceId}`;
}

function readReceipts(spaceId: string): AIReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(spaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedShape;
    if (typeof parsed !== "object" || parsed === null) return [];
    if (parsed.v !== VERSION) return [];
    if (!Array.isArray(parsed.receipts)) return [];
    return parsed.receipts.filter(isWellFormed);
  } catch {
    return [];
  }
}

function isWellFormed(r: unknown): r is AIReceipt {
  if (typeof r !== "object" || r === null) return false;
  const obj = r as Record<string, unknown>;
  if (
    typeof obj.id !== "string" ||
    typeof obj.kind !== "string" ||
    typeof obj.title !== "string" ||
    typeof obj.at !== "string" ||
    !Array.isArray(obj.entity_ids) ||
    typeof obj.undoable !== "boolean" ||
    typeof obj.dismissed !== "boolean"
  ) {
    return false;
  }
  // Phase 46 — optional fields; absent / null are accepted for
  // backwards compatibility with pre-Phase-46 persisted receipts.
  if (
    obj.undo_target_ids !== undefined &&
    !Array.isArray(obj.undo_target_ids)
  )
    return false;
  if (
    obj.undone_at !== undefined &&
    obj.undone_at !== null &&
    typeof obj.undone_at !== "string"
  )
    return false;
  return true;
}

function writeReceipts(spaceId: string, receipts: AIReceipt[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = { v: VERSION, receipts };
    window.localStorage.setItem(storageKey(spaceId), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

function uuid4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return (
    Math.random().toString(36).slice(2, 10) +
    "-" +
    Date.now().toString(36)
  );
}

export interface UseAIReceipts {
  receipts: AIReceipt[];
  /** Active (non-dismissed) receipts count — drives the HUD badge. */
  activeCount: number;
  log: (
    input: Omit<AIReceipt, "id" | "dismissed" | "at"> &
      Partial<Pick<AIReceipt, "at">>,
  ) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** Phase 46 — flips a receipt to "undone" state. Caller is
   *  responsible for actually performing the undo (e.g. POST to the
   *  bulk-delete endpoint) before invoking this. */
  markUndone: (id: string) => void;
  clear: () => void;
}

export function useAIReceipts(
  spaceId: string | null | undefined,
): UseAIReceipts {
  const [receipts, setReceipts] = useState<AIReceipt[]>([]);

  // Hydrate on mount.
  useEffect(() => {
    if (!spaceId) return;
    setReceipts(readReceipts(spaceId));
  }, [spaceId]);

  // Persist on every change.
  useEffect(() => {
    if (!spaceId) return;
    writeReceipts(spaceId, receipts);
  }, [spaceId, receipts]);

  const log = useCallback<UseAIReceipts["log"]>((input) => {
    const id = uuid4();
    const receipt: AIReceipt = {
      id,
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? null,
      entity_ids: input.entity_ids,
      undoable: input.undoable,
      dismissed: false,
      at: input.at ?? new Date().toISOString(),
    };
    setReceipts((prev) => [receipt, ...prev].slice(0, MAX_RECEIPTS));
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setReceipts((prev) =>
      prev.map((r) => (r.id === id ? { ...r, dismissed: true } : r)),
    );
  }, []);

  const dismissAll = useCallback(() => {
    setReceipts((prev) => prev.map((r) => ({ ...r, dismissed: true })));
  }, []);

  const markUndone = useCallback((id: string) => {
    setReceipts((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, undone_at: new Date().toISOString(), dismissed: false }
          : r,
      ),
    );
  }, []);

  const clear = useCallback(() => {
    setReceipts([]);
  }, []);

  const activeCount = receipts.filter((r) => !r.dismissed).length;

  return {
    receipts,
    activeCount,
    log,
    dismiss,
    dismissAll,
    markUndone,
    clear,
  };
}

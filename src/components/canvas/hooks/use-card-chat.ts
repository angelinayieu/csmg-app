"use client";

// ── useCardChat (Arc 5C + Arc 5C.1 persistence) ────────────────────────
//
// Conversation state for the CardSidecar's chatbox. Owns:
//   • Message history per selected shape, PERSISTED in `card_chat_messages`
//     so refreshes and tab-switches don't lose state.
//   • Two-stage send pipeline:
//       Stage 1: /api/canvas/card-chat/fast (plain response, ≤1s)
//       Stage 2: /api/canvas/card-chat/deep (enrichment, 3-6s, runs in
//                background; appends its result as a follow-up message
//                or a proposed_change card)
//   • Optimistic UI: every send renders instantly; server writes happen
//     in parallel and failures are toasted but don't roll back UI
//     (state is already correct; persistence is best-effort).
//   • Abort on shape-switch: pending fetches for the previous card are
//     aborted so we don't mutate stale threads.
//
// Caching: HISTORY_BY_SHAPE is a module-scoped Map used as an in-session
// cache. On first select of a shape we backfill from the server; after
// that, writes go through optimistically AND to the server. On shape
// re-select the cache hits without re-fetching.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardContext } from "./use-card-sidecar-context";
import { serialiseContextForAPI } from "./use-card-sidecar-context";
import type {
  CardChatMessageRow,
  ListCardChatsResponse,
} from "@/app/api/spaces/[id]/card-chats/route";

// ── Message shape ────────────────────────────────────────────────────
export type ChatMessageRole = "user" | "assistant";

export interface ChatMessageBase {
  id: string;
  role: ChatMessageRole;
  createdAt: string; // ISO
}

export interface ChatMessageUser extends ChatMessageBase {
  role: "user";
  text: string;
}

export interface ChatMessageAssistantText extends ChatMessageBase {
  role: "assistant";
  kind: "text";
  text: string;
  /** True while Stage 2 enrichment is still inflight — shows a "thinking deeper" indicator. */
  enriching: boolean;
}

export interface ChatMessageAssistantProposal extends ChatMessageBase {
  role: "assistant";
  kind: "proposed_change";
  /** User-facing lead-in text before the proposal card. */
  preamble: string;
  proposal: {
    change_type: "modify_perspective" | "add_tactic" | "remove_tactic" | "adjust_timeline" | "reprioritize" | "pivot";
    target: string;
    target_id?: string;
    current: string;
    proposed: string;
    reasoning: string;
    impact: "low" | "medium" | "high";
    urgency: "low" | "medium" | "high";
  };
  /** Terminal state after user decides. */
  decision: "pending" | "applied" | "skipped";
  decisionNote?: string;
}

export type ChatMessage =
  | ChatMessageUser
  | ChatMessageAssistantText
  | ChatMessageAssistantProposal;

// ── Hook ────────────────────────────────────────────────────────────
interface UseCardChatOpts {
  spaceId: string;
  context: CardContext | null;
  onError?: (message: string) => void;
}

// In-session cache so tab-switches inside the sidecar don't re-fetch.
// Backfilled from the server the first time each shape is selected.
const HISTORY_BY_SHAPE = new Map<string, ChatMessage[]>();
// Set of shape IDs we've already hydrated from the server this session.
// Separate from HISTORY_BY_SHAPE so empty histories don't trigger re-fetches.
const HYDRATED_SHAPES = new Set<string>();

function genId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Server <-> local serialization ─────────────────────────────────
//
// The DB stores content as JSONB; the shape varies by kind (see migration
// header). These helpers map between the DB row and our in-memory
// ChatMessage union. Keep them narrow — they're the source of truth for
// the wire contract.

function serializeContent(m: ChatMessage): Record<string, unknown> {
  if (m.role === "user") {
    return { text: m.text };
  }
  if (m.kind === "text") {
    return { text: m.text, enriching: m.enriching };
  }
  // proposed_change
  return {
    preamble: m.preamble,
    proposal: m.proposal,
    decision: m.decision,
    decision_note: m.decisionNote ?? null,
  };
}

function deserializeMessage(row: CardChatMessageRow): ChatMessage {
  const c = row.content as Record<string, unknown>;
  if (row.role === "user") {
    return {
      id: row.id,
      role: "user",
      text: typeof c.text === "string" ? c.text : "",
      createdAt: row.created_at,
    };
  }
  if (row.kind === "text") {
    return {
      id: row.id,
      role: "assistant",
      kind: "text",
      text: typeof c.text === "string" ? c.text : "",
      enriching: Boolean(c.enriching),
      createdAt: row.created_at,
    };
  }
  // proposed_change
  return {
    id: row.id,
    role: "assistant",
    kind: "proposed_change",
    preamble: typeof c.preamble === "string" ? c.preamble : "",
    proposal: (c.proposal as ChatMessageAssistantProposal["proposal"]) ?? {
      change_type: "modify_perspective",
      target: "",
      current: "",
      proposed: "",
      reasoning: "",
      impact: "low",
      urgency: "low",
    },
    decision: (c.decision as ChatMessageAssistantProposal["decision"]) ?? "pending",
    decisionNote: typeof c.decision_note === "string" ? c.decision_note : undefined,
    createdAt: row.created_at,
  };
}

// ── Persistence helpers (fire-and-forget; errors toasted) ──────────
async function persistInsert(
  spaceId: string,
  cardShapeId: string,
  m: ChatMessage,
): Promise<void> {
  const kind: "text" | "proposed_change" =
    m.role === "assistant" && m.kind === "proposed_change" ? "proposed_change" : "text";
  const res = await fetch(`/api/spaces/${spaceId}/card-chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      card_shape_id: cardShapeId,
      role: m.role,
      kind,
      content: serializeContent(m),
      client_id: m.id,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}

async function persistUpdate(
  spaceId: string,
  m: ChatMessage,
): Promise<void> {
  const res = await fetch(`/api/spaces/${spaceId}/card-chats/${m.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: serializeContent(m) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}

export function useCardChat({ spaceId, context, onError }: UseCardChatOpts) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate from server (first time) or cache (re-select) on context change.
  useEffect(() => {
    if (!context) {
      setMessages([]);
      return;
    }
    const shapeId = context.shapeId;

    // Cache hit — instant render.
    if (HYDRATED_SHAPES.has(shapeId)) {
      setMessages(HISTORY_BY_SHAPE.get(shapeId) ?? []);
      return;
    }

    // Cold cache — fetch from server.
    let cancelled = false;
    setHydrating(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/card-chats?cardShapeId=${encodeURIComponent(shapeId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ListCardChatsResponse;
        if (cancelled) return;
        const hydrated = (data.messages ?? []).map(deserializeMessage);
        HISTORY_BY_SHAPE.set(shapeId, hydrated);
        HYDRATED_SHAPES.add(shapeId);
        setMessages(hydrated);
      } catch (e) {
        // Non-fatal — user can still chat, just without prior history.
        console.warn("[useCardChat] hydrate failed:", e);
        HYDRATED_SHAPES.add(shapeId); // mark so we don't re-try this session
        setMessages([]);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [context, spaceId]);

  // Keep the in-session cache fresh whenever local messages update.
  useEffect(() => {
    if (context) HISTORY_BY_SHAPE.set(context.shapeId, messages);
  }, [messages, context]);

  const setProposalDecision = useCallback(
    (messageId: string, decision: "applied" | "skipped", note?: string) => {
      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m.id === messageId && m.role === "assistant" && m.kind === "proposed_change") {
            return { ...m, decision, decisionNote: note };
          }
          return m;
        });
        // Find the updated message and persist the decision. Fire-and-forget;
        // state is already committed locally.
        const updated = next.find((m) => m.id === messageId);
        if (updated) {
          void persistUpdate(spaceId, updated).catch((e) =>
            onError?.((e as Error).message ?? "Failed to save decision"),
          );
        }
        return next;
      });
    },
    [spaceId, onError],
  );

  const send = useCallback(
    async (text: string) => {
      if (!context) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const nowIso = new Date().toISOString();
      const userMsg: ChatMessageUser = {
        id: genId(),
        role: "user",
        text: trimmed,
        createdAt: nowIso,
      };
      const placeholderAssistantId = genId();
      const placeholder: ChatMessageAssistantText = {
        id: placeholderAssistantId,
        role: "assistant",
        kind: "text",
        text: "",
        createdAt: nowIso,
        enriching: false,
      };

      setMessages((prev) => [...prev, userMsg, placeholder]);
      setSending(true);

      // Persist the user message immediately. We don't await this so the
      // Stage 1 LLM call can start in parallel — the message is already
      // on screen.
      void persistInsert(spaceId, context.shapeId, userMsg).catch((e) =>
        onError?.(`Couldn't save message: ${(e as Error).message}`),
      );

      // Serialise recent turns as chat history for the endpoint.
      const priorTurns = (HISTORY_BY_SHAPE.get(context.shapeId) ?? [])
        .slice(-6) // last 6 turns max
        .map((m) => {
          if (m.role === "user") return { role: "user" as const, text: m.text };
          if (m.role === "assistant" && m.kind === "text") return { role: "assistant" as const, text: m.text };
          if (m.role === "assistant" && m.kind === "proposed_change") {
            return { role: "assistant" as const, text: `${m.preamble}\n(Proposed change: ${m.proposal.change_type})` };
          }
          return { role: "assistant" as const, text: "" };
        });

      try {
        // ── Stage 1: fast response ──
        const fastRes = await fetch("/api/canvas/card-chat/fast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            card: serialiseContextForAPI(context),
            user_message: trimmed,
            prior_turns: priorTurns,
          }),
          signal: controller.signal,
        });
        if (!fastRes.ok) {
          const err = await fastRes.json().catch(() => ({ error: `HTTP ${fastRes.status}` }));
          throw new Error(err.error ?? `HTTP ${fastRes.status}`);
        }
        const fastData = (await fastRes.json()) as {
          response: string;
          should_enrich: boolean;
        };

        const updatedPlaceholder: ChatMessageAssistantText = {
          ...placeholder,
          text: fastData.response,
          enriching: fastData.should_enrich,
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderAssistantId && m.role === "assistant" && m.kind === "text"
              ? updatedPlaceholder
              : m,
          ),
        );
        // First time we're writing this assistant message to the server —
        // use INSERT (not update) because the row doesn't exist yet.
        void persistInsert(spaceId, context.shapeId, updatedPlaceholder).catch((e) =>
          onError?.(`Couldn't save AI reply: ${(e as Error).message}`),
        );

        // ── Stage 2: deep enrichment (fire-and-forget for ergonomics) ──
        if (fastData.should_enrich) {
          void (async () => {
            try {
              const deepRes = await fetch("/api/canvas/card-chat/deep", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  spaceId,
                  card: serialiseContextForAPI(context),
                  user_message: trimmed,
                  stage1_response: fastData.response,
                  prior_turns: priorTurns,
                }),
                signal: controller.signal,
              });
              if (!deepRes.ok) {
                // Clear the enriching indicator both locally and server-side.
                const cleared: ChatMessageAssistantText = {
                  ...updatedPlaceholder,
                  enriching: false,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderAssistantId ? cleared : m)),
                );
                void persistUpdate(spaceId, cleared).catch(() => {});
                return;
              }
              const deepData = (await deepRes.json()) as {
                kind: "enriched" | "proposed_change";
                enriched_response?: string;
                preamble?: string;
                proposal?: ChatMessageAssistantProposal["proposal"];
              };

              if (deepData.kind === "proposed_change" && deepData.proposal) {
                // The Stage 1 bubble clears its enriching flag; a new
                // proposal bubble is appended below it.
                const stage1Cleared: ChatMessageAssistantText = {
                  ...updatedPlaceholder,
                  enriching: false,
                };
                const proposalMsg: ChatMessageAssistantProposal = {
                  id: genId(),
                  role: "assistant",
                  kind: "proposed_change",
                  preamble: deepData.preamble ?? "I think this part of the strategy should change:",
                  proposal: deepData.proposal,
                  decision: "pending",
                  createdAt: new Date().toISOString(),
                };
                setMessages((prev) => [
                  ...prev.map((m) => (m.id === placeholderAssistantId ? stage1Cleared : m)),
                  proposalMsg,
                ]);
                // Persist Stage 1 update + new proposal row.
                void persistUpdate(spaceId, stage1Cleared).catch(() => {});
                void persistInsert(spaceId, context.shapeId, proposalMsg).catch((e) =>
                  onError?.(`Couldn't save proposal: ${(e as Error).message}`),
                );
              } else if (deepData.enriched_response) {
                // Replace Stage 1 text with the enriched version.
                const enriched: ChatMessageAssistantText = {
                  ...updatedPlaceholder,
                  text: deepData.enriched_response,
                  enriching: false,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderAssistantId ? enriched : m)),
                );
                void persistUpdate(spaceId, enriched).catch(() => {});
              } else {
                // Nothing to patch — just clear the indicator.
                const cleared: ChatMessageAssistantText = {
                  ...updatedPlaceholder,
                  enriching: false,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderAssistantId ? cleared : m)),
                );
                void persistUpdate(spaceId, cleared).catch(() => {});
              }
            } catch (e) {
              if ((e as Error).name === "AbortError") return;
              console.warn("[useCardChat] Stage 2 failed:", e);
              const cleared: ChatMessageAssistantText = {
                ...updatedPlaceholder,
                enriching: false,
              };
              setMessages((prev) =>
                prev.map((m) => (m.id === placeholderAssistantId ? cleared : m)),
              );
              void persistUpdate(spaceId, cleared).catch(() => {});
            }
          })();
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const errText = (e as Error).message ?? "Chat failed";
        onError?.(errText);
        // Replace the placeholder locally with an error message so the
        // user sees something happened. Don't persist the error — user
        // can retry cleanly.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderAssistantId && m.role === "assistant" && m.kind === "text"
              ? { ...m, text: `(Couldn't reach the AI — ${errText}. Try again.)`, enriching: false }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [context, spaceId, onError],
  );

  const clearHistory = useCallback(() => {
    if (!context) return;
    const shapeId = context.shapeId;
    HISTORY_BY_SHAPE.delete(shapeId);
    HYDRATED_SHAPES.delete(shapeId);
    setMessages([]);
    void fetch(
      `/api/spaces/${spaceId}/card-chats?cardShapeId=${encodeURIComponent(shapeId)}`,
      { method: "DELETE" },
    ).catch((e) => onError?.(`Couldn't clear history: ${(e as Error).message}`));
  }, [context, spaceId, onError]);

  return {
    messages,
    sending,
    hydrating,
    send,
    setProposalDecision,
    clearHistory,
    hasHistory: messages.length > 0,
  };
}

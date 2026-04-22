"use client";

import { useState, useCallback, useRef } from "react";

export type ChatOperation = "question" | "explore" | "update" | "extend" | "strategy_iterate";

// ── Shell Navigation ──

export type ShellLevel =
  | { type: "space"; spaceId: string; label: string }
  | { type: "entity"; entityId: string; name: string }
  | { type: "edge"; sourceId: string; targetId: string; label: string }
  | { type: "insight"; insightType: string; summary: string };

export interface ProposedChange {
  id: string;
  type: "add_entity" | "add_edge" | "update_entity" | "update_edge" | "remove_edge";
  description: string;
  data: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected";
  /** Set while incremental analysis is running after acceptance */
  analyzing?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  operation?: ChatOperation;
  /** Entity context the message is about */
  entityContext?: { id: string; name: string };
  /** Focus stack snapshot at the time this message was sent */
  focusStack?: ShellLevel[];
  /** Proposed graph changes from Update/Extend operations */
  proposedChanges?: ProposedChange[];
  timestamp: number;
}

export function useSpaceChat(spaceId: string, onGraphChanged?: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Shell Navigation State ──
  const [focusStack, setFocusStack] = useState<ShellLevel[]>([]);

  const pushFocus = useCallback((level: ShellLevel) => {
    setFocusStack((prev) => {
      // Prevent duplicate consecutive pushes of same entity/edge
      const top = prev[prev.length - 1];
      if (top) {
        if (top.type === "entity" && level.type === "entity" && top.entityId === level.entityId) return prev;
        if (top.type === "edge" && level.type === "edge" && top.sourceId === level.sourceId && top.targetId === level.targetId) return prev;
      }
      return [...prev, level];
    });
  }, []);

  const popFocus = useCallback(() => {
    setFocusStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const popToIndex = useCallback((index: number) => {
    setFocusStack((prev) => prev.slice(0, index + 1));
  }, []);

  const clearFocus = useCallback(() => {
    setFocusStack([]);
  }, []);

  // Derive entityContext from the top of the focus stack
  const derivedEntityContext = focusStack.length > 0
    ? (() => {
        const top = focusStack[focusStack.length - 1];
        if (top.type === "entity") return { id: top.entityId, name: top.name };
        return undefined;
      })()
    : undefined;

  const sendMessage = useCallback(
    async (
      content: string,
      operation: ChatOperation,
      entityContext?: { id: string; name: string }
    ) => {
      if (!content.trim()) return;

      setError(null);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      // Use explicit entityContext if provided, otherwise derive from focus stack
      const resolvedEntityContext = entityContext ?? derivedEntityContext;

      // Add user message with focus stack snapshot
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        operation,
        entityContext: resolvedEntityContext,
        focusStack: focusStack.length > 0 ? [...focusStack] : undefined,
        timestamp: Date.now(),
      };

      // Add placeholder assistant message for streaming
      const assistantId = `assistant-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        operation,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      // Filter history: prefer messages from the current shell level
      const currentTop = focusStack[focusStack.length - 1];
      const relevantMessages = currentTop
        ? messages.filter((m) => {
            // Always include messages with no focus (global context)
            if (!m.focusStack || m.focusStack.length === 0) return true;
            // Include messages from same shell or parent shells
            const msgTop = m.focusStack[m.focusStack.length - 1];
            if (!msgTop) return true;
            if (currentTop.type === "entity" && msgTop.type === "entity") {
              return msgTop.entityId === currentTop.entityId;
            }
            if (currentTop.type === "edge" && msgTop.type === "edge") {
              return msgTop.sourceId === currentTop.sourceId && msgTop.targetId === currentTop.targetId;
            }
            // Include parent shell messages
            return m.focusStack.length <= focusStack.length;
          })
        : messages;

      try {
        // ── Strategy iteration: bypass chat LLM, route to strategy-refresh ──
        // The user's message is treated as a userConstraint. The endpoint
        // re-runs the multi-step strategy engine with the constraint on top of
        // all existing grounding. Apps are NOT materialized (deferApps=true);
        // user reviews the new ranked strategies + approves separately.
        if (operation === "strategy_iterate") {
          const sRes = await fetch("/api/pipeline/strategy-refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              spaceId,
              userConstraint: content,
              deferApps: true,
            }),
            signal,
          });
          if (!sRes.ok) {
            const errData = await sRes.json().catch(() => ({}));
            throw new Error(errData.error ?? `Strategy refresh failed (HTTP ${sRes.status})`);
          }
          const sData = await sRes.json().catch(() => null) as {
            recommendation?: { title?: string; summary?: string; confidence?: number };
            rankedStrategies?: Array<{ rank: number; recommendation: { title?: string; strategic_posture?: string } }>;
          } | null;
          const topTitle = sData?.recommendation?.title ?? sData?.rankedStrategies?.[0]?.recommendation?.title ?? "(untitled)";
          const summaryLine = sData?.recommendation?.summary ? ` ${sData.recommendation.summary}` : "";
          const altsLine = sData?.rankedStrategies && sData.rankedStrategies.length > 1
            ? `\n\nAlternatives: ${sData.rankedStrategies.slice(1, 3).map((r) => `rank ${r.rank}: "${r.recommendation.title ?? ""}"`).join(" · ")}`
            : "";
          const reply = `Regenerated strategy with your constraint: "${content}".\n\nTop recommendation — "${topTitle}" (confidence ${sData?.recommendation?.confidence ?? "?"}%).${summaryLine}${altsLine}\n\nOpen the strategy review to approve or iterate further.`;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: reply } : m)));
          setStreaming(false);
          onGraphChanged?.(); // triggers dashboard/strategy panel refresh
          return;
        }

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            message: content,
            operation,
            entityContext: resolvedEntityContext,
            focusStack: focusStack.length > 0 ? focusStack : undefined,
            history: relevantMessages.slice(-10).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            (errData as { error?: string }).error || `Chat failed (${res.status})`
          );
        }

        // Parse SSE stream
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const block of lines) {
            if (!block.trim()) continue;
            const eventMatch = block.match(/^event:\s*(.+)$/m);
            const dataMatch = block.match(/^data:\s*(.+)$/m);
            if (!dataMatch) continue;

            const eventType = eventMatch?.[1] ?? "delta";
            const rawData = dataMatch[1];

            if (eventType === "delta") {
              // Append text chunk
              const parsed = JSON.parse(rawData) as { text: string };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed.text }
                    : m
                )
              );
            } else if (eventType === "proposed_changes") {
              // Attach proposed changes to the assistant message
              const parsed = JSON.parse(rawData) as { changes: ProposedChange[] };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, proposedChanges: parsed.changes }
                    : m
                )
              );
            } else if (eventType === "error") {
              const parsed = JSON.parse(rawData) as { message: string };
              throw new Error(parsed.message);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Chat failed";
        setError(msg);
        // Remove the empty assistant message on error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${msg}` }
              : m
          )
        );
      } finally {
        setStreaming(false);
      }
    },
    [spaceId, messages, focusStack, derivedEntityContext]
  );

  const acceptChange = useCallback(
    async (messageId: string, changeId: string) => {
      // Apply the change via API
      const msg = messages.find((m) => m.id === messageId);
      const change = msg?.proposedChanges?.find((c) => c.id === changeId);
      if (!change) return;

      try {
        const res = await fetch("/api/chat", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spaceId,
            changeId,
            changeType: change.type,
            changeData: change.data,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            (errData as { error?: string }).error || "Failed to apply change"
          );
        }

        // Mark as accepted + analyzing
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  proposedChanges: m.proposedChanges?.map((c) =>
                    c.id === changeId ? { ...c, status: "accepted" as const, analyzing: true } : c
                  ),
                }
              : m
          )
        );

        // Extract changed entity/edge IDs for incremental analysis
        const changedEntityIds: string[] = [];
        const changedEdgePairs: Array<{ source: string; target: string }> = [];

        if (change.type === "add_entity" || change.type === "update_entity") {
          const eid = (change.data as { entity_id?: string }).entity_id;
          if (eid) changedEntityIds.push(eid);
        }
        if (change.type === "add_edge" || change.type === "update_edge") {
          const src = (change.data as { source_entity_id?: string }).source_entity_id;
          const tgt = (change.data as { target_entity_id?: string }).target_entity_id;
          if (src && tgt) changedEdgePairs.push({ source: src, target: tgt });
        }

        // Also collect all accepted changes from the same message for richer context
        const allAccepted = msg?.proposedChanges?.filter(
          (c) => c.status === "accepted" || c.id === changeId
        ) ?? [];
        for (const ac of allAccepted) {
          if (ac.id === changeId) continue; // already added above
          if (ac.type === "add_entity" || ac.type === "update_entity") {
            const eid = (ac.data as { entity_id?: string }).entity_id;
            if (eid && !changedEntityIds.includes(eid)) changedEntityIds.push(eid);
          }
          if (ac.type === "add_edge" || ac.type === "update_edge") {
            const src = (ac.data as { source_entity_id?: string }).source_entity_id;
            const tgt = (ac.data as { target_entity_id?: string }).target_entity_id;
            if (src && tgt) changedEdgePairs.push({ source: src, target: tgt });
          }
        }

        // Fire incremental analysis (non-blocking for the accept itself, but we await for UI)
        if (changedEntityIds.length > 0 || changedEdgePairs.length > 0) {
          try {
            await fetch("/api/chat/incremental-analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                spaceId,
                changedEntityIds,
                changedEdgePairs,
              }),
            });
          } catch {
            // Non-fatal — the change already succeeded
            console.warn("Incremental analysis failed (non-fatal)");
          }
        }

        // Clear analyzing state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  proposedChanges: m.proposedChanges?.map((c) =>
                    c.id === changeId ? { ...c, analyzing: false } : c
                  ),
                }
              : m
          )
        );

        // Trigger UI refresh so graph/panels reflect the new analysis
        onGraphChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to apply change");
      }
    },
    [spaceId, messages, onGraphChanged]
  );

  const rejectChange = useCallback((messageId: string, changeId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              proposedChanges: m.proposedChanges?.map((c) =>
                c.id === changeId ? { ...c, status: "rejected" as const } : c
              ),
            }
          : m
      )
    );
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    setFocusStack([]);
  }, []);

  return {
    messages,
    streaming,
    error,
    sendMessage,
    acceptChange,
    rejectChange,
    clearChat,
    // Shell navigation
    focusStack,
    pushFocus,
    popFocus,
    popToIndex,
    clearFocus,
    derivedEntityContext,
  };
}

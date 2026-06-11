"use client";

// Trove Agents — every folder can become a companion agent with an
// iMessage-style thread: persona distilled from the folder, chat grounded in
// its nodes, and "Today's briefing" — a daily-reminder message that
// cross-analyzes the folder against everything else you've been collecting.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTrove } from "../_lib/store";
import { hueGradient, timeAgo, type AgentMessage, type TroveCollection } from "../_lib/types";

export default function TroveAgentsPage() {
  const { loading, collections, nodes, refresh, toast } = useTrove();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [enabling, setEnabling] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) if (n.collection_id) m.set(n.collection_id, (m.get(n.collection_id) ?? 0) + 1);
    return m;
  }, [nodes]);

  const agents = useMemo(() => collections.filter((c) => c.is_agent), [collections]);
  const candidates = useMemo(
    () =>
      collections
        .filter((c) => !c.is_agent && (counts.get(c.id) ?? 0) > 0)
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
        .slice(0, 12),
    [collections, counts],
  );

  const active = useMemo(
    () => collections.find((c) => c.id === activeId) ?? null,
    [collections, activeId],
  );

  useEffect(() => {
    if (!activeId && agents.length) setActiveId(agents[0].id);
  }, [agents, activeId]);

  const loadThread = useCallback(async (collectionId: string) => {
    setThreadLoading(true);
    try {
      const resp = await fetch(`/api/trove/agents/${collectionId}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (resp.ok) setMessages(data.messages ?? []);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeId) void loadThread(activeId);
    else setMessages([]);
  }, [activeId, loadThread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  const enable = useCallback(
    async (c: TroveCollection) => {
      setEnabling(c.id);
      try {
        const resp = await fetch(`/api/trove/agents/${c.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enable: true }),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error(data?.error ?? "Could not wake this agent");
        await refresh();
        setActiveId(c.id);
        toast(`${c.emoji ?? "🤖"} ${c.name} is now an agent`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not wake this agent", "err");
      } finally {
        setEnabling(null);
      }
    },
    [refresh, toast],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !activeId || typing) return;
    setDraft("");
    const optimistic: AgentMessage = {
      id: `tmp-${Date.now()}`,
      collection_id: activeId,
      role: "user",
      body: text,
      kind: "chat",
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setTyping(true);
    try {
      const resp = await fetch(`/api/trove/agents/${activeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error ?? "Message failed");
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        ...(data.userMessage ? [data.userMessage] : [optimistic]),
        ...(data.message ? [data.message] : []),
      ]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Message failed", "err");
    } finally {
      setTyping(false);
    }
  }, [draft, activeId, typing, toast]);

  const briefing = useCallback(async () => {
    if (!activeId || typing) return;
    setTyping(true);
    try {
      const resp = await fetch(`/api/trove/agents/${activeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ briefing: true }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error ?? "Briefing failed");
      if (data.message) setMessages((m) => [...m, data.message]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Briefing failed", "err");
    } finally {
      setTyping(false);
    }
  }, [activeId, typing, toast]);

  if (loading) {
    return (
      <div className="tr-empty">
        <div className="tr-working"><span className="tr-working-dot" /> Waking your agents…</div>
      </div>
    );
  }

  return (
    <div className="tr-agents">
      <aside className="tr-agents-list">
        <h2>Agents</h2>
        {agents.length === 0 && (
          <p style={{ padding: "0 10px 8px", fontSize: 13, color: "var(--tr-ink-soft)", lineHeight: 1.5 }}>
            Turn any folder into a companion that texts you what matters — grounded in what you’ve
            collected there.
          </p>
        )}
        {agents.map((c) => (
          <button
            key={c.id}
            className={`tr-convo${activeId === c.id ? " is-active" : ""}`}
            onClick={() => setActiveId(c.id)}
          >
            <span className="tr-avatar" style={{ background: hueGradient(c.hue) }}>
              {c.emoji ?? "🤖"}
              <span className="tr-online" />
            </span>
            <span>
              <span className="tr-convo-name">{c.name}</span>
              <span className="tr-convo-line">
                {counts.get(c.id) ?? 0} item{(counts.get(c.id) ?? 0) === 1 ? "" : "s"} watched
              </span>
            </span>
          </button>
        ))}
        {candidates.length > 0 && (
          <>
            <div className="tr-agents-section">Folders that could become agents</div>
            {candidates.map((c) => (
              <button key={c.id} className="tr-convo" onClick={() => void enable(c)} disabled={enabling !== null}>
                <span className="tr-avatar" style={{ background: hueGradient(c.hue), opacity: 0.7 }}>
                  {c.emoji ?? "🗂️"}
                </span>
                <span>
                  <span className="tr-convo-name">{c.name}</span>
                  <span className="tr-convo-line">{counts.get(c.id) ?? 0} items</span>
                </span>
                <span className="tr-convo-enable">{enabling === c.id ? "Waking…" : "Wake up →"}</span>
              </button>
            ))}
          </>
        )}
      </aside>

      <section className="tr-thread">
        {active ? (
          <>
            <div className="tr-thread-head">
              <span className="tr-avatar" style={{ background: hueGradient(active.hue) }}>
                {active.emoji ?? "🤖"}
                <span className="tr-online" />
              </span>
              <span>
                <h3>{active.name}</h3>
                <small>Active now · watches {counts.get(active.id) ?? 0} items</small>
              </span>
              <div className="tr-thread-actions">
                <button className="tr-btn-ghost" onClick={() => void briefing()} disabled={typing}>
                  📋 Today’s briefing
                </button>
              </div>
            </div>
            <div className="tr-thread-scroll" ref={scrollRef}>
              {threadLoading && <div className="tr-working"><span className="tr-working-dot" /> Loading…</div>}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showTime =
                  !prev ||
                  new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() >
                    1000 * 60 * 30;
                return (
                  <div key={m.id} style={{ display: "contents" }}>
                    {showTime && <span className="tr-bubble-time">{timeAgo(m.created_at)}</span>}
                    {m.kind === "briefing" ? (
                      <div className="tr-bubble-briefing">
                        <span className="tr-briefing-tag">📋 Daily briefing</span>
                        {m.body}
                      </div>
                    ) : (
                      <div className={`tr-bubble ${m.role === "agent" ? "tr-bubble-agent" : "tr-bubble-user"}`}>
                        {m.body}
                      </div>
                    )}
                  </div>
                );
              })}
              {typing && (
                <div className="tr-typing" aria-label="Agent is typing">
                  <i /><i /><i />
                </div>
              )}
            </div>
            <div className="tr-thread-input">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
                placeholder={`Message ${active.name}…`}
                disabled={typing}
              />
              <button className="tr-send" onClick={() => void send()} disabled={!draft.trim() || typing} aria-label="Send">
                ↑
              </button>
            </div>
          </>
        ) : (
          <div className="tr-thread-empty">
            <div>
              <span className="tr-empty-mark">🤖</span>
              <h3 style={{ marginTop: 10 }}>No agents awake yet</h3>
              <p style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5 }}>
                Wake a folder on the left — it becomes a companion that knows everything in it,
                texts you daily briefings, and answers like a sharp friend.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

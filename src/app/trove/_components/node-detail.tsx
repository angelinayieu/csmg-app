"use client";

// Node detail overlay — the "pin detail" view. Left: media / gradient hero.
// Right: summary, layer chips (depth + causal role), typed connections,
// folder siblings, and the web-grounded "More like this" ghost grid.

import { useCallback, useEffect, useState } from "react";
import {
  KIND_EMOJI,
  hueGradient,
  hueInk,
  relationPhrase,
  type ExploreResult,
  type NodeDetailResponse,
  type TroveNode,
} from "../_lib/types";
import { useTrove } from "../_lib/store";
import { GhostCard } from "./cards";

export function NodeDetailOverlay({
  nodeId,
  onClose,
  onJump,
}: {
  nodeId: string;
  onClose: () => void;
  onJump: (node: TroveNode) => void;
}) {
  const { collectionById, toast, refresh } = useTrove();
  const [detail, setDetail] = useState<NodeDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [explore, setExplore] = useState<ExploreResult | null>(null);
  const [exploring, setExploring] = useState(false);

  useEffect(() => {
    setDetail(null);
    setExplore(null);
    setFailed(false);
    let dead = false;
    void (async () => {
      const resp = await fetch(`/api/trove/nodes/${nodeId}`, { cache: "no-store" });
      if (dead) return;
      if (!resp.ok) {
        setFailed(true);
        return;
      }
      setDetail(await resp.json());
    })();
    return () => {
      dead = true;
    };
  }, [nodeId]);

  const runExplore = useCallback(async () => {
    setExploring(true);
    try {
      const resp = await fetch("/api/trove/explore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error ?? "Explore failed");
      setExplore(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Explore failed", "err");
    } finally {
      setExploring(false);
    }
  }, [nodeId, toast]);

  const togglePin = useCallback(async () => {
    if (!detail) return;
    const next = !detail.node.pinned;
    setDetail({ ...detail, node: { ...detail.node, pinned: next } });
    await fetch(`/api/trove/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    });
    void refresh();
  }, [detail, nodeId, refresh]);

  const remove = useCallback(async () => {
    if (!window.confirm("Delete this node (its edges go with it)?")) return;
    await fetch(`/api/trove/nodes/${nodeId}`, { method: "DELETE" });
    toast("Deleted");
    void refresh();
    onClose();
  }, [nodeId, refresh, toast, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const node = detail?.node;
  const collection = collectionById(node?.collection_id ?? null);

  return (
    <div className="tr-scrim" onClick={onClose} role="dialog" aria-label="Node detail">
      <div className="tr-detail" onClick={(e) => e.stopPropagation()}>
        {!node ? (
          <div className="tr-detail-loading">{failed ? "Could not load this node." : "Opening…"}</div>
        ) : (
          <>
            <div className="tr-detail-hero">
              {node.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={node.media_url} alt={node.title} />
              ) : (
                <div className="tr-detail-cover" style={{ background: hueGradient(node.hue) }}>
                  <span>{KIND_EMOJI[node.kind] ?? "🧩"}</span>
                  <h2 style={{ color: hueInk(node.hue) }}>{node.title}</h2>
                </div>
              )}
            </div>
            <div className="tr-detail-body">
              <div className="tr-detail-top">
                <div className="tr-detail-chips">
                  <span className="tr-chip">{KIND_EMOJI[node.kind]} {node.kind}</span>
                  {node.causal_role && <span className="tr-chip">{node.causal_role}</span>}
                  <span className="tr-chip" title="Complexity layer">L{node.depth}</span>
                  {collection && <span className="tr-chip tr-chip-col">{collection.emoji} {collection.name}</span>}
                </div>
                <div className="tr-detail-actions">
                  <button className="tr-btn-ghost" onClick={() => void togglePin()}>
                    {node.pinned ? "Unpin" : "Pin 📌"}
                  </button>
                  <button className="tr-btn-ghost tr-danger" onClick={() => void remove()}>
                    Delete
                  </button>
                  <button className="tr-btn-ghost" onClick={onClose} aria-label="Close">✕</button>
                </div>
              </div>
              <h1>{node.title}</h1>
              {node.summary && <p className="tr-detail-summary">{node.summary}</p>}
              {node.source_ref && node.source_kind === "web" && (
                <a className="tr-detail-source" href={node.source_ref} target="_blank" rel="noreferrer">
                  🔗 {node.source_ref}
                </a>
              )}
              {node.content && node.content !== node.summary && (
                <details className="tr-detail-content">
                  <summary>Full content</summary>
                  <p>{node.content}</p>
                </details>
              )}
              {node.tags.length > 0 && (
                <div className="tr-detail-tags">
                  {node.tags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              )}

              {detail.edges.length > 0 && (
                <section className="tr-detail-section">
                  <h3>Connections</h3>
                  <div className="tr-connections">
                    {detail.edges.map((e) => {
                      const otherId = e.source_id === node.id ? e.target_id : e.source_id;
                      const other = detail.neighbors.find((n) => n.id === otherId);
                      if (!other) return null;
                      const outgoing = e.source_id === node.id;
                      return (
                        <button key={e.id} className="tr-connection" onClick={() => onJump(other)}>
                          <span className="tr-connection-rel">
                            {outgoing ? "→" : "←"} {relationPhrase(e.relation, e.label)}
                          </span>
                          <span className="tr-connection-dot" style={{ background: hueGradient(other.hue) }} />
                          <span className="tr-connection-title">{other.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {detail.siblings.length > 0 && (
                <section className="tr-detail-section">
                  <h3>Same folder</h3>
                  <div className="tr-siblings">
                    {detail.siblings.map((s) => (
                      <button key={s.id} onClick={() => onJump(s)} className="tr-sibling">
                        <span style={{ background: hueGradient(s.hue) }}>{KIND_EMOJI[s.kind] ?? "🧩"}</span>
                        {s.title}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="tr-detail-section">
                <div className="tr-mlt-head">
                  <h3>{explore ? explore.heading : "More like this"}</h3>
                  <button className="tr-btn-primary" onClick={() => void runExplore()} disabled={exploring}>
                    {exploring ? "Searching the web…" : explore ? "Go further ↻" : "✨ Find more"}
                  </button>
                </div>
                {explore && (
                  <div className="tr-ghost-grid">
                    {explore.ghosts.map((g, i) => (
                      <GhostCard
                        key={`${g.title}-${i}`}
                        ghost={g}
                        context={{ relatedNodeId: node.id, collectionId: node.collection_id ?? undefined }}
                      />
                    ))}
                  </div>
                )}
                {!explore && !exploring && (
                  <p className="tr-mlt-hint">
                    AI expands this node with adjacent ideas, deeper concepts, and real examples — grounded in live web search.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

// Trove Library — the Pinterest surface: "More ideas for…" pill row, masonry
// of everything collected, node detail overlay, AI explore sections.

import { useMemo, useState } from "react";
import { useTrove } from "./_lib/store";
import { hueChip, type ExploreResult, type TroveNode } from "./_lib/types";
import { GhostCard, NodeCard } from "./_components/cards";
import { NodeDetailOverlay } from "./_components/node-detail";

export default function TroveLibraryPage() {
  const { loading, error, nodes, collections, searchQuery, setComposerOpen, syncSpaces, busy, toast } =
    useTrove();
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [pillExplore, setPillExplore] = useState<{
    collectionId: string;
    name: string;
    result: ExploreResult | null;
  } | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) if (n.collection_id) m.set(n.collection_id, (m.get(n.collection_id) ?? 0) + 1);
    return m;
  }, [nodes]);

  const topCollections = useMemo(
    () =>
      collections
        .filter((c) => (counts.get(c.id) ?? 0) > 0)
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
        .slice(0, 6),
    [collections, counts],
  );

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        (n.summary ?? "").toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [nodes, searchQuery]);

  const colName = useMemo(() => new Map(collections.map((c) => [c.id, c.name])), [collections]);

  const runPillExplore = async (collectionId: string, name: string) => {
    setPillExplore({ collectionId, name, result: null });
    try {
      const resp = await fetch("/api/trove/explore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collectionId }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error ?? "Explore failed");
      setPillExplore({ collectionId, name, result: data });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Explore failed", "err");
      setPillExplore(null);
    }
  };

  if (loading) {
    return (
      <div className="tr-empty">
        <div className="tr-working"><span className="tr-working-dot" /> Opening your trove…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="tr-empty">
        <h2>Couldn’t load your trove</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!nodes.length) {
    return (
      <div className="tr-empty">
        <span className="tr-empty-mark">◆</span>
        <h2>Your trove is empty — for about a minute</h2>
        <p>
          Trove is the knowledge graph of everything you collect: it decomposes whatever you drop in,
          wires it into concepts and causes, and files it automatically.
        </p>
        <div className="tr-empty-cta">
          <button className="tr-btn-primary" onClick={() => setComposerOpen(true)}>
            Paste anything
          </button>
          <button className="tr-btn-ghost" onClick={() => void syncSpaces()} disabled={busy === "sync"}>
            {busy === "sync" ? "Importing…" : "Import from my boards"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tr-page">
      {topCollections.length > 0 && (
        <div className="tr-pills">
          {topCollections.map((c) => (
            <button
              key={c.id}
              className="tr-pill"
              style={{ background: hueChip(c.hue) }}
              onClick={() => void runPillExplore(c.id, c.name)}
            >
              <span className="tr-pill-emoji">{c.emoji ?? "🗂️"}</span>
              <span>
                <small>More ideas for</small>
                <strong>{c.name}</strong>
              </span>
            </button>
          ))}
        </div>
      )}

      {pillExplore && (
        <section className="tr-explore-strip">
          <div className="tr-mlt-head">
            <h3>
              {pillExplore.result ? pillExplore.result.heading : `Expanding “${pillExplore.name}”…`}
              {pillExplore.result?.grounded && <span className="tr-grounded-tag">🌐 web-grounded</span>}
            </h3>
            <button className="tr-btn-ghost" onClick={() => setPillExplore(null)}>✕</button>
          </div>
          {pillExplore.result ? (
            <div className="tr-ghost-grid">
              {pillExplore.result.ghosts.map((g, i) => (
                <GhostCard key={`${g.title}-${i}`} ghost={g} context={{ collectionId: pillExplore.collectionId }} />
              ))}
            </div>
          ) : (
            <div className="tr-working"><span className="tr-working-dot" /> Searching the web + your graph…</div>
          )}
        </section>
      )}

      <div className="tr-masonry">
        {visible.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            collectionName={n.collection_id ? colName.get(n.collection_id) : undefined}
            onOpen={(node: TroveNode) => setOpenNodeId(node.id)}
          />
        ))}
      </div>
      {visible.length === 0 && (
        <div className="tr-empty">
          <p>Nothing matches “{searchQuery}”.</p>
        </div>
      )}

      {openNodeId && (
        <NodeDetailOverlay
          nodeId={openNodeId}
          onClose={() => setOpenNodeId(null)}
          onJump={(node) => setOpenNodeId(node.id)}
        />
      )}
    </div>
  );
}

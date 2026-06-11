"use client";

// Trove Folders — the "automatic Google Drive": collection tree on the left,
// breadcrumbs + sub-folder cards + node rows on the right. The tree is built
// by the LLM (ingest auto-files; Organize sweeps strays).

import { useMemo, useState } from "react";
import { useTrove } from "../_lib/store";
import {
  KIND_EMOJI,
  hueGradient,
  timeAgo,
  type TroveCollection,
  type TroveNode,
} from "../_lib/types";
import { NodeDetailOverlay } from "../_components/node-detail";

export default function TroveFilesPage() {
  const { loading, nodes, collections, childrenOf, collectionById, organize, busy, setComposerOpen } =
    useTrove();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);

  // node counts roll UP the tree so parents show their whole subtree.
  const deepCounts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const n of nodes)
      if (n.collection_id) direct.set(n.collection_id, (direct.get(n.collection_id) ?? 0) + 1);
    const memo = new Map<string, number>();
    const kidsOf = new Map<string | null, TroveCollection[]>();
    for (const c of collections) {
      const k = c.parent_id ?? null;
      if (!kidsOf.has(k)) kidsOf.set(k, []);
      kidsOf.get(k)!.push(c);
    }
    const count = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!;
      let total = direct.get(id) ?? 0;
      for (const child of kidsOf.get(id) ?? []) total += count(child.id);
      memo.set(id, total);
      return total;
    };
    for (const c of collections) count(c.id);
    return memo;
  }, [nodes, collections]);

  const current = collectionById(currentId);
  const subfolders = childrenOf(currentId);
  const looseCount = nodes.filter((n) => !n.collection_id).length;

  const shownNodes = useMemo(() => {
    const list =
      currentId === null
        ? nodes.filter((n) => !n.collection_id)
        : nodes.filter((n) => n.collection_id === currentId);
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [nodes, currentId]);

  const crumbs = useMemo(() => {
    const chain: TroveCollection[] = [];
    let c = current;
    while (c) {
      chain.unshift(c);
      c = collectionById(c.parent_id);
    }
    return chain;
  }, [current, collectionById]);

  if (loading) {
    return (
      <div className="tr-empty">
        <div className="tr-working"><span className="tr-working-dot" /> Opening your drive…</div>
      </div>
    );
  }

  return (
    <div className="tr-drive">
      <aside className="tr-tree">
        <button
          className={`tr-tree-item${currentId === null ? " is-active" : ""}`}
          onClick={() => setCurrentId(null)}
        >
          🧺 Unfiled
          <span className="tr-tree-count">{looseCount}</span>
        </button>
        <TreeLevel
          parentId={null}
          childrenOf={childrenOf}
          counts={deepCounts}
          currentId={currentId}
          onPick={setCurrentId}
          depth={0}
        />
        {collections.length === 0 && (
          <p style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--tr-ink-soft)" }}>
            Folders appear automatically as you add things.
          </p>
        )}
      </aside>

      <section>
        <div className="tr-drive-head">
          <div className="tr-crumbs">
            <button onClick={() => setCurrentId(null)}>My trove</button>
            {crumbs.map((c, i) => (
              <span key={c.id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <span>›</span>
                <button
                  className={i === crumbs.length - 1 ? "is-here" : undefined}
                  onClick={() => setCurrentId(c.id)}
                >
                  {c.emoji} {c.name}
                </button>
              </span>
            ))}
            {currentId === null && <span className="is-here">› Unfiled</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {looseCount > 0 && (
              <button className="tr-btn-primary" onClick={() => void organize()} disabled={busy === "organize"}>
                {busy === "organize" ? "Filing…" : `✨ Auto-file ${looseCount} unfiled`}
              </button>
            )}
            <button className="tr-btn-ghost" onClick={() => setComposerOpen(true)}>+ Add here</button>
          </div>
        </div>

        {subfolders.length > 0 && (
          <div className="tr-subfolders">
            {subfolders.map((c) => (
              <button
                key={c.id}
                className="tr-folder-card"
                style={{ ["--tab-hue" as string]: `hsl(${c.hue} 60% 70%)` }}
                onClick={() => setCurrentId(c.id)}
              >
                <span className="tr-folder-emoji">{c.emoji ?? "🗂️"}</span>
                <h4>{c.name}</h4>
                <small>
                  {deepCounts.get(c.id) ?? 0} item{(deepCounts.get(c.id) ?? 0) === 1 ? "" : "s"}
                  {c.is_agent ? " · 🤖 agent" : ""}
                </small>
              </button>
            ))}
          </div>
        )}

        <div className="tr-rows">
          {shownNodes.map((n: TroveNode) => (
            <button key={n.id} className="tr-row" onClick={() => setOpenNodeId(n.id)}>
              <span className="tr-row-icon" style={{ background: hueGradient(n.hue) }}>
                {KIND_EMOJI[n.kind] ?? "🧩"}
              </span>
              <span>
                <span className="tr-row-title">{n.title}</span>
                {n.summary && <span className="tr-row-sub">{n.summary}</span>}
              </span>
              <span className="tr-row-right">
                {n.causal_role && <span className="tr-chip">{n.causal_role}</span>}
                <span className="tr-chip">L{n.depth}</span>
                <span>{timeAgo(n.created_at)}</span>
              </span>
            </button>
          ))}
          {shownNodes.length === 0 && subfolders.length === 0 && (
            <p style={{ color: "var(--tr-ink-soft)", fontSize: 14, padding: "30px 6px" }}>
              {currentId === null
                ? "Nothing unfiled — everything has a home. 🎉"
                : "This folder is empty."}
            </p>
          )}
        </div>
      </section>

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

function TreeLevel({
  parentId,
  childrenOf,
  counts,
  currentId,
  onPick,
  depth,
}: {
  parentId: string | null;
  childrenOf: (id: string | null) => TroveCollection[];
  counts: Map<string, number>;
  currentId: string | null;
  onPick: (id: string) => void;
  depth: number;
}) {
  const kids = childrenOf(parentId);
  if (!kids.length || depth > 4) return null;
  return (
    <>
      {kids.map((c) => (
        <div key={c.id}>
          <button
            className={`tr-tree-item${depth > 0 ? " tr-tree-child" : ""}${currentId === c.id ? " is-active" : ""}`}
            onClick={() => onPick(c.id)}
          >
            {c.emoji ?? "🗂️"} {c.name}
            <span className="tr-tree-count">{counts.get(c.id) ?? 0}</span>
          </button>
          <TreeLevel
            parentId={c.id}
            childrenOf={childrenOf}
            counts={counts}
            currentId={currentId}
            onPick={onPick}
            depth={depth + 1}
          />
        </div>
      ))}
    </>
  );
}

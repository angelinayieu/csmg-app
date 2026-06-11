"use client";

// Trove cards — the Pinterest grain: masonry NodeCard (image cover or hue
// gradient with an oversized title) and GhostCard (AI suggestion w/ Save).

import { useState } from "react";
import {
  KIND_EMOJI,
  hueGradient,
  hueInk,
  timeAgo,
  type Ghost,
  type TroveNode,
} from "../_lib/types";
import { useTrove } from "../_lib/store";

export function NodeCard({
  node,
  onOpen,
  collectionName,
}: {
  node: TroveNode;
  onOpen: (node: TroveNode) => void;
  collectionName?: string;
}) {
  // Title length drives gradient-card height so the masonry stays organic.
  const tall = !node.media_url && (node.title.length > 46 || (node.summary?.length ?? 0) > 130);
  return (
    <article
      className={`tr-card${node.media_url ? " has-media" : ""}${tall ? " is-tall" : ""}`}
      onClick={() => onOpen(node)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen(node)}
    >
      {node.media_url ? (
        <div className="tr-card-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={node.media_url} alt={node.title} loading="lazy" />
        </div>
      ) : (
        <div className="tr-card-cover" style={{ background: hueGradient(node.hue) }}>
          <span className="tr-card-kind">{KIND_EMOJI[node.kind] ?? "🧩"}</span>
          <h3 style={{ color: hueInk(node.hue) }}>{node.title}</h3>
          {node.summary && <p style={{ color: hueInk(node.hue) }}>{node.summary}</p>}
        </div>
      )}
      <footer className="tr-card-foot">
        {node.media_url && <h4>{node.title}</h4>}
        <div className="tr-card-meta">
          {collectionName && <span className="tr-card-col">{collectionName}</span>}
          <span className="tr-card-ago">{timeAgo(node.created_at)}</span>
          {node.pinned && <span title="Pinned">📌</span>}
        </div>
      </footer>
    </article>
  );
}

export function GhostCard({
  ghost,
  context,
}: {
  ghost: Ghost;
  context: { relatedNodeId?: string; collectionId?: string };
}) {
  const { ingest, toast } = useTrove();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state !== "idle") return;
    setState("saving");
    const outcome = await ingest({ ghost: { ...ghost, ...context } });
    if (outcome.ok) {
      setState("saved");
    } else {
      setState("idle");
      toast(outcome.error ?? "Could not save", "err");
    }
  };

  return (
    <article className={`tr-card tr-ghost${state === "saved" ? " is-saved" : ""}`}>
      <div className="tr-card-cover" style={{ background: hueGradient(ghost.hue) }}>
        <div className="tr-ghost-top">
          <span className="tr-ghost-angle">{ghost.angle}</span>
          {ghost.grounded && <span className="tr-ghost-web" title="Grounded in live web search">🌐</span>}
        </div>
        <h3 style={{ color: hueInk(ghost.hue) }}>{ghost.title}</h3>
        <p style={{ color: hueInk(ghost.hue) }}>{ghost.summary}</p>
        <button className="tr-ghost-save" onClick={(e) => void save(e)} disabled={state !== "idle"}>
          {state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </article>
  );
}

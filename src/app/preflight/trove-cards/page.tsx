"use client";

// Preflight harness: trove Library visuals (pills + masonry + card grain)
// without auth or data — the preview browser can't sign in, so this is the
// visual verification surface for /trove.

import "../../trove/trove.css";
import { NodeCard } from "../../trove/_components/cards";
import type { TroveNode } from "../../trove/_lib/types";
import { hueChip } from "../../trove/_lib/types";

const t = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();

const SAMPLE: Array<TroveNode & { _col?: string }> = [
  { id: "1", collection_id: "c1", kind: "concept", title: "Spaced repetition beats cramming", summary: "Memory consolidates on a forgetting curve; reviews timed to the curve flatten it.", media_url: null, source_kind: "manual", source_ref: null, depth: 3, causal_role: "mechanism", tags: ["learning"], hue: 16, pinned: true, created_at: t(2), _col: "Learning science" },
  { id: "2", collection_id: "c2", kind: "image", title: "Tonal clay study — functional sculpture", summary: null, media_url: "https://picsum.photos/seed/trove1/420/560", source_kind: "image", source_ref: null, depth: 1, causal_role: "context", tags: [], hue: 30, pinned: false, created_at: t(5), _col: "Studio references" },
  { id: "3", collection_id: "c1", kind: "question", title: "What would make daily review feel like play?", summary: "Open question from decomposing the habit-loop note.", media_url: null, source_kind: "decompose", source_ref: null, depth: 2, causal_role: "variable", tags: ["habits"], hue: 210, pinned: false, created_at: t(8), _col: "Learning science" },
  { id: "4", collection_id: "c3", kind: "link", title: "The maintenance-first school of product", summary: "Essay arguing that compounding products optimize repair speed over feature speed.", media_url: "https://picsum.photos/seed/trove2/420/300", source_kind: "web", source_ref: "https://example.com", depth: 4, causal_role: "driver", tags: ["product"], hue: 150, pinned: false, created_at: t(20), _col: "Product strategy" },
  { id: "5", collection_id: "c2", kind: "idea", title: "Moodboard that argues back", summary: "A board where every pin you save generates its counter-aesthetic next to it.", media_url: null, source_kind: "explore", source_ref: null, depth: 2, causal_role: "outcome", tags: ["ai", "design"], hue: 286, pinned: false, created_at: t(26), _col: "Studio references" },
  { id: "6", collection_id: "c3", kind: "insight", title: "Switching costs are the real moat in note apps", summary: "Every exported format is a bridge; every proprietary block is a wall. Decomposition: lock-in mechanisms, export rituals, graph portability.", media_url: null, source_kind: "decompose", source_ref: null, depth: 5, causal_role: "driver", tags: ["strategy"], hue: 340, pinned: false, created_at: t(30), _col: "Product strategy" },
  { id: "7", collection_id: "c1", kind: "note", title: "Interleaving > blocking for transfer", summary: "Mixed practice feels worse and works better.", media_url: null, source_kind: "manual", source_ref: null, depth: 2, causal_role: "mechanism", tags: ["learning"], hue: 95, pinned: false, created_at: t(40), _col: "Learning science" },
  { id: "8", collection_id: "c2", kind: "image", title: "Warm terracotta palette pull", summary: null, media_url: "https://picsum.photos/seed/trove3/420/620", source_kind: "image", source_ref: null, depth: 1, causal_role: "context", tags: [], hue: 20, pinned: false, created_at: t(50), _col: "Studio references" },
  { id: "9", collection_id: "c3", kind: "document", title: "Q3 positioning teardown", summary: "Six competitors mapped by altitude: infra, workflow, surface. We win at the seam.", media_url: null, source_kind: "board_sync", source_ref: "libobj:x", depth: 3, causal_role: "condition", tags: ["positioning"], hue: 200, pinned: false, created_at: t(60), _col: "Product strategy" },
];

const PILLS = [
  { emoji: "🧠", name: "Learning science", hue: 16 },
  { emoji: "🎨", name: "Studio references", hue: 286 },
  { emoji: "🧭", name: "Product strategy", hue: 200 },
];

export default function TroveCardsPreflight() {
  return (
    <div className="tr-shell" style={{ minHeight: "100vh" }}>
      <header className="tr-header">
        <span className="tr-logo"><span className="tr-logo-mark">◆</span><span className="tr-logo-word">trove</span></span>
        <nav className="tr-tabs">
          <span className="tr-tab is-active">Library</span>
          <span className="tr-tab">Folders</span>
          <span className="tr-tab">Map</span>
          <span className="tr-tab">Agents</span>
        </nav>
        <div className="tr-search"><input readOnly placeholder="Search your trove" /></div>
        <div className="tr-header-actions">
          <span className="tr-btn-ghost">Re-sync</span>
          <span className="tr-btn-primary">+ Add</span>
        </div>
      </header>
      <main className="tr-main">
        <div className="tr-page">
          <div className="tr-pills">
            {PILLS.map((p) => (
              <button key={p.name} className="tr-pill" style={{ background: hueChip(p.hue) }}>
                <span className="tr-pill-emoji">{p.emoji}</span>
                <span><small>More ideas for</small><strong>{p.name}</strong></span>
              </button>
            ))}
          </div>
          <div className="tr-masonry">
            {SAMPLE.map((n) => (
              <NodeCard key={n.id} node={n} collectionName={n._col} onOpen={() => {}} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Synergy Room AI Dock ──
//
// Bottom-center floating action bar for the shared synergy room.
// Appears when the user has a node selected; offers four AI actions:
//
//   Decompose  → 4 upstream + downstream + first-principles + variations buckets
//   Variations → 4 alternative angles on the selected node
//   Questions  → 4 sharpening questions
//   Research   → 4 research directions (validate/refute/extend/alternative)
//
// Each action calls /api/synergy/augment with the selected node's
// label + a small board context block, then spawns the results into
// the shared room via createRoomNode. Realtime sync propagates the
// new nodes to the other user automatically — they see new cards
// appear in real time, attributed to whoever triggered the AI run.
//
// AI-generated nodes carry a `<<ai>>` prefix in meta so the card
// renderer can show a sparkle icon (see RoomNodeCard in
// synergy-room-canvas.tsx).

"use client";

import { useState } from "react";
import {
  HelpCircle,
  Layers,
  Loader2,
  Search,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { augment } from "@/lib/synergy/client";
import { createRoomNode, type RoomNode, type RoomNodeKind } from "@/lib/synergy/room-client";

interface Props {
  roomId: string;
  selectedNode: RoomNode | null;
  // Anchor positions for context — used to build a richer prompt
  // (so the AI knows what the two matched components are about).
  myAnchor: { label: string; description: string } | null;
  theirAnchor: { label: string; description: string } | null;
  // All current room nodes for the context block.
  roomNodes: RoomNode[];
  // Called for each spawned node so the parent can optimistically
  // merge into local state (realtime will idempotently de-dupe).
  onNodeSpawned: (node: RoomNode) => void;
  // Called to deselect after a successful run.
  onClearSelection: () => void;
  // Hidden when the room is archived (read-only).
  disabled?: boolean;
}

const AI_META_PREFIX = "<<ai>>";

export function SynergyRoomAIDock({
  roomId,
  selectedNode,
  myAnchor,
  theirAnchor,
  roomNodes,
  onNodeSpawned,
  onClearSelection,
  disabled,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  // The dock is only meaningful with a selected node. Render a quieter
  // hint when nothing is selected so the user knows the dock exists.
  if (!selectedNode) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto rounded-full border border-gray-200 bg-white/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gray-500 shadow-sm backdrop-blur">
          Select a card to call the AI together
        </div>
      </div>
    );
  }

  // Context builder: anchors + selected node + the rest of the board
  // labels. Capped at ~60 lines so we don't blow the prompt budget on
  // crowded rooms.
  const buildContext = () => {
    const lines: string[] = [];
    if (myAnchor) {
      lines.push(`MY ANCHOR: ${myAnchor.label} — ${myAnchor.description}`);
    }
    if (theirAnchor) {
      lines.push(`THEIR ANCHOR: ${theirAnchor.label} — ${theirAnchor.description}`);
    }
    lines.push(`SELECTED: ${selectedNode.label}`);
    if (selectedNode.meta && !selectedNode.meta.startsWith(AI_META_PREFIX)) {
      lines.push(`SELECTED meta: ${selectedNode.meta.slice(0, 240)}`);
    }
    const others = roomNodes
      .filter((n) => n.id !== selectedNode.id)
      .slice(-30)
      .map((n) => `[${n.kind}] ${n.label}`);
    if (others.length > 0) {
      lines.push("OTHER NODES:");
      lines.push(...others);
    }
    return lines.join("\n");
  };

  // Spiral-placement helper — same math as the solo whiteboard's
  // placeNear, scoped here so we don't pull a dependency just for
  // this. 4 children per ring, 160px radius from the source node.
  const placeRelative = (i: number, total: number) => {
    const radius = 180;
    const angle = (i / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
    const jitterX = (Math.random() - 0.5) * 24;
    const jitterY = (Math.random() - 0.5) * 24;
    return {
      x: selectedNode.x + Math.cos(angle) * radius + jitterX,
      y: selectedNode.y + Math.sin(angle) * radius + jitterY,
    };
  };

  // Generic spawner — creates a room node for each item, marking it
  // AI-generated via the meta prefix. The realtime channel
  // distributes the inserted row to the other user automatically.
  const spawn = async (
    items: Array<{ label: string; kind: RoomNodeKind; metaInner: string }>,
  ) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const pos = placeRelative(i, items.length);
      try {
        const node = await createRoomNode(roomId, {
          parent_id: selectedNode.id,
          kind: item.kind,
          label: item.label,
          meta: `${AI_META_PREFIX} ${item.metaInner}`,
          x: pos.x,
          y: pos.y,
        });
        onNodeSpawned(node);
      } catch (err) {
        toast.error("Couldn't add AI node", {
          description: (err as Error).message,
        });
      }
    }
  };

  const run = async (mode: "decompose" | "variations" | "questions" | "research") => {
    if (busy || disabled) return;
    setBusy(mode);
    try {
      const res = await augment({
        transcript: selectedNode.label,
        mode,
        context: buildContext(),
      });
      if (res.mode === "decompose") {
        const d = res.result;
        const items: Array<{ label: string; kind: RoomNodeKind; metaInner: string }> = [
          ...d.upstream.map((t) => ({
            label: t,
            kind: "branch" as RoomNodeKind,
            metaInner: "upstream — what this needs",
          })),
          ...d.downstream.map((t) => ({
            label: t,
            kind: "action" as RoomNodeKind,
            metaInner: "downstream — what this produces",
          })),
          ...d.first_principles.map((t) => ({
            label: t,
            kind: "insight" as RoomNodeKind,
            metaInner: "first principle",
          })),
          ...d.variations.map((t) => ({
            label: t,
            kind: "variation" as RoomNodeKind,
            metaInner: "variation",
          })),
        ];
        await spawn(items);
        toast.success(`Decomposed into ${items.length} branches`);
      } else if (res.mode === "variations") {
        const list = res.result.variations ?? [];
        await spawn(
          list.map((v) => ({
            label: v.label,
            kind: "variation" as RoomNodeKind,
            metaInner: v.rationale,
          })),
        );
        toast.success(`${list.length} variations added`);
      } else if (res.mode === "questions") {
        const list = res.result.questions ?? [];
        await spawn(
          list.map((q) => ({
            label: q,
            kind: "question" as RoomNodeKind,
            metaInner: "sharpening question",
          })),
        );
        toast.success(`${list.length} questions added`);
      } else if (res.mode === "research") {
        const list = res.result.directions ?? [];
        await spawn(
          list.map((d) => ({
            label: d.prompt,
            kind: "insight" as RoomNodeKind,
            metaInner: `[${d.angle}] ${d.why}`,
          })),
        );
        toast.success(`${list.length} research directions added`);
      }
      // Optional: clear selection so subsequent clicks don't accidentally
      // re-trigger on the same node. We keep it selected for now so the
      // user can chain multiple modes without re-clicking.
      // onClearSelection();
      void onClearSelection;
    } catch (err) {
      toast.error(`${mode} failed`, { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div
        className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-gray-200 bg-white/95 p-1.5 shadow-xl backdrop-blur"
        style={{
          boxShadow:
            "0 0 30px -8px rgba(6, 182, 212, 0.3), 0 12px 32px -8px rgba(0, 0, 0, 0.15)",
        }}
      >
        <div className="flex items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-600">
          <Sparkles className="h-3 w-3 text-blue-600" />
          <span className="max-w-[180px] truncate">{selectedNode.label}</span>
        </div>
        <div className="mx-0.5 h-5 w-px bg-gray-200" aria-hidden />
        <ActionChip
          icon={Layers}
          label="Decompose"
          busy={busy === "decompose"}
          disabled={!!busy || !!disabled}
          onClick={() => run("decompose")}
        />
        <ActionChip
          icon={Shuffle}
          label="Variations"
          busy={busy === "variations"}
          disabled={!!busy || !!disabled}
          onClick={() => run("variations")}
        />
        <ActionChip
          icon={HelpCircle}
          label="Questions"
          busy={busy === "questions"}
          disabled={!!busy || !!disabled}
          onClick={() => run("questions")}
        />
        <ActionChip
          icon={Search}
          label="Research"
          busy={busy === "research"}
          disabled={!!busy || !!disabled}
          onClick={() => run("research")}
        />
        <div className="mx-0.5 h-5 w-px bg-gray-200" aria-hidden />
        <button
          onClick={onClearSelection}
          disabled={!!busy}
          title="Deselect"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-700"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

// Re-export for the RoomNodeCard to detect AI-generated nodes
export { AI_META_PREFIX };

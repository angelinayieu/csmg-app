"use client";

// ── FavoritesSidebar ──
//
// Replaces the old circular room-nav rail. Lists only the cards the user has
// FAVORITED (heart → meta.favorited) and pans the camera to one on click.
// Hidden entirely until at least one card is favorited. Reactive via tldraw's
// useValue (recomputes when the store changes). Lives inside WhiteboardBase
// so it has the editor + tldraw reactivity.

import { useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { Heart } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

function labelFor(shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  const title =
    (typeof p.title === "string" && p.title) ||
    (typeof p.name === "string" && p.name) ||
    (typeof p.headline === "string" && p.headline) ||
    "";
  if (title) return title.length > 28 ? title.slice(0, 27) + "…" : title;
  if (shape.type === "prompt-sharpening") return "Sharpening";
  if (shape.type === "objective-card") return "Objective";
  return shape.type.replace(/-card$/, "");
}

export function FavoritesSidebar({ editor }: { editor: Editor }) {
  const favorites = useValue(
    "favorited-cards",
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => (s.meta as { favorited?: boolean })?.favorited)
        .map((s) => ({ id: s.id, label: labelFor(s) })),
    [editor],
  );

  if (favorites.length === 0) return null;

  function panTo(id: TLShapeId) {
    const b = editor.getShapePageBounds(id);
    if (b) {
      editor.centerOnPoint(
        { x: b.midX, y: b.midY },
        { animation: { duration: 300 } },
      );
    }
    editor.select(id);
  }

  return (
    <div
      className="fixed left-4 top-1/2 z-[55] -translate-y-1/2"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      <div
        className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-2xl p-2"
        style={{
          background: "rgba(255,255,255,0.92)",
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.card,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          minWidth: 150,
          maxWidth: 200,
        }}
      >
        <div
          className="flex items-center gap-1.5 px-2 pb-1 pt-0.5"
          style={{ color: appleVibe.text.tertiary }}
        >
          <Heart className="h-3 w-3" fill="#F43F5E" style={{ color: "#F43F5E" }} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
            Favorites
          </span>
        </div>
        {favorites.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => panTo(f.id)}
            className="truncate rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-black/[0.04]"
            style={{ color: appleVibe.text.secondary }}
            title={f.label}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

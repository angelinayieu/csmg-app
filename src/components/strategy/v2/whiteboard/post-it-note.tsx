"use client";

import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import type { PostItNote as PostItType, PostItColor } from "@/types/whiteboard";
import { cn } from "@/lib/utils";

const COLOR_BG: Record<PostItColor, string> = {
  yellow: "linear-gradient(180deg, #FEF3B7 0%, #FCE488 100%)",
  pink: "linear-gradient(180deg, #FCE7F3 0%, #FBCFE8 100%)",
  blue: "linear-gradient(180deg, #DBEAFE 0%, #BFDBFE 100%)",
  green: "linear-gradient(180deg, #D1FAE5 0%, #A7F3D0 100%)",
};

const COLOR_BORDER: Record<PostItColor, string> = {
  yellow: "#F59E0B55",
  pink: "#EC489955",
  blue: "#3B82F655",
  green: "#10B98155",
};

interface Props {
  note: PostItType;
  onUpdate: (id: string, patch: Partial<PostItType>) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
}

export function PostItNoteView({ note, onUpdate, onRemove, onDragStart }: Props) {
  const [editing, setEditing] = useState(note.text === "");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [editing]);

  return (
    <div
      data-no-pan
      className="absolute select-none shadow-lg rounded-[6px] transition-shadow duration-150 hover:shadow-xl"
      style={{
        left: note.x,
        top: note.y,
        width: 180,
        minHeight: 130,
        background: COLOR_BG[note.color],
        border: `1px solid ${COLOR_BORDER[note.color]}`,
        transform: "rotate(-0.6deg)",
        zIndex: 25,
        padding: 10,
      }}
    >
      {/* Drag handle — top 18px strip */}
      <div
        onPointerDown={(e) => onDragStart(note.id, e)}
        className="absolute left-0 right-0 top-0 h-4 cursor-grab active:cursor-grabbing"
        style={{ borderTopLeftRadius: 6, borderTopRightRadius: 6 }}
      />
      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(note.id);
        }}
        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-opacity opacity-0 hover:bg-black/10 hover:text-gray-800"
        style={{ opacity: 0.6 }}
        title="Delete"
      >
        <X className="h-3 w-3" />
      </button>

      {/* Color swatches */}
      <div className="absolute bottom-1.5 right-1.5 flex gap-1">
        {(["yellow", "pink", "blue", "green"] as PostItColor[]).map((c) => (
          <button
            key={c}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(note.id, { color: c });
            }}
            className={cn(
              "h-3 w-3 rounded-full transition-transform hover:scale-125",
              note.color === c && "ring-1 ring-gray-600 ring-offset-1"
            )}
            style={{
              background:
                c === "yellow" ? "#FCD34D" :
                c === "pink" ? "#F9A8D4" :
                c === "blue" ? "#93C5FD" :
                "#86EFAC",
            }}
          />
        ))}
      </div>

      {/* Editable text */}
      {editing ? (
        <textarea
          ref={taRef}
          value={note.text}
          onChange={(e) => onUpdate(note.id, { text: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              setEditing(false);
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          placeholder="Write a note…"
          className="w-full h-[92px] resize-none bg-transparent pt-4 pr-4 text-[12.5px] leading-snug text-gray-800 outline-none placeholder-gray-500/60"
          style={{
            fontFamily: "ui-sans-serif, system-ui, -apple-system",
          }}
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          className="w-full h-[92px] overflow-hidden pt-4 pr-4 text-[12.5px] leading-snug text-gray-800 whitespace-pre-wrap cursor-text"
        >
          {note.text || <span className="italic opacity-50">Double-click to edit</span>}
        </div>
      )}
    </div>
  );
}

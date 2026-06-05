"use client";

// ── Cross-room browser ────────────────────────────────────────────────
//
// "Look into content across rooms." A full-screen glass overlay that lists
// every sub-objective ROOM in the space and the items (entities) inside each —
// the rich cross-room content (vs the Library's sparse object Room-axis). Reads
// GET …/cross-room (backed by loadCrossRoomState). Click an item to jump into
// its room (focused). Opened from the Library rail's Room axis; self-contained.

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { X, Search, Loader2, DoorOpen, ChevronRight } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface RoomLite {
  id: string;
  title: string;
  description: string | null;
}
interface ItemLite {
  id: string;
  roomId: string;
  name: string;
  layer: string;
}

// Match the 4-stage palette (pain → features → outcomes → objective).
const LAYER_COLOR: Record<string, string> = {
  pain: appleVibe.stage.pain,
  features: appleVibe.stage.features,
  outcomes: appleVibe.stage.outcomes,
  objective: appleVibe.stage.objective,
};

export function CrossRoomBrowser({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomLite[] | null>(null);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/objective/${spaceId}/cross-room`)
      .then((r) => (r.ok ? r.json() : { rooms: [], items: [] }))
      .then((j) => {
        if (!alive) return;
        setRooms(Array.isArray(j.rooms) ? j.rooms : []);
        setItems(Array.isArray(j.items) ? j.items : []);
      })
      .catch(() => {
        if (alive) {
          setRooms([]);
          setItems([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [spaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byRoom = new Map<string, ItemLite[]>();
    for (const it of items) {
      if (q && !it.name.toLowerCase().includes(q)) continue;
      const arr = byRoom.get(it.roomId);
      if (arr) arr.push(it);
      else byRoom.set(it.roomId, [it]);
    }
    return (rooms ?? [])
      .map((r) => ({ room: r, items: byRoom.get(r.id) ?? [] }))
      .filter(
        (g) => !q || g.items.length > 0 || g.room.title.toLowerCase().includes(q),
      );
  }, [rooms, items, query]);

  const totalItems = items.length;

  function openRoom(roomId: string, itemId?: string) {
    onClose();
    const base = `/app/objective/${spaceId}/sub/${roomId}`;
    router.push(itemId ? `${base}?focus=${itemId}` : base);
  }

  return (
    <div style={overlay} onPointerDown={(e) => e.stopPropagation()}>
      <div style={header}>
        <DoorOpen style={{ width: 16, height: 16, color: appleVibe.text.secondary, flexShrink: 0 }} strokeWidth={2.2} />
        <span style={titleStyle}>Across rooms</span>
        {rooms && (
          <span style={subCount}>
            {rooms.length} room{rooms.length === 1 ? "" : "s"} · {totalItems} item{totalItems === 1 ? "" : "s"}
          </span>
        )}
        <div style={searchBox}>
          <Search style={{ width: 13, height: 13, color: appleVibe.text.tertiary }} strokeWidth={2.2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across rooms…"
            style={searchInput}
          />
        </div>
        <button type="button" title="Close" aria-label="Close" onClick={onClose} style={closeBtn}>
          <X style={{ width: 16, height: 16 }} strokeWidth={2.4} />
        </button>
      </div>

      <div style={scrollBody}>
        {rooms === null ? (
          <div style={emptyRow}>
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} /> Loading rooms…
          </div>
        ) : grouped.length === 0 ? (
          <div style={{ padding: "20px 4px", fontSize: 13, lineHeight: 1.5, color: appleVibe.text.tertiary }}>
            No rooms yet — rooms are the sub-objectives of this space. Add a cut to
            create one, and its content shows up here.
          </div>
        ) : (
          <div style={roomColumns}>
            {grouped.map((g) => (
              <section key={g.room.id} style={roomCard}>
                <button type="button" onClick={() => openRoom(g.room.id)} style={roomHeader}>
                  <span style={roomTitle}>{g.room.title}</span>
                  <span style={roomCountChip}>{g.items.length}</span>
                  <ChevronRight style={{ width: 14, height: 14, color: appleVibe.text.faint, marginLeft: "auto" }} strokeWidth={2.4} />
                </button>
                {g.room.description && <p style={roomDesc}>{g.room.description}</p>}
                <div style={itemList}>
                  {g.items.length === 0 ? (
                    <span style={itemEmpty}>No items yet</span>
                  ) : (
                    g.items.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => openRoom(g.room.id, it.id)}
                        style={itemChip}
                        onMouseEnter={(e) => (e.currentTarget.style.background = appleVibe.surface.chipHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = appleVibe.surface.chip)}
                        title={`Open "${it.name}" in ${g.room.title}`}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: LAYER_COLOR[it.layer] ?? appleVibe.text.faint }} />
                        <span style={itemName}>{it.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── styles ──
const overlay: CSSProperties = {
  position: "absolute",
  inset: 12,
  zIndex: 96, // above the library rail (92)
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  borderRadius: appleVibe.radius.lg,
  background: "var(--glass-float-bg)",
  backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
  border: "1px solid var(--glass-border)",
  boxShadow: "inset 0 1px 0 var(--glass-highlight), 0 28px 60px -24px rgba(11,18,40,0.40)",
  fontFamily: appleVibe.font.stack,
};
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 14px",
  borderBottom: "1px solid var(--glass-border)",
};
const titleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: "-0.01em",
  color: appleVibe.text.primary,
  flexShrink: 0,
};
const subCount: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: appleVibe.text.tertiary,
  flexShrink: 0,
};
const searchBox: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: 1,
  maxWidth: 360,
  marginLeft: "auto",
  padding: "6px 10px",
  borderRadius: appleVibe.radius.md,
  background: appleVibe.surface.chip,
  border: "1px solid var(--glass-border)",
};
const searchInput: CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 12.5,
  width: "100%",
  color: appleVibe.text.primary,
  fontFamily: appleVibe.font.stack,
};
const closeBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: appleVibe.radius.sm,
  border: "none",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  color: appleVibe.text.secondary,
  flexShrink: 0,
};
const scrollBody: CSSProperties = { flex: 1, overflowY: "auto", padding: 14, minHeight: 0 };
const emptyRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "24px 4px", color: appleVibe.text.tertiary, fontSize: 13 };
const roomColumns: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: 12,
  alignItems: "start",
};
const roomCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  borderRadius: appleVibe.radius.md,
  border: "1px solid var(--glass-border)",
  background: appleVibe.surface.card,
  boxShadow: appleVibe.shadow.chip,
  padding: 10,
};
const roomHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "2px 2px 6px",
  fontFamily: appleVibe.font.stack,
};
const roomTitle: CSSProperties = { fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", color: appleVibe.text.primary, textAlign: "left" };
const roomCountChip: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: appleVibe.text.tertiary, background: appleVibe.surface.chip, borderRadius: 999, padding: "1px 7px" };
const roomDesc: CSSProperties = { margin: "0 0 8px", fontSize: 11.5, lineHeight: 1.4, color: appleVibe.text.tertiary };
const itemList: CSSProperties = { display: "flex", flexDirection: "column", gap: 3 };
const itemChip: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "6px 8px",
  borderRadius: appleVibe.radius.sm,
  border: "1px solid transparent",
  background: appleVibe.surface.chip,
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
};
const itemName: CSSProperties = { fontSize: 12, fontWeight: 600, color: appleVibe.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const itemEmpty: CSSProperties = { fontSize: 11, color: appleVibe.text.faint, padding: "2px 2px 4px" };

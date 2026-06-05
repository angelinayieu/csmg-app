// ── Tropical catalog tile + helpers for the Library rail Objects view ──
//
// A square, pastel "feature card" renderer — the tropical library-catalog
// look. Used by ObjectsView (library-rail.tsx) as the TILES display mode;
// the ROWS mode keeps the folder/layer curation chips, so this is purely
// additive. Every object becomes a square tile colored by its shelf's hue,
// with a meaning-matched icon, a sequential catalog number, a serif title,
// and a 2-line clamped summary.
//
// LIGHT THEME ONLY — the palette is the warm/clean tropical set (akiboe),
// NOT the dark `prefers-color-scheme:dark` variant the mockup screenshot
// happened to render in.

import type { CSSProperties } from "react";
import {
  Music,
  Compass,
  Waves,
  LayoutGrid,
  HeartHandshake,
  MessageCircle,
  MessagesSquare,
  Share2,
  Users,
  LogIn,
  Radio,
  Sparkles,
  Target,
  Leaf,
  List,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

/** Editorial serif for the catalog heading + tile titles. System stack — no
 *  web-font dependency; renders crisp on macOS/iOS, degrades to Georgia. */
export const CATALOG_SERIF =
  "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Hoefler Text', Georgia, 'Times New Roman', serif";
const MONO = "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace";

/** The four warm tropical hues, cycled across shelves. `bg` = pastel tile
 *  fill, `tt` = near-black title, `ts` = saturated secondary text, `head` =
 *  saturated accent for the folder dot / header. */
export interface TropicalHue {
  bg: string;
  tt: string;
  ts: string;
  head: string;
}
const TROPICAL: TropicalHue[] = [
  { bg: "#E1F5EE", tt: "#04342C", ts: "#0F6E56", head: "#1D9E75" }, // teal
  { bg: "#EAF3DE", tt: "#173404", ts: "#3B6D11", head: "#639922" }, // green
  { bg: "#FAECE7", tt: "#4A1B0C", ts: "#993C1D", head: "#D85A30" }, // coral
  { bg: "#FAEEDA", tt: "#412402", ts: "#854F0B", head: "#BA7517" }, // amber
];
export function tropicalHue(index: number): TropicalHue {
  const n = TROPICAL.length;
  return TROPICAL[((index % n) + n) % n];
}

const pad3 = (n: number) => String(n).padStart(3, "0");

// Title-keyword → icon. First match wins, so order specific → general.
const ICON_RULES: Array<[RegExp, LucideIcon]> = [
  [/remix|upload|publish|share/, Share2],
  [/chat|room|channel|forum/, MessagesSquare],
  [/messag|\bdm\b|inbox|thread/, MessageCircle],
  [/match|interest|taste|twin|pairing/, HeartHandshake],
  [/recommend|music|track|song|audio|playlist|tune/, Music],
  [/brows|explore|discover|surface|search|feed/, Compass],
  [/mood|vibe|flow|wave|sync|tempo|energy/, Waves],
  [/categor|tag|grid|catalog|library|\bset\b/, LayoutGrid],
  [/login|auth|sign-?in|account|onboard|cold-?start/, LogIn],
  [/live|broadcast|real-?time|co-?listen|stream/, Radio],
  [/user|social|people|community|connect/, Users],
];

/** A cute, meaning-matched icon for an object. Variables + insights get a
 *  type icon; features get a keyword match (Leaf is the friendly fallback). */
export function iconForObject(title: string, type?: string): LucideIcon {
  const t = (type ?? "").toLowerCase();
  if (t === "variable") return Target;
  if (t === "insight" || t === "recommendation") return Sparkles;
  const hay = (title ?? "").toLowerCase();
  for (const [re, Icon] of ICON_RULES) if (re.test(hay)) return Icon;
  return Leaf;
}

/** Minimal shape the tile needs — structurally satisfied by the rail's
 *  LibObject (and anything else carrying these fields). */
export interface CatalogTileObject {
  id: string;
  title: string;
  type: string;
  summary: string;
  onWhiteboard?: boolean;
}

const tileBase: CSSProperties = {
  position: "relative",
  width: "100%",
  minHeight: 116,
  borderRadius: 16,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  textAlign: "left",
  border: "0.5px solid rgba(15,23,42,0.05)",
  cursor: "pointer",
  fontFamily: appleVibe.font.stack,
  transition: "transform .12s ease, box-shadow .12s ease, max-height .2s ease",
  boxShadow: "0 1px 2px rgba(11,18,40,0.05)",
};

const clampN = (lines: number, extra: CSSProperties = {}): CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
  overflow: "hidden",
  ...extra,
});

export function CatalogTile({
  obj,
  number,
  hueIndex,
  onOpen,
  onArchive,
  childCount = 0,
}: {
  obj: CatalogTileObject;
  number: number;
  hueIndex: number;
  onOpen: () => void;
  onArchive?: () => void;
  /** If > 0, renders a "+N steps" chip indicating nested children. */
  childCount?: number;
}) {
  const pal = tropicalHue(hueIndex);
  const Icon = iconForObject(obj.title, obj.type);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open "${obj.title}"`}
      style={{ ...tileBase, background: pal.bg }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 10px 22px -12px rgba(11,18,40,0.28)";
        // Pop description on hover — full text via the data attribute.
        const desc = e.currentTarget.querySelector<HTMLElement>("[data-tile-desc]");
        if (desc) desc.style.webkitLineClamp = "12";
        const arch = e.currentTarget.querySelector<HTMLElement>("[data-tile-archive]");
        if (arch) arch.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(11,18,40,0.05)";
        const desc = e.currentTarget.querySelector<HTMLElement>("[data-tile-desc]");
        if (desc) desc.style.webkitLineClamp = "4";
        const arch = e.currentTarget.querySelector<HTMLElement>("[data-tile-archive]");
        if (arch) arch.style.opacity = "0";
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Icon style={{ width: 17, height: 17, color: pal.tt, flexShrink: 0 }} strokeWidth={1.9} />
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {onArchive && (
            <span
              data-tile-archive
              role="button"
              aria-label="Archive"
              title="Archive"
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
              style={{
                width: 18,
                height: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background: "rgba(255,255,255,0.7)",
                color: pal.ts,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                cursor: "pointer",
                opacity: 0,
                transition: "opacity .14s ease",
              }}
            >
              ×
            </span>
          )}
          {obj.onWhiteboard && (
            <span style={{ width: 6, height: 6, borderRadius: 999, background: pal.head }} title="On the board" />
          )}
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.03em", color: pal.ts, opacity: 0.9 }}>
            {pad3(number)}
          </span>
        </span>
      </span>
      <span style={clampN(2, { fontFamily: CATALOG_SERIF, fontSize: 14.5, lineHeight: 1.2, fontWeight: 600, color: pal.tt })}>
        {obj.title}
      </span>
      {obj.summary && (
        <span
          data-tile-desc
          style={clampN(4, {
            marginTop: 5,
            fontSize: 11.5,
            lineHeight: 1.38,
            color: pal.ts,
            transition: "webkit-line-clamp .2s ease",
          })}
        >
          {obj.summary}
        </span>
      )}
      {childCount > 0 && (
        <span
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 4,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.6)",
            color: pal.ts,
            letterSpacing: "0.02em",
          }}
        >
          +{childCount} step{childCount === 1 ? "" : "s"}
        </span>
      )}
    </button>
  );
}

/** 2-col square grid wrapper for a shelf's tiles. */
export const catalogGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  padding: "2px 2px 4px",
};

/** A shelf header for the catalog: a frosted, hue-tinted glass pill that
 *  matches the tropical tiles below it — serif label, accent-glow dot, soft
 *  fully-rounded shape, collapse chevron. `hue` null → neutral (Unfiled /
 *  Unlayered). Left-aligned to the tile grid so the column reads straight. */
export function CatalogShelfHeader({
  label,
  count,
  collapsed,
  onToggle,
  hue,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  hue: TropicalHue | null;
}) {
  const accent = hue ? hue.head : "#94A3B8";
  const tint = hue ? hue.bg : "#EEF1F4";
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const restShadow = "0 1px 0 rgba(255,255,255,0.9) inset, 0 6px 16px -10px rgba(11,18,40,0.20)";
  const pill: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 12px 5px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.6)",
    background: `linear-gradient(180deg, ${tint}99 0%, rgba(255,255,255,0.55) 100%)`,
    backdropFilter: "blur(10px) saturate(150%)",
    WebkitBackdropFilter: "blur(10px) saturate(150%)",
    boxShadow: restShadow,
    cursor: "pointer",
    transition: "box-shadow .14s ease",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 2px 4px" }}>
      <button
        type="button"
        onClick={onToggle}
        style={pill}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = `0 1px 0 rgba(255,255,255,0.95) inset, 0 8px 20px -10px ${accent}80`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = restShadow;
        }}
      >
        <Chevron style={{ width: 12, height: 12, color: "#64748B", flexShrink: 0 }} strokeWidth={2.4} />
        <span style={{ width: 7, height: 7, borderRadius: 999, background: accent, boxShadow: `0 0 0 3px ${accent}22`, flexShrink: 0 }} />
        <span style={{ fontFamily: CATALOG_SERIF, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", color: "#0F172A" }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: "#94A3B8", marginLeft: 1 }}>{count}</span>
      </button>
    </div>
  );
}

/** Tiny segmented Rows⇄Tiles switch for the Objects toolbar. Self-styled so
 *  it has no dependency on the rail's private style consts. */
export function DisplayToggle({
  tiles,
  onChange,
}: {
  tiles: boolean;
  onChange: (tiles: boolean) => void;
}) {
  const wrap: CSSProperties = {
    display: "flex",
    gap: 2,
    padding: 2,
    borderRadius: appleVibe.radius.pill,
    background: appleVibe.surface.chip,
    flexShrink: 0,
  };
  const btn = (active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 24,
    borderRadius: appleVibe.radius.pill,
    border: "none",
    cursor: "pointer",
    color: active ? appleVibe.text.onAccent : appleVibe.text.tertiary,
    background: active ? appleVibe.accent.primary : "transparent",
  });
  return (
    <div style={wrap} role="group" aria-label="Display mode">
      <button type="button" style={btn(tiles)} onClick={() => onChange(true)} title="Tile view" aria-pressed={tiles}>
        <LayoutGrid style={{ width: 13, height: 13 }} strokeWidth={2.2} />
      </button>
      <button type="button" style={btn(!tiles)} onClick={() => onChange(false)} title="List view" aria-pressed={!tiles}>
        <List style={{ width: 13, height: 13 }} strokeWidth={2.2} />
      </button>
    </div>
  );
}

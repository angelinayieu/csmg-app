// Preview of the redesigned Library-rail Objects view — the tropical
// "catalog" of square feature tiles (CatalogTile), grouped into subsystem
// shelves exactly as the Folder axis renders them. Uses the REAL feature
// titles + rewritten summaries from the music-app space so the look can be
// judged as it will ship. Light theme.
//
// SAFE TO DELETE — exploration. Route: /preflight/catalog-tiles

"use client";

import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  CatalogTile,
  CatalogShelfHeader,
  catalogGrid,
  tropicalHue,
  CATALOG_SERIF,
} from "@/components/objective/canvas-interactions/catalog-tile";

interface F {
  id: string;
  title: string;
  summary: string;
  type: string;
  subsystem: string | null;
  onWhiteboard?: boolean;
}

// Real rows from space 590dbd23 (feature object_type), with the new
// action-led summaries.
const FEATURES: F[] = [
  { id: "1", type: "feature", subsystem: "Discovery Surface", title: "Task-Based Browsing", summary: "Filter the library by a lifestyle task to see only playlists tagged for that moment." },
  { id: "2", type: "feature", subsystem: "Discovery Surface", title: "Flow Mood Selection", summary: "Tap a vibe — chill, hype, or focused — to re-rank a task's tracks to your energy." },
  { id: "3", type: "feature", subsystem: "Discovery Surface", title: "Core Task Categories", summary: "Pick from curated lifestyle tasks or add a custom sub-tag of your own." },
  { id: "4", type: "feature", subsystem: "Social Interaction", title: "Interest-Based Matching", summary: "Get a ranked list of listeners whose taste and current activity line up with yours.", onWhiteboard: true },
  { id: "5", type: "feature", subsystem: "Social Interaction", title: "In-App Messaging", summary: "Open a thread from any profile to chat one-to-one without leaving the app." },
  { id: "6", type: "feature", subsystem: "Social Interaction", title: "Public Chat Rooms", summary: "Drop into a genre- or task-themed channel to talk live with co-listeners." },
  { id: "7", type: "feature", subsystem: "Music Discovery", title: "Task-Based Music Recommendation", summary: "Pick what you're doing and get tracks tuned to that activity's focus demands." },
  { id: "8", type: "feature", subsystem: "Music Discovery", title: "Remix Sharing Platform", summary: "Upload a remix to publish it to the community feed for others to play and remix." },
  { id: "9", type: "feature", subsystem: "User Interaction", title: "Live Co-Listening Rooms", summary: "Press play together with a matched listener and chat over the track in real time." },
  { id: "10", type: "feature", subsystem: "User Matching", title: "Hybrid Matching Algorithm", summary: "Scores each candidate on taste, current task, and recent plays to rank who fits best." },
  { id: "11", type: "feature", subsystem: "User Onboarding", title: "One-Tap Social Login", summary: "Tap once with Google or Apple to unlock the chat and matching features behind it." },
  { id: "12", type: "feature", subsystem: null, title: "Task-State Broadcasting", summary: "Your current track quietly signals your focus or energy to nearby listeners." },
  { id: "13", type: "feature", subsystem: null, title: "Anonymous Cold-Start Loop", summary: "Learn from account-free listeners' plays to seed recommendations before anyone signs in." },
  { id: "14", type: "feature", subsystem: null, title: "Live Listening Synchronicity", summary: "Strangers hear the same track at the same instant, turning playback into shared presence." },
];

const FOLDER_DOT = "#0F6E56";

// Group + sort like ObjectsView's folder axis: by count desc, then name,
// with Unfiled forced last.
function shelves(items: F[]) {
  const m = new Map<string, F[]>();
  for (const o of items) {
    const k = o.subsystem || "__unfiled";
    (m.get(k) ?? m.set(k, []).get(k)!).push(o);
  }
  return Array.from(m.entries())
    .sort((a, b) => {
      if (a[0] === "__unfiled") return 1;
      if (b[0] === "__unfiled") return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0]);
    })
    .map(([key, list]) => ({
      key,
      label: key === "__unfiled" ? "Unfiled" : key,
      items: list,
    }));
}

export default function CatalogTilesPreflight() {
  const groups = shelves(FEATURES);
  let running = 0;

  return (
    <div style={{ minHeight: "100vh", background: "#EDEEF0", padding: 40, display: "flex", gap: 40, alignItems: "flex-start", justifyContent: "center", fontFamily: appleVibe.font.stack }}>
      {/* The rail panel */}
      <div style={{ width: 360, flexShrink: 0, background: appleVibe.surface.base, borderRadius: 20, border: `0.5px solid ${appleVibe.stroke.soft}`, boxShadow: appleVibe.shadow.card, overflow: "hidden" }}>
        {/* tabs mock */}
        <div style={{ padding: "12px 12px 0" }}>
          <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 999, background: appleVibe.surface.chip, width: "max-content" }}>
            {["Objects", "Artifacts", "Glossary"].map((t, i) => (
              <span key={t} style={{ fontSize: 12, fontWeight: 650, padding: "5px 12px", borderRadius: 999, color: i === 0 ? appleVibe.text.onAccent : appleVibe.text.secondary, background: i === 0 ? appleVibe.accent.primary : "transparent" }}>{t}</span>
            ))}
          </div>
        </div>

        {/* toolbar mock (axis seg + display toggle) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px 6px" }}>
          <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 999, background: appleVibe.surface.chip }}>
            {["Folder", "Layer", "Type"].map((t, i) => (
              <span key={t} style={{ fontSize: 11, fontWeight: 650, padding: "4px 9px", borderRadius: 999, color: i === 0 ? appleVibe.text.onAccent : appleVibe.text.secondary, background: i === 0 ? appleVibe.accent.primary : "transparent" }}>{t}</span>
            ))}
          </div>
        </div>

        {/* catalog heading */}
        <div style={{ padding: "2px 12px 0" }}>
          <div style={{ fontFamily: CATALOG_SERIF, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", color: appleVibe.text.primary }}>The catalog</div>
        </div>
        <div style={{ padding: "0 12px 6px", fontSize: 11, fontWeight: 600, color: appleVibe.text.tertiary }}>
          {FEATURES.length} objects · {FEATURES.length} features
          <span style={{ marginLeft: 8, color: appleVibe.text.faint, fontWeight: 500 }}>· node-link map coming</span>
        </div>

        {/* shelves */}
        <div style={{ padding: "0 12px 16px" }}>
          {groups.map((shelf, shelfIdx) => {
            const start = running;
            running += shelf.items.length;
            const hue = tropicalHue(shelfIdx);
            return (
              <div key={shelf.key} style={{ marginBottom: 8 }}>
                {/* frosted hue-tinted glass shelf header (same component the rail uses) */}
                <CatalogShelfHeader
                  label={shelf.label}
                  count={shelf.items.length}
                  collapsed={false}
                  onToggle={() => {}}
                  hue={shelf.key === "__unfiled" ? null : hue}
                />
                <div style={catalogGrid}>
                  {shelf.items.map((o, i) => (
                    <CatalogTile key={o.id} obj={o} number={start + i + 1} hueIndex={shelfIdx} onOpen={() => {}} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ maxWidth: 240, fontSize: 13, lineHeight: 1.5, color: "#334155" }}>
        <div style={{ fontFamily: CATALOG_SERIF, fontSize: 20, marginBottom: 8 }}>Catalog tiles</div>
        Square tropical feature tiles, light theme. Hues cycle teal → green → coral → amber per subsystem shelf. Icon is keyword-matched; number is the running catalog index; title is serif; summary clamps to 2 lines.
      </div>
    </div>
  );
}

"use client";

// Trove chrome — Pinterest-style header: wordmark, pill tabs, big rounded
// search, add button. Toast host lives here too so every tab gets them.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrove } from "../_lib/store";
import { IngestComposer } from "./composer";

const TABS = [
  { href: "/trove", label: "Library" },
  { href: "/trove/files", label: "Folders" },
  { href: "/trove/map", label: "Map" },
  { href: "/trove/agents", label: "Agents" },
];

export function TroveChrome() {
  const pathname = usePathname();
  const { searchQuery, setSearchQuery, setComposerOpen, busy, syncSpaces, nodes } = useTrove();

  return (
    <header className="tr-header">
      <Link href="/trove" className="tr-logo" aria-label="Trove home">
        <span className="tr-logo-mark">◆</span>
        <span className="tr-logo-word">trove</span>
      </Link>
      <nav className="tr-tabs">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={t.href} className={`tr-tab${active ? " is-active" : ""}`}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="tr-search">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="13.5" y1="13.5" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search your trove"
          aria-label="Search your trove"
        />
      </div>
      <div className="tr-header-actions">
        <button
          className="tr-btn-ghost"
          onClick={() => void syncSpaces()}
          disabled={busy === "sync"}
          title="Import what you've already built on your boards"
        >
          {busy === "sync" ? "Syncing…" : nodes.length ? "Re-sync" : "Sync boards"}
        </button>
        <button className="tr-btn-primary" onClick={() => setComposerOpen(true)}>
          + Add
        </button>
        <Link href="/app" className="tr-btn-ghost" title="Back to the studio">
          Studio
        </Link>
      </div>
    </header>
  );
}

export function TroveToastHost() {
  const { toasts } = useTrove();
  if (!toasts.length) return null;
  return (
    <div className="tr-toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`tr-toast tr-toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function TroveOverlays() {
  return (
    <>
      <IngestComposer />
      <TroveToastHost />
    </>
  );
}

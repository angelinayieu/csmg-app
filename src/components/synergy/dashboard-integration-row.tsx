// ── Dashboard integration row ──
//
// The "Apps" affordance inside the chatbox. Five inline integration
// logos hint at the breadth of providers the user can connect; a
// trailing "•••" button opens the full catalog popover with all 22.
//
// Every entry is marked "coming_soon" today — clicking the catalog
// surfaces a soft "Coming soon" line per row. The UI is intentionally
// preserved (rather than hidden) so the chatbox feels as capable as
// the legacy home, even before OAuth lands.

"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import {
  AirtableLogo,
  ArxivLogo,
  ChatGPTLogo,
  ClaudeOpusLogo,
  DropboxLogo,
  FigmaLogo,
  GeminiLogo,
  GitHubLogo,
  GmailLogo,
  GoogleCalendarLogo,
  GoogleDocsLogo,
  GoogleDriveLogo,
  GoogleScholarLogo,
  GoogleSheetsLogo,
  JiraLogo,
  LinearLogo,
  NotionLogo,
  SemanticScholarLogo,
  SlackLogo,
  TeamsLogo,
  WebSearchLogo,
  WikipediaLogo,
} from "@/components/entity/integration-logos";

interface Integration {
  id: string;
  label: string;
  Logo: React.ComponentType;
}

const INTEGRATIONS: Integration[] = [
  { id: "notion", label: "Notion", Logo: NotionLogo },
  { id: "drive", label: "Google Drive", Logo: GoogleDriveLogo },
  { id: "slack", label: "Slack", Logo: SlackLogo },
  { id: "figma", label: "Figma", Logo: FigmaLogo },
  { id: "github", label: "GitHub", Logo: GitHubLogo },
  { id: "docs", label: "Google Docs", Logo: GoogleDocsLogo },
  { id: "sheets", label: "Google Sheets", Logo: GoogleSheetsLogo },
  { id: "calendar", label: "Google Calendar", Logo: GoogleCalendarLogo },
  { id: "gmail", label: "Gmail", Logo: GmailLogo },
  { id: "airtable", label: "Airtable", Logo: AirtableLogo },
  { id: "dropbox", label: "Dropbox", Logo: DropboxLogo },
  { id: "linear", label: "Linear", Logo: LinearLogo },
  { id: "jira", label: "Jira", Logo: JiraLogo },
  { id: "teams", label: "Microsoft Teams", Logo: TeamsLogo },
  { id: "arxiv", label: "arXiv", Logo: ArxivLogo },
  { id: "semantic", label: "Semantic Scholar", Logo: SemanticScholarLogo },
  { id: "scholar", label: "Google Scholar", Logo: GoogleScholarLogo },
  { id: "wikipedia", label: "Wikipedia", Logo: WikipediaLogo },
  { id: "web", label: "Web Search", Logo: WebSearchLogo },
  { id: "claude", label: "Claude", Logo: ClaudeOpusLogo },
  { id: "chatgpt", label: "ChatGPT", Logo: ChatGPTLogo },
  { id: "gemini", label: "Gemini", Logo: GeminiLogo },
];

const INLINE_IDS = ["notion", "drive", "slack", "figma", "github"];

export function DashboardIntegrationRow() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on outside click + ESC.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const inline = INLINE_IDS.map((id) => INTEGRATIONS.find((i) => i.id === id)).filter(
    (i): i is Integration => Boolean(i),
  );

  return (
    <div className="relative" ref={popoverRef}>
      <div className="flex items-center gap-1">
        {inline.map((i) => {
          const Logo = i.Logo;
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => setOpen(true)}
              title={`${i.label} · coming soon`}
              aria-label={`${i.label} · coming soon`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/70 transition hover:scale-[1.08] hover:bg-white"
              style={{
                boxShadow:
                  "inset 0 0 0 1px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15,23,42,0.05)",
              }}
            >
              <span className="block h-[16px] w-[16px] [&>svg]:!h-[16px] [&>svg]:!w-[16px]">
                <Logo />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="More integrations"
          aria-label="More integrations"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/70 text-gray-500 transition hover:scale-[1.08] hover:bg-white hover:text-gray-700"
          style={{
            boxShadow:
              "inset 0 0 0 1px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15,23,42,0.05)",
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Connect an app"
          className="absolute bottom-full left-0 z-30 mb-2 w-[320px] rounded-2xl p-3"
          style={{
            background: "rgba(255, 255, 255, 0.88)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.7)",
            boxShadow: [
              "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
              "0 18px 40px -12px rgba(15, 23, 42, 0.22)",
            ].join(", "),
            animation: "dashIntPopIn 180ms ease both",
          }}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Connect an app
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700"
              aria-label="Close"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid max-h-[280px] grid-cols-3 gap-1.5 overflow-y-auto pr-1">
            {INTEGRATIONS.map((i) => {
              const Logo = i.Logo;
              return (
                <button
                  key={i.id}
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-gray-50"
                  title={`${i.label} · coming soon`}
                  aria-label={`${i.label} · coming soon`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center [&>svg]:!h-[18px] [&>svg]:!w-[18px]">
                    <Logo />
                  </span>
                  <span className="truncate text-[11px] text-gray-700">
                    {i.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[10px] leading-snug text-gray-500">
            All integrations are coming soon. The full OAuth surface
            unlocks shortly — your prompt history is portable in the
            meantime.
          </p>
        </div>
      )}

      <style jsx>{`
        @keyframes dashIntPopIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

"use client";

/* SVG logo components for each integration — inline, no external images */

export function ResearchAgentLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <defs><linearGradient id="ra-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2d8cff"/><stop offset="100%" stopColor="#0051ff"/></linearGradient></defs>
      <circle cx="12" cy="12" r="10" fill="url(#ra-grad)"/>
      <circle cx="12" cy="12" r="3" fill="white"/>
      <circle cx="12" cy="12" r="1.2" fill="#0051ff"/>
      <path d="M12 4 L12 7 M12 17 L12 20 M4 12 L7 12 M17 12 L20 12" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

export function ArxivLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#b31b1b"/>
      <text x="12" y="16.5" textAnchor="middle" fontFamily="Georgia, serif" fontSize="11" fontWeight="700" fontStyle="italic" fill="white">χ</text>
    </svg>
  );
}

export function SemanticScholarLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#1857b6"/>
      <circle cx="8" cy="9" r="1.6" fill="white"/><circle cx="16" cy="9" r="1.6" fill="white"/><circle cx="12" cy="16" r="1.6" fill="white"/>
      <path d="M8 9 L12 16 M16 9 L12 16 M8 9 L16 9" stroke="white" strokeWidth="1.3"/>
    </svg>
  );
}

export function GoogleScholarLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M12 3 L22 9 L12 15 L2 9 Z" fill="#4285f4"/>
      <path d="M6 12 V16 a6 4 0 0 0 12 0 V12" fill="none" stroke="#4285f4" strokeWidth="1.8"/>
    </svg>
  );
}

export function WikipediaLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#ffffff" stroke="#0a1020" strokeWidth="1"/>
      <text x="12" y="17" textAnchor="middle" fontFamily="serif" fontSize="14" fontWeight="700" fill="#0a1020">W</text>
    </svg>
  );
}

export function WebSearchLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <circle cx="11" cy="11" r="7" fill="none" stroke="#1a9553" strokeWidth="2.4"/>
      <path d="M21 21 L16 16" stroke="#1a9553" strokeWidth="2.4" strokeLinecap="round"/>
    </svg>
  );
}

export function ClaudeOpusLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#d97757"/>
      <path d="M7 16 L10 8 H11 L14 16 H12.5 L11.8 14 H9.2 L8.5 16 Z M9.7 12.5 H11.3 L10.5 10 Z" fill="white"/>
      <path d="M14 16 L17 8 H18 L15 16 Z" fill="white"/>
    </svg>
  );
}

export function ChatGPTLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <circle cx="12" cy="12" r="10" fill="#10a37f"/>
      <path d="M12 5 L15.5 7 V11 L12 13 L8.5 11 V7 Z M12 11 L15.5 13 V17 L12 19 L8.5 17 V13 Z" fill="none" stroke="white" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}

export function GeminiLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <defs><linearGradient id="gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4fa3ff"/><stop offset="50%" stopColor="#a65fff"/><stop offset="100%" stopColor="#ff6060"/></linearGradient></defs>
      <path d="M12 3 C13 8 16 11 21 12 C16 13 13 16 12 21 C11 16 8 13 3 12 C8 11 11 8 12 3 Z" fill="url(#gem)"/>
    </svg>
  );
}

export function GmailLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="5" width="20" height="14" rx="2" fill="white" stroke="#e5e7eb" strokeWidth="0.5"/>
      <path d="M2 19 V9 L4 7 V19 Z" fill="#4285f4"/><path d="M22 19 V9 L20 7 V19 Z" fill="#34a853"/>
      <path d="M12 14 L2 7 V9 L12 15.5 L22 9 V7 Z" fill="#ea4335"/><path d="M12 14 L12 16 L22 9 V7 Z" fill="#fbbc04"/>
    </svg>
  );
}

export function GoogleCalendarLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="3" y="4" width="18" height="18" rx="2.5" fill="white" stroke="#e5e7eb" strokeWidth="0.5"/>
      <rect x="3" y="4" width="18" height="4" rx="2.5" fill="#4285f4"/>
      <text x="12" y="18" textAnchor="middle" fontFamily="-apple-system, sans-serif" fontSize="8" fontWeight="700" fill="#4285f4">23</text>
      <rect x="6" y="2" width="1.5" height="4" rx="0.5" fill="#4285f4"/><rect x="16.5" y="2" width="1.5" height="4" rx="0.5" fill="#4285f4"/>
    </svg>
  );
}

export function GoogleDriveLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M8 3 L16 3 L22 13 L18 20 L10 20 Z" fill="#fbbc04"/>
      <path d="M8 3 L2 13 L6 20 L12 20 L14 13 Z" fill="#0f9d58"/>
      <path d="M10 20 L18 20 L22 13 L14 13 Z" fill="#4285f4"/>
    </svg>
  );
}

export function GoogleDocsLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M7 2 H14 L19 7 V21 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 V3 a1 1 0 0 1 1 -1 Z" fill="#4285f4"/>
      <path d="M14 2 V7 H19 Z" fill="#a8c7fa"/>
      <rect x="8" y="11" width="8" height="1.2" rx="0.6" fill="white"/><rect x="8" y="14" width="8" height="1.2" rx="0.6" fill="white"/><rect x="8" y="17" width="5" height="1.2" rx="0.6" fill="white"/>
    </svg>
  );
}

export function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="4" y="9.5" width="6" height="2.8" rx="1.4" fill="#36c5f0"/>
      <rect x="9.5" y="14" width="2.8" height="6" rx="1.4" fill="#2eb67d"/>
      <rect x="14" y="11.7" width="6" height="2.8" rx="1.4" fill="#ecb22e"/>
      <rect x="11.7" y="4" width="2.8" height="6" rx="1.4" fill="#e01e5a"/>
    </svg>
  );
}

export function TeamsLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="5" width="14" height="14" rx="2" fill="#5059c9"/>
      <text x="9" y="15" textAnchor="middle" fontFamily="-apple-system, sans-serif" fontSize="10" fontWeight="700" fill="white">T</text>
      <circle cx="19" cy="9" r="3" fill="#5059c9"/><circle cx="19" cy="9" r="1.4" fill="white"/>
    </svg>
  );
}

export function NotionLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="3" y="3" width="18" height="18" rx="2.5" fill="white" stroke="#0a1020" strokeWidth="0.6"/>
      <text x="12" y="17" textAnchor="middle" fontFamily="-apple-system, sans-serif" fontSize="14" fontWeight="800" fill="#0a1020">N</text>
    </svg>
  );
}

export function FigmaLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M9 3 h3 v6 h-3 a3 3 0 1 1 0 -6 Z" fill="#f24e1e"/>
      <path d="M12 3 h3 a3 3 0 1 1 0 6 h-3 Z" fill="#ff7262"/>
      <path d="M9 9 h3 v6 h-3 a3 3 0 1 1 0 -6 Z" fill="#a259ff"/>
      <path d="M12 9 a3 3 0 1 1 0 6 a3 3 0 1 1 0 -6 Z" fill="#1abcfe"/>
      <path d="M9 15 h3 v3 a3 3 0 1 1 -3 -3 Z" fill="#0acf83"/>
    </svg>
  );
}

export function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <circle cx="12" cy="12" r="10" fill="#0a1020"/>
      <path d="M12 5.5 c-3.5 0-6.3 2.8-6.3 6.3 0 2.8 1.8 5.1 4.3 6 0.3 0.1 0.4-0.1 0.4-0.3 v-1.1 c-1.8 0.4-2.1-0.8-2.1-0.8-0.3-0.7-0.7-0.9-0.7-0.9-0.6-0.4 0-0.4 0-0.4 0.6 0 1 0.7 1 0.7 0.6 1 1.5 0.7 1.9 0.5 0.1-0.4 0.2-0.7 0.4-0.9-1.4-0.2-2.9-0.7-2.9-3.2 0-0.7 0.3-1.3 0.7-1.7-0.1-0.2-0.3-0.9 0.1-1.8 0 0 0.6-0.2 1.8 0.7 0.5-0.1 1.1-0.2 1.6-0.2 0.5 0 1.1 0.1 1.6 0.2 1.2-0.8 1.8-0.7 1.8-0.7 0.4 0.9 0.1 1.6 0.1 1.8 0.4 0.5 0.7 1 0.7 1.7 0 2.5-1.5 3-2.9 3.2 0.2 0.2 0.4 0.6 0.4 1.2 v1.8 c0 0.2 0.1 0.4 0.4 0.3 2.5-0.9 4.3-3.2 4.3-6 0-3.5-2.8-6.3-6.3-6.3 Z" fill="white"/>
    </svg>
  );
}

export function LinearLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#5e6ad2"/>
      <path d="M5 13 L11 19 M5 9 L15 19 M5 5 L19 19 M9 5 L19 15 M13 5 L19 11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function JiraLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M12 2 L22 12 L17 17 L12 12 Z" fill="#2684ff"/>
      <path d="M12 7 L17 12 L12 17 L7 12 Z" fill="#0052cc" opacity="0.9"/>
      <path d="M12 12 L7 17 L2 22 L12 22 Z" fill="#0052cc"/>
    </svg>
  );
}

export function GoogleSheetsLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M7 2 H14 L19 7 V21 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1 -1 V3 a1 1 0 0 1 1 -1 Z" fill="#0f9d58"/>
      <path d="M14 2 V7 H19 Z" fill="#87ceac"/>
      <rect x="8" y="10" width="8" height="8" rx="0.6" fill="none" stroke="white" strokeWidth="1"/>
      <path d="M8 13 H16 M8 16 H16 M11 10 V18 M14 10 V18" stroke="white" strokeWidth="0.9"/>
    </svg>
  );
}

export function AirtableLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M12 3 L2 7 L12 11 L22 7 Z" fill="#fcb400"/>
      <path d="M2 8.5 V17 L11 21 V12.5 Z" fill="#18bfff"/>
      <path d="M22 8.5 V17 L13 21 V12.5 Z" fill="#f82b60"/>
    </svg>
  );
}

export function DropboxLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]">
      <path d="M6 4 L12 8 L6 12 L0 8 Z" transform="translate(3 2)" fill="#0061fe"/>
      <path d="M18 4 L24 8 L18 12 L12 8 Z" transform="translate(-3 2)" fill="#0061fe"/>
      <path d="M3 13 L9 17 L15 13 L9 9 Z" transform="translate(3 2)" fill="#0061fe"/>
    </svg>
  );
}

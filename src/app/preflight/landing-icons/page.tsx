// Visual review for the Phase-1 custom landing icon set (the Airbnb-style
// unique line icons replacing generic lucide on the V2 landing card chips).
// Shows new-vs-current at chip + enlarged sizes, then the real card chips
// in context (per template, accent-tinted) via the actual CardDecomposition.
//
// SAFE TO DELETE — review surface only. Route: /preflight/landing-icons
// Spec: LANDING_ICONS_PREFLIGHT_PLAN.md

"use client";

import {
  StickyNote,
  Mic,
  Image as ImageIcon,
  FileText,
  Link as LinkIcon,
  Table,
  Network,
  type LucideIcon,
} from "lucide-react";
import {
  NotesIcon,
  VoiceIcon,
  PhotosIcon,
  PdfIcon,
  LinksIcon,
  DatasetsIcon,
  PatternMapIcon,
  ConceptMapIcon,
  HypothesisMapIcon,
  CauseMapIcon,
  SkillGapMapIcon,
  type LandingIcon,
} from "@/components/landing/landing-icons";
import { CardDecomposition } from "@/components/landing/card-decomposition";

const INK = "#0B0B0C";

const TEMPLATES = [
  { id: "journal_self_discovery", name: "Self-Discovery Journal", accent: "#d97706" },
  { id: "reading_synthesis", name: "Reading Notes", accent: "#0891b2" },
  { id: "research_project", name: "Research Project", accent: "#5856d6" },
  { id: "team_retro", name: "Retrospective", accent: "#ea580c" },
  { id: "career_pivot", name: "Career Pivot", accent: "#16a34a" },
];

const COMPARISON: {
  label: string;
  group: "input" | "map";
  New: LandingIcon;
  Old: LucideIcon;
}[] = [
  { label: "Notes", group: "input", New: NotesIcon, Old: StickyNote },
  { label: "Voice", group: "input", New: VoiceIcon, Old: Mic },
  { label: "Photos", group: "input", New: PhotosIcon, Old: ImageIcon },
  { label: "PDFs", group: "input", New: PdfIcon, Old: FileText },
  { label: "Links", group: "input", New: LinksIcon, Old: LinkIcon },
  { label: "Datasets", group: "input", New: DatasetsIcon, Old: Table },
  { label: "Pattern Map", group: "map", New: PatternMapIcon, Old: Network },
  { label: "Concept Map", group: "map", New: ConceptMapIcon, Old: Network },
  { label: "Hypothesis Map", group: "map", New: HypothesisMapIcon, Old: Network },
  { label: "Cause Map", group: "map", New: CauseMapIcon, Old: Network },
  { label: "Skill-Gap Map", group: "map", New: SkillGapMapIcon, Old: Network },
];

const ACCENTS = ["#d97706", "#0891b2", "#5856d6", "#ea580c", "#16a34a"];

function Sample({
  Icon,
}: {
  Icon: LandingIcon | LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      {/* enlarged */}
      <Icon className="h-7 w-7" style={{ color: INK }} strokeWidth={2} />
      {/* real chip size */}
      <Icon className="h-3 w-3" style={{ color: INK }} strokeWidth={2.2} />
    </div>
  );
}

export default function LandingIconsPreflight() {
  return (
    <div
      className="min-h-screen px-8 py-10"
      style={{
        background: "#F7F8FA",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
      }}
    >
      <header className="mb-8">
        <h1
          className="text-[26px] font-bold tracking-tight"
          style={{ color: INK }}
        >
          Landing icons — Phase 1
        </h1>
        <p className="mt-1 text-[14px] text-slate-500">
          Custom line set (left, “new”) vs current lucide (right, “old”). Same
          pen as the hero starburst; tintable by each card accent. Review before
          it ships to the landing.
        </p>
      </header>

      {/* ── New vs current ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          New vs current — enlarged (28px) + real chip size (12px)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COMPARISON.map(({ label, New, Old, group }) => (
            <div
              key={label}
              className="rounded-2xl bg-white p-4 ring-1 ring-black/[0.05] shadow-[0_8px_24px_-16px_rgba(11,18,40,0.2)]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold" style={{ color: INK }}>
                  {label}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                  {group}
                </span>
              </div>
              <div className="flex items-end gap-6">
                <div className="flex flex-col items-center gap-2">
                  <Sample Icon={New} />
                  <span className="text-[10px] font-medium text-slate-400">
                    new
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2 opacity-70">
                  <Sample Icon={Old} />
                  <span className="text-[10px] font-medium text-slate-400">
                    old
                  </span>
                </div>
              </div>
              {/* accent tints of the new mark */}
              <div className="mt-4 flex items-center gap-3 border-t border-black/[0.05] pt-3">
                {ACCENTS.map((a) => (
                  <New
                    key={a}
                    className="h-4 w-4"
                    style={{ color: a }}
                    strokeWidth={2}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── In context: the real card chips ── */}
      <section>
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          In context — real card chips (CardDecomposition, forced open)
        </h2>
        <div className="flex flex-wrap gap-5">
          {TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="w-[260px] rounded-2xl bg-white p-4 ring-1 ring-black/[0.05] shadow-[0_12px_32px_-20px_rgba(11,18,40,0.3)]"
            >
              <div
                className="mb-1 text-[14px] font-semibold"
                style={{ color: INK }}
              >
                {t.name}
              </div>
              <CardDecomposition templateId={t.id} accent={t.accent} forceOpen />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

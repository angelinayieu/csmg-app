// ── Template meta: what you feed in / what it generates ──
//
// Presentation-only copy for the V2 landing cards' hover decomposition.
// Kept co-located (keyed by the live template id, like card-glyph's
// LAYOUTS) so it needs NO change to the shared template schema — the
// cards still pull name/tagline/accent from the real template library;
// this just annotates each with its content-prep inputs + deliverables.
//
// "inputs" lead (the content-prep focus): the kinds of material you can
// drop in. They map to real ingestion paths (file drop, image analysis,
// links, Drive). "outputs" are the artifacts the template produces.

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  FileText,
  Briefcase,
  Highlighter,
  Ticket,
  Grid3x3,
  FlaskConical,
  ClipboardCheck,
  ClipboardList,
  Sparkles,
  Map as MapIcon,
  GitBranch,
} from "lucide-react";
// Phase-1 custom marks — drop-in replacements for the generic lucide icons.
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
} from "./landing-icons";

export interface MetaItem {
  label: string;
  icon: LucideIcon | LandingIcon;
}
export interface TemplateMeta {
  inputs: MetaItem[];
  outputs: MetaItem[];
}

export const TEMPLATE_META: Record<string, TemplateMeta> = {
  journal_self_discovery: {
    inputs: [
      { label: "Notes", icon: NotesIcon },
      { label: "Voice", icon: VoiceIcon },
      { label: "Photos", icon: PhotosIcon },
      { label: "Highlights", icon: Highlighter },
    ],
    outputs: [
      { label: "Pattern Map", icon: PatternMapIcon },
      { label: "Reflection Brief", icon: FileText },
      { label: "Better Prompts", icon: Sparkles },
    ],
  },
  reading_synthesis: {
    inputs: [
      { label: "PDFs", icon: PdfIcon },
      { label: "Articles", icon: BookOpen },
      { label: "Links", icon: LinksIcon },
      { label: "Highlights", icon: Highlighter },
      { label: "Notes", icon: NotesIcon },
    ],
    outputs: [
      { label: "Concept Map", icon: ConceptMapIcon },
      { label: "Synthesis Brief", icon: FileText },
      { label: "Cross-book Links", icon: GitBranch },
    ],
  },
  research_project: {
    inputs: [
      { label: "Papers", icon: BookOpen },
      { label: "PDFs", icon: PdfIcon },
      { label: "Datasets", icon: DatasetsIcon },
      { label: "Notes", icon: NotesIcon },
      { label: "Links", icon: LinksIcon },
    ],
    outputs: [
      { label: "Hypothesis Map", icon: HypothesisMapIcon },
      { label: "Evidence Matrix", icon: Grid3x3 },
      { label: "Experiment Plan", icon: FlaskConical },
      { label: "Research Brief", icon: FileText },
    ],
  },
  team_retro: {
    inputs: [
      { label: "Notes", icon: NotesIcon },
      { label: "Docs", icon: FileText },
      { label: "Tickets", icon: Ticket },
      { label: "Links", icon: LinksIcon },
    ],
    outputs: [
      { label: "Cause Map", icon: CauseMapIcon },
      { label: "Decision Review", icon: ClipboardCheck },
      { label: "Action Plan", icon: ClipboardList },
    ],
  },
  career_pivot: {
    inputs: [
      { label: "Résumé", icon: FileText },
      { label: "Job Posts", icon: Briefcase },
      { label: "Notes", icon: NotesIcon },
      { label: "Links", icon: LinksIcon },
    ],
    outputs: [
      { label: "Skill-Gap Map", icon: SkillGapMapIcon },
      { label: "Transition Plan", icon: MapIcon },
      { label: "Milestones", icon: ClipboardList },
    ],
  },
  startup_strategy: {
    inputs: [
      { label: "Notes", icon: NotesIcon },
      { label: "Docs", icon: FileText },
      { label: "Market Data", icon: DatasetsIcon },
      { label: "Links", icon: LinksIcon },
    ],
    outputs: [
      { label: "Strategy Map", icon: MapIcon },
      { label: "Roadmap", icon: ClipboardList },
      { label: "Risk Matrix", icon: Grid3x3 },
      { label: "Pitch Brief", icon: FileText },
    ],
  },
  relationship_dynamics: {
    inputs: [
      { label: "Notes", icon: NotesIcon },
      { label: "Voice", icon: VoiceIcon },
      { label: "Highlights", icon: Highlighter },
      { label: "Links", icon: LinksIcon },
    ],
    outputs: [
      { label: "Pattern Map", icon: PatternMapIcon },
      { label: "Dynamics Brief", icon: FileText },
      { label: "Action Plan", icon: ClipboardList },
    ],
  },
  product_development: {
    inputs: [
      { label: "Specs", icon: FileText },
      { label: "Tickets", icon: Ticket },
      { label: "Notes", icon: NotesIcon },
      { label: "Links", icon: LinksIcon },
    ],
    outputs: [
      { label: "Build Map", icon: MapIcon },
      { label: "Spec Brief", icon: FileText },
      { label: "Milestones", icon: ClipboardList },
      { label: "Risk List", icon: Grid3x3 },
    ],
  },
};

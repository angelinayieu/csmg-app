"use client";

// ── Immersive Home (Phase 2B → 2C) ──
//
// The Apple-Vision-Pro-adjacent welcome surface — now the canonical
// home for every user, not just new ones. Returning users still
// reach their existing spaces via the sidebar (we fill only the
// main content area, never the whole viewport).
//
// Phase 2C adds real physics:
//   - Cursor parallax: all cards shift subtly as the cursor moves,
//     front cards more than back. Spring-smoothed via rAF.
//   - Per-card lean-tilt: hovered card rotates in 3D toward the
//     cursor within its bounds. Cards read as spatially alive.
//   - Bloom-expansion: hovered card scales up + reveals starter
//     questions / seed entity counts / destination surface so the
//     user can evaluate before clicking.
//   - Drift pause on hover: only the hovered card pauses; others
//     keep drifting so the composition stays organic.
//
// Ambient motion (drift + background pulse) continues from Phase 2B.
// Everything respects `prefers-reduced-motion` via CSS + a runtime
// check that disables cursor effects entirely.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Brain,
  FastForward,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Minus,
  MessageCircleQuestion,
  Mic,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Table,
  Target,
  Video,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "@/components/ui/glass-panel";
import { AccentChip } from "@/components/ui/accent-chip";
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
import type { UseCaseTemplate } from "@/types/use-case";
import * as LucideIcons from "lucide-react";
import { TopBar } from "./top-bar";
import { LandingPromptPill } from "@/components/landing/landing-prompt-pill";
import { RotatingWord } from "@/components/landing/rotating-word";
import { stashPendingIntake } from "@/components/landing/pending-intake";
import { ReasoningSettingsPanel } from "./reasoning-settings-panel";
import { ClarifyingQuestionsStep } from "./clarifying-questions-step";
import {
  type ReasoningSettings,
  DEFAULT_REASONING_SETTINGS,
  STRATEGY_COUNT_MIN,
  STRATEGY_COUNT_MAX,
} from "@/types/reasoning-settings";
import type { LucideIcon } from "lucide-react";

const LANDING_ROTATING_WORDS = [
  "Methods",
  "Solutions",
  "Life Choices",
  "Decisions",
  "Research",
  "Analysis",
] as const;

export type ImmersiveMode = "canvas" | "gradient";
type PromptMode = "ask" | "create";
type ReasoningDepth = "quick" | "standard" | "deep";

const REASONING_META: Record<
  ReasoningDepth,
  { label: string; hint: string }
> = {
  quick: { label: "Fast", hint: "Fast sketch, ~10s" },
  standard: { label: "Balanced", hint: "Depth-tuned, ~60s" },
  deep: { label: "Deep", hint: "Multi-pass rigor, ~3 min" },
};

// Third-party integrations catalog. Pulls the provider list from
// the existing sources catalog (src/app/api/spaces/[id]/sources/catalog)
// plus common workspace apps the user wanted visible even if the
// OAuth surface isn't wired yet. `status: "coming_soon"` matches the
// integration_placeholder convention elsewhere in the codebase.
const INTEGRATIONS: Array<{
  id: string;
  label: string;
  Logo: React.ComponentType;
  status: "available" | "coming_soon";
}> = [
  { id: "sheets", label: "Sheets", Logo: GoogleSheetsLogo, status: "coming_soon" },
  { id: "drive", label: "Drive", Logo: GoogleDriveLogo, status: "coming_soon" },
  { id: "calendar", label: "Calendar", Logo: GoogleCalendarLogo, status: "coming_soon" },
  { id: "notion", label: "Notion", Logo: NotionLogo, status: "coming_soon" },
  { id: "airtable", label: "Airtable", Logo: AirtableLogo, status: "coming_soon" },
  { id: "slack", label: "Slack", Logo: SlackLogo, status: "coming_soon" },
  { id: "gmail", label: "Gmail", Logo: GmailLogo, status: "coming_soon" },
  { id: "docs", label: "Docs", Logo: GoogleDocsLogo, status: "coming_soon" },
  { id: "github", label: "GitHub", Logo: GitHubLogo, status: "coming_soon" },
  { id: "dropbox", label: "Dropbox", Logo: DropboxLogo, status: "coming_soon" },
  { id: "figma", label: "Figma", Logo: FigmaLogo, status: "coming_soon" },
  { id: "linear", label: "Linear", Logo: LinearLogo, status: "coming_soon" },
  { id: "jira", label: "Jira", Logo: JiraLogo, status: "coming_soon" },
  { id: "teams", label: "Teams", Logo: TeamsLogo, status: "coming_soon" },
  { id: "arxiv", label: "arXiv", Logo: ArxivLogo, status: "coming_soon" },
  { id: "semantic", label: "Semantic Scholar", Logo: SemanticScholarLogo, status: "coming_soon" },
  { id: "scholar", label: "Google Scholar", Logo: GoogleScholarLogo, status: "coming_soon" },
  { id: "wikipedia", label: "Wikipedia", Logo: WikipediaLogo, status: "coming_soon" },
  { id: "web", label: "Web Search", Logo: WebSearchLogo, status: "coming_soon" },
  { id: "claude", label: "Claude", Logo: ClaudeOpusLogo, status: "coming_soon" },
  { id: "chatgpt", label: "ChatGPT", Logo: ChatGPTLogo, status: "coming_soon" },
  { id: "gemini", label: "Gemini", Logo: GeminiLogo, status: "coming_soon" },
];

// Icons shown inline after the Apps pill (first 5 — rest are in the
// popup). Keeps the toolbar compact while hinting at the breadth of
// integrations behind the "..." affordance.
const INLINE_INTEGRATION_IDS = ["notion", "drive", "slack", "figma", "github"];

const FILE_CHIPS: Array<{
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { label: "Image", icon: ImageIcon },
  { label: "Video", icon: Video },
  { label: "Audio", icon: Mic },
  { label: "CSV", icon: Table },
  { label: "PDF", icon: FileText },
  { label: "Link", icon: LinkIcon },
];

export interface ImmersiveHomeProps {
  greetingName: string;
  mode?: ImmersiveMode;
  templates: ReadonlyArray<
    Pick<
      UseCaseTemplate,
      | "id"
      | "name"
      | "tagline"
      | "description"
      | "icon"
      | "accent_color"
      | "category"
      | "default_surface"
    > & {
      seed_entity_count: number;
      question_count: number;
    }
  >;
  /**
   * Count of existing whiteboards — used to label the library-nav pill.
   * When undefined or 0 the pill still renders but with plural-safe
   * copy so first-time users don't see "0 whiteboards".
   */
  whiteboardCount?: number;
  /**
   * Fires when the user wants to flip to the whiteboards library.
   * Shell component consumes this to crossfade to the library view.
   */
  onViewLibrary?: () => void;
  /** Profile data for the top-bar profile chip / sign-out menu. */
  userEmail?: string;
  userId?: string | null;
  creditBalance?: number;
  /**
   * Landing-page demo mode. Disables real submissions: typing + Enter
   * stashes the prompt in sessionStorage and redirects to /auth/signup.
   * Card clicks stash the template id and redirect the same way. After
   * auth, /app's PendingIntakeRunner picks up the stash and runs the
   * downstream call. Also hides authed-only chrome (TopBar) and swaps
   * the greeting for the rotating-word marketing headline.
   */
  demoMode?: boolean;
}

// Fixed layout positions for up to 7 cards — calculated by hand so
// the composition reads as balanced, not random. Percentages are
// relative to the surface; cards are absolutely positioned and
// animate drift from these anchors.
const CARD_POSITIONS: Array<{
  top: string;
  left: string;
  z: 0 | 1 | 2;
  driftClass: string;
}> = [
  { top: "14%", left: "9%", z: 1, driftClass: "immersive-card-drift-1" },
  { top: "22%", left: "78%", z: 0, driftClass: "immersive-card-drift-2" },
  { top: "62%", left: "6%", z: 2, driftClass: "immersive-card-drift-3" },
  { top: "74%", left: "82%", z: 1, driftClass: "immersive-card-drift-4" },
  { top: "40%", left: "84%", z: 2, driftClass: "immersive-card-drift-5" },
  { top: "52%", left: "16%", z: 0, driftClass: "immersive-card-drift-6" },
  { top: "82%", left: "46%", z: 1, driftClass: "immersive-card-drift-7" },
];

const CARD_DEPTH: Record<
  number,
  { scale: number; opacity: number; blur: number; width: number }
> = {
  0: { scale: 0.72, opacity: 0.55, blur: 1.5, width: 200 },
  1: { scale: 0.88, opacity: 0.82, blur: 0, width: 230 },
  2: { scale: 1, opacity: 0.98, blur: 0, width: 260 },
};

// Max parallax shift in px. Scales with depth so front cards move
// more. Tuned low — the motion should feel present but never draw
// attention to itself.
const PARALLAX_STRENGTH_X = 14;
const PARALLAX_STRENGTH_Y = 10;
// Spring coefficient for cursor follow. Higher = snappier, lower =
// heavier/liquidy. 0.08 feels calm without lagging.
const CURSOR_SPRING = 0.08;

// Max tilt rotation in degrees when cursor-leaning on a hovered card.
const TILT_MAX_DEG = 7;

interface CursorState {
  x: number; // viewport-normalized [-1, 1]
  y: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ImmersiveHome({
  greetingName,
  templates,
  mode = "canvas",
  whiteboardCount,
  onViewLibrary,
  userEmail = "",
  userId,
  creditBalance = 0,
  demoMode = false,
}: ImmersiveHomeProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [promptMode, setPromptMode] = useState<PromptMode>("ask");
  const [askSubmitting, setAskSubmitting] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [depth, setDepth] = useState<ReasoningDepth>("standard");
  // When ON, bootstrap fires decompose immediately instead of pausing
  // for the Plan Review Card. Power-user / "I trust the defaults" mode.
  // Default OFF (matches server default) — most users want to review
  // the proposed scope/ontology/axes before pipeline runs.
  const [skipPlanGate, setSkipPlanGate] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  // Reasoning settings — lenses, process toggles, baseline behavior.
  // Depth is duplicated here (mirrored from `depth` state above) so
  // the settings panel + the inline pill control stay in sync. The
  // panel is closed by default; smart defaults mean first-time users
  // never need to open it.
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasoningSettings, setReasoningSettings] = useState<ReasoningSettings>({
    ...DEFAULT_REASONING_SETTINGS,
  });
  // Clarifying-questions flow state. When the user submits with the
  // "ask me clarifying questions" toggle on, we flip into "clarifying"
  // mode and render the Q&A step in place of the normal prompt UI.
  // After they answer (or skip), we proceed with bootstrap.
  const [clarifyingActive, setClarifyingActive] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null,
  );
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist mode across sessions so returning users pick up where they left
  // off. Mounted in an effect so SSR doesn't break.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem("immersiveHome.mode");
    if (saved === "ask" || saved === "create") setPromptMode(saved);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("immersiveHome.mode", promptMode);
    setAskError(null);
  }, [promptMode]);

  // ── Global cursor state (spring-smoothed) ────────────────────────
  const [cursor, setCursor] = useState<CursorState>({ x: 0, y: 0 });
  const cursorTargetRef = useRef<CursorState>({ x: 0, y: 0 });
  const cursorCurrentRef = useRef<CursorState>({ x: 0, y: 0 });
  const reducedMotionRef = useRef<boolean>(false);

  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion();
    if (reducedMotionRef.current) return;

    let rafId = 0;

    const handleMouseMove = (e: MouseEvent) => {
      // Normalize to [-1, 1] centered on the viewport — keeps math
      // cheap downstream (parallax = cursor × strength × depth).
      cursorTargetRef.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2,
      };
    };

    const tick = () => {
      const target = cursorTargetRef.current;
      const current = cursorCurrentRef.current;
      current.x += (target.x - current.x) * CURSOR_SPRING;
      current.y += (target.y - current.y) * CURSOR_SPRING;
      // Only trigger a React update when the change matters. The rAF
      // keeps spring interpolation smooth regardless of React's
      // render cadence.
      setCursor({ x: current.x, y: current.y });
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Pick up to 7 templates; extra positions skip silently.
  const cards = useMemo(() => templates.slice(0, 7), [templates]);

  // Underlying bootstrap call — accepts an optional answers payload
  // appended by the clarifying-questions flow. Extracted so both the
  // direct-submit path and the post-clarification path can share it.
  const fireBootstrap = useCallback(
    async (
      finalText: string,
      answers: Array<{ question: string; answer: string }> = [],
    ) => {
      setCreateSubmitting(true);
      setCreateError(null);
      try {
        // Append the clarifier Q&A to the input_text so decompose +
        // research see them as part of the user's intake. Format kept
        // simple/readable since downstream LLMs read it as prose.
        const augmented =
          answers.length > 0
            ? `${finalText}\n\n--- additional context (clarifier Q&A) ---\n${answers
                .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
                .join("\n\n")}`
            : finalText;
        // Settings keep their reasoning_depth in sync with the inline
        // pill — pass both so the server has a single canonical bundle.
        const settingsForServer: ReasoningSettings = {
          ...reasoningSettings,
          depth,
        };
        const res = await fetch("/api/intake/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: augmented,
            reasoningDepth: depth,
            reasoning_settings: settingsForServer,
            skipPlanGate,
          }),
        });
        const raw = await res.text();
        const asJson = (() => {
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        if (!res.ok) {
          throw new Error(
            (asJson?.error as string) ?? `Bootstrap failed (${res.status})`,
          );
        }
        const data = asJson as unknown as {
          spaceId: string;
          runId: string | null;
        };
        const destination = data.runId
          ? `/app/space/${data.spaceId}/whiteboard?run=${data.runId}`
          : `/app/space/${data.spaceId}/whiteboard`;
        router.push(destination);
      } catch (err) {
        console.error("[ImmersiveHome] fireBootstrap failed:", err);
        setCreateError(
          err instanceof Error ? err.message : "Bootstrap failed",
        );
        setCreateSubmitting(false);
        setClarifyingActive(false); // back to prompt edit
      }
    },
    [reasoningSettings, depth, router],
  );

  // Create mode: submit directly to /api/intake/bootstrap. On success
  // navigate to the new whiteboard; the SSE subscription picks up the
  // pipeline run.
  //
  // When `reasoningSettings.askClarifyingQuestions` is true, we flip
  // into the clarifier flow first — render the Q&A step, get answers,
  // THEN call fireBootstrap with the augmented input.
  const submitCreate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 4 || createSubmitting) return;
    if (demoMode) {
      stashPendingIntake({ kind: "create", prompt: trimmed, depth });
      window.location.hash = "signup";
      return;
    }
    if (reasoningSettings.askClarifyingQuestions) {
      // Defer bootstrap until clarifier returns. ClarifyingQuestionsStep
      // calls onContinue with answers, which fires fireBootstrap.
      setClarifyingActive(true);
      return;
    }
    await fireBootstrap(trimmed);
  }, [
    prompt,
    depth,
    createSubmitting,
    demoMode,
    reasoningSettings.askClarifyingQuestions,
    fireBootstrap,
  ]);

  // Ask mode: create an ask-kind whiteboard, trigger the cross-whiteboard
  // synthesis inngest job, navigate to the new space.
  const submitAsk = useCallback(async () => {
    const query = prompt.trim();
    if (!query || askSubmitting) return;
    if (demoMode) {
      stashPendingIntake({ kind: "ask", prompt: query });
      window.location.hash = "signup";
      return;
    }
    setAskSubmitting(true);
    setAskError(null);
    try {
      const res = await fetch("/api/ask/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Ask failed (${res.status})`);
      }
      const { spaceId } = (await res.json()) as { spaceId: string };
      router.push(`/app/space/${spaceId}`);
    } catch (err) {
      console.error("[ImmersiveHome] submitAsk failed:", err);
      setAskError(err instanceof Error ? err.message : "Ask failed");
      setAskSubmitting(false);
    }
  }, [prompt, askSubmitting, router, demoMode]);

  const handlePromptKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (promptMode === "ask") {
          void submitAsk();
        } else {
          void submitCreate();
        }
      }
    },
    [promptMode, submitCreate, submitAsk],
  );

  const createFromTemplate = useCallback(
    async (templateId: string) => {
      if (pendingTemplateId) return;
      if (demoMode) {
        stashPendingIntake({ kind: "template", templateId });
        window.location.hash = "signup";
        return;
      }
      setPendingTemplateId(templateId);
      try {
        const res = await fetch("/api/use-cases/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id: templateId }),
        });
        if (!res.ok) throw new Error(`create ${res.status}`);
        const json = (await res.json()) as {
          space: { id: string };
          default_surface?: string;
        };
        const spaceId = json.space.id;
        const surfacePath = mapSurfacePath(json.default_surface);
        router.push(`/app/space/${spaceId}${surfacePath}`);
      } catch (err) {
        console.error("[ImmersiveHome] createFromTemplate failed:", err);
        setPendingTemplateId(null);
      }
    },
    [pendingTemplateId, router, demoMode],
  );

  return (
    <div
      className={cn(
        "immersive-home-surface absolute inset-0 overflow-hidden",
        mode === "gradient" && "mode-gradient",
      )}
    >
      {/* Ambient background — dotted canvas (default) or radial gradients (mode=gradient) */}
      <div className="immersive-home-bg pointer-events-none absolute inset-0" />

      {/* Floating card swarm — absolutely positioned, drifting */}
      <div className="pointer-events-none absolute inset-0">
        {cards.map((template, idx) => {
          const pos = CARD_POSITIONS[idx];
          if (!pos) return null;
          return (
            <FloatingCard
              key={template.id}
              template={template}
              position={pos}
              depth={CARD_DEPTH[pos.z]}
              pending={pendingTemplateId === template.id}
              othersPending={
                pendingTemplateId !== null && pendingTemplateId !== template.id
              }
              hovered={hoveredCardId === template.id}
              anyHovered={hoveredCardId !== null}
              cursor={cursor}
              onHover={(on) => setHoveredCardId(on ? template.id : null)}
              onSelect={() => createFromTemplate(template.id)}
            />
          );
        })}
      </div>

      {/* Top bar — brand + primary nav + overview/settings/profile.
          Skipped in demoMode; the landing page renders its own
          marketing nav above the immersive surface. */}
      {!demoMode && (
        <TopBar
          userEmail={userEmail}
          userId={userId}
          creditBalance={creditBalance}
          whiteboardCount={whiteboardCount}
          onViewLibrary={onViewLibrary}
        />
      )}

      {/* Center stage — greeting + glass prompt.
          IMPORTANT: `pointer-events-none` on the wrapper so it
          doesn't steal hover events from the floating cards behind
          it. The prompt block below re-enables `pointer-events-auto`
          so users can still type + click Begin. Without this the
          full-viewport flex wrapper sits at z-5 above the cards
          (z-1…3) and silently swallows every hover. */}
      <div
        className="immersive-home-enter pointer-events-none relative z-[5] flex min-h-screen flex-col items-center justify-center px-6"
        style={{
          // Counter-parallax the center so it feels anchored while
          // the cards drift around it. Subtle, half the front-card
          // shift in the OPPOSITE direction.
          transform: `translate3d(${-cursor.x * 6}px, ${-cursor.y * 4}px, 0)`,
          transition: "transform 60ms linear",
        }}
      >
        <div className="pointer-events-auto w-full max-w-[640px]">
          {demoMode ? (
            <div className="mb-6 text-center">
              <h1 className="text-[44px] font-bold leading-[1.05] tracking-tight text-slate-900 sm:text-[56px]">
                Infinite Possibilities
                <br />
                to Make Better{" "}
                <RotatingWord words={LANDING_ROTATING_WORDS} />
              </h1>
              <p className="mx-auto mt-4 max-w-md text-[15px] font-light text-slate-600">
                Research, development, and experiment in{" "}
                <span className="font-semibold text-slate-900">one click.</span>
              </p>
            </div>
          ) : (
            <div className="mb-5 text-center">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--home-text-faint)]">
                InterAxis
              </div>
              <h1 className="text-[32px] font-light leading-tight text-[color:var(--home-text)]">
                Welcome, {greetingName}.
              </h1>
              <p className="mt-2 text-[14px] font-light text-[color:var(--home-text-mid)]">
                {promptMode === "ask"
                  ? "Ask anything — I'll answer using every whiteboard you've built."
                  : "What do you want to think about?"}
              </p>
            </div>
          )}

          {demoMode && (
            <LandingPromptPill
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => void submitCreate()}
              loading={createSubmitting}
            />
          )}

          {!demoMode && (
            <>
          {/* Ask | Create segmented toggle. Ask = cross-whiteboard synthesis.
              Create = inline intake → /api/intake/bootstrap → whiteboard. */}
          <div className="mb-4 flex justify-center">
            <div
              role="tablist"
              aria-label="Prompt mode"
              className="inline-flex items-center rounded-full p-1 backdrop-blur-sm"
              style={{
                border: "1px solid var(--home-chrome-stroke)",
                background: "var(--home-chrome-fill)",
              }}
            >
              <ModeTab
                active={promptMode === "create"}
                onClick={() => setPromptMode("create")}
                icon={<Wand2 className="h-3.5 w-3.5" />}
                label="Create"
                sublabel="new analysis"
              />
              <ModeTab
                active={promptMode === "ask"}
                onClick={() => setPromptMode("ask")}
                icon={<MessageCircleQuestion className="h-3.5 w-3.5" />}
                label="Ask"
                sublabel="across whiteboards"
              />
            </div>
          </div>

          {/* Clarifying-questions step — replaces the prompt panel
              when the user submitted with the "ask me clarifying
              questions" toggle on. Slides in over the same vertical
              space the GlassPanel occupies so the layout doesn't
              jump around. */}
          {clarifyingActive ? (
            <ClarifyingQuestionsStep
              prompt={prompt}
              lenses={reasoningSettings.lenses}
              onCancel={() => setClarifyingActive(false)}
              onContinue={(answers) => {
                void fireBootstrap(prompt.trim(), answers);
              }}
            />
          ) : (
          <GlassPanel
            tier="modal"
            radius={20}
            className="relative overflow-hidden"
          >
            <div className="relative">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handlePromptKey}
                rows={3}
                placeholder={
                  promptMode === "ask"
                    ? "Ask anything that touches your whiteboards — I'll stitch an answer from them."
                    : "Ask anything, create anything"
                }
                className={cn(
                  "w-full resize-none bg-transparent px-5 py-4 text-[15px] font-light leading-relaxed text-[color:var(--home-text)] placeholder:text-[color:var(--home-text-faint)]",
                  "focus:outline-none",
                )}
                style={{ minHeight: 96 }}
                autoFocus
              />
              {prompt && (
                <button
                  onClick={() => setPrompt("")}
                  className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full transition-colors"
                  style={{ color: "var(--home-text-faint)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "var(--home-chrome-fill-hover)";
                    e.currentTarget.style.color = "var(--home-text-mid)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--home-text-faint)";
                  }}
                  title="Clear"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {promptMode === "create" ? (
              <div
                className="flex flex-col gap-2 px-4 py-2.5"
                style={{ borderTop: "1px solid var(--glass-hairline)" }}
              >
                {/* Row 1: + | Apps pill | File toggle (+ expanded chips) | Send */}
                <div className="flex items-center gap-2">
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                    style={{
                      border: "1px solid var(--home-chrome-stroke)",
                      color: "var(--home-text-mid)",
                    }}
                    title="Add"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>

                  {/* Apps & integrations — condensed to a single icon
                      button. Click opens the full Apps popup; hover
                      reveals a peek of the inline integration logos so
                      the affordance still hints at what's behind it. */}
                  <div className="group relative">
                    <button
                      onClick={() => setAppsOpen((v) => !v)}
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                      style={{
                        border: "1px solid var(--home-chrome-stroke)",
                        background: "var(--home-chrome-fill)",
                        color: "var(--home-text-mid)",
                      }}
                      title="Apps & integrations"
                      aria-expanded={appsOpen}
                      aria-label="Apps & integrations"
                    >
                      <LucideIcons.LayoutGrid
                        className="h-3.5 w-3.5"
                        strokeWidth={1.75}
                      />
                    </button>
                    <div className="pointer-events-none invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1.5 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
                      <div
                        className="rounded-lg p-2 shadow-lg whitespace-nowrap"
                        style={{
                          background: "var(--home-chrome-fill)",
                          border: "1px solid var(--home-chrome-stroke)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        <div
                          className="mb-1.5 text-[11px] font-semibold"
                          style={{ color: "var(--home-text)" }}
                        >
                          Apps & integrations
                        </div>
                        <div className="flex items-center gap-1">
                          {INLINE_INTEGRATION_IDS.map((id) => {
                            const integ = INTEGRATIONS.find(
                              (i) => i.id === id,
                            );
                            if (!integ) return null;
                            const { Logo } = integ;
                            return (
                              <button
                                key={id}
                                onClick={() => setAppsOpen(true)}
                                className="flex h-6 w-6 items-center justify-center rounded-md transition-transform hover:scale-110"
                                title={`${integ.label} — coming soon`}
                              >
                                <span className="[&_svg]:h-4 [&_svg]:w-4">
                                  <Logo />
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={() => setAppsOpen((v) => !v)}
                            className="flex h-6 items-center justify-center gap-0.5 rounded-md px-1.5 text-[10px] font-semibold transition-colors"
                            style={{ color: "var(--home-text-mid)" }}
                            title="See all integrations"
                          >
                            <LucideIcons.MoreHorizontal
                              className="h-3.5 w-3.5"
                              strokeWidth={2}
                            />
                            <span>more</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setFilesOpen((v) => !v)}
                    className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                    style={{
                      border: "1px solid var(--home-chrome-stroke)",
                      background: filesOpen
                        ? "var(--home-chrome-fill-hover)"
                        : "transparent",
                      color: filesOpen
                        ? "var(--home-text)"
                        : "var(--home-text-mid)",
                    }}
                    title={filesOpen ? "Hide file options" : "Attach files"}
                    aria-expanded={filesOpen}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>

                  <div className="ml-auto flex items-center gap-2">
                    {/* ── Output-shape toggles (intake-prominent) ──
                        Apps + Lab default OFF — strategy-only mode is the
                        default flow. These three live in the chatbox row
                        (not buried in the advanced panel) because they
                        materially change what the pipeline produces. */}
                    <OutputTogglePill
                      label="Apps"
                      Icon={Zap}
                      active={reasoningSettings.generateApps}
                      onClick={() =>
                        setReasoningSettings((s) => ({
                          ...s,
                          generateApps: !s.generateApps,
                        }))
                      }
                      activeBg="#7c3aed"
                      title={
                        reasoningSettings.generateApps
                          ? "Materialize Apps after strategy approval"
                          : "Apps OFF — strategy only"
                      }
                    />
                    <OutputTogglePill
                      label="Lab"
                      Icon={FlaskConical}
                      active={reasoningSettings.runLab}
                      onClick={() =>
                        setReasoningSettings((s) => ({
                          ...s,
                          runLab: !s.runLab,
                        }))
                      }
                      activeBg="#d97706"
                      title={
                        reasoningSettings.runLab
                          ? "Run Monte Carlo + variant factory"
                          : "Lab OFF — no simulations"
                      }
                    />
                    <StrategyCountStepper
                      value={reasoningSettings.strategyCount}
                      onChange={(n) =>
                        setReasoningSettings((s) => ({
                          ...s,
                          strategyCount: n,
                        }))
                      }
                    />
                    <OutputTogglePill
                      label="Skip plan"
                      Icon={FastForward}
                      active={skipPlanGate}
                      onClick={() => setSkipPlanGate((v) => !v)}
                      activeBg="#475569"
                      title={
                        skipPlanGate
                          ? "Skip plan: pipeline runs immediately, no review card"
                          : "Plan review ON — approve the proposed scope/ontology/axes before generation"
                      }
                    />
                    {/* Reasoning: Fast / Balanced / Deep — collapsed to
                        Brain icon. Hover dropdown reveals full selector
                        so the chip row stays inside the chat box. */}
                    <div className="group relative">
                      <button
                        type="button"
                        aria-label={`Reasoning depth: ${REASONING_META[depth].label}`}
                        className="flex h-7 items-center justify-center rounded-full transition-colors"
                        style={{
                          border: "1px solid var(--home-chrome-stroke)",
                          background: "var(--home-chrome-fill)",
                          color: "var(--home-text-mid)",
                          width: 28,
                        }}
                      >
                        <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                      <div className="pointer-events-none invisible absolute right-0 top-full z-30 pt-1.5 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
                        <div
                          className="rounded-lg p-2.5 shadow-lg whitespace-nowrap"
                          style={{
                            background: "var(--home-chrome-fill)",
                            border: "1px solid var(--home-chrome-stroke)",
                            backdropFilter: "blur(8px)",
                          }}
                        >
                          <div
                            className="mb-1.5 text-[11px] font-semibold"
                            style={{ color: "var(--home-text)" }}
                          >
                            Reasoning depth
                          </div>
                          <div
                            className="inline-flex items-center gap-1 rounded-full p-[3px]"
                            style={{
                              border: "1px solid var(--home-chrome-stroke)",
                              background: "var(--home-chrome-fill)",
                            }}
                          >
                            {(
                              Object.keys(REASONING_META) as ReasoningDepth[]
                            ).map((d) => {
                              const meta = REASONING_META[d];
                              const active = depth === d;
                              return (
                                <button
                                  key={d}
                                  onClick={() => setDepth(d)}
                                  title={meta.hint}
                                  className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold transition-colors"
                                  style={
                                    active
                                      ? {
                                          background: "var(--home-cta-bg)",
                                          color: "var(--home-cta-fg)",
                                        }
                                      : { color: "var(--home-text-mid)" }
                                  }
                                >
                                  {meta.label}
                                </button>
                              );
                            })}
                          </div>
                          <p
                            className="mt-1.5 text-[10.5px] leading-snug"
                            style={{ color: "var(--home-text-mid)" }}
                          >
                            {REASONING_META[depth].hint}
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => void submitCreate()}
                      disabled={prompt.trim().length < 4 || createSubmitting}
                      className="flex h-8 w-8 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed"
                      style={
                        prompt.trim().length >= 4 && !createSubmitting
                          ? {
                              background: "var(--home-cta-bg)",
                              color: "var(--home-cta-fg)",
                            }
                          : {
                              background: "var(--home-chrome-fill)",
                              color: "var(--home-text-faint)",
                            }
                      }
                      title="Begin (⌘↵)"
                    >
                      {createSubmitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Row 2: file chips (collapsible) */}
                {filesOpen && (
                  <div
                    className="flex flex-wrap items-center gap-1.5 pt-1"
                    style={{ borderTop: "1px dashed var(--glass-hairline)" }}
                  >
                    {FILE_CHIPS.map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors"
                        style={{
                          border: "1px solid var(--home-chrome-stroke)",
                          background: "var(--home-chrome-fill)",
                          color: "var(--home-text-mid)",
                        }}
                        title={`Attach ${label}`}
                      >
                        <Icon className="h-3 w-3" strokeWidth={1.75} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="flex items-center justify-between px-4 py-2.5"
                style={{ borderTop: "1px solid var(--glass-hairline)" }}
              >
                <div className="flex items-center gap-3 text-[10.5px] font-medium text-[color:var(--home-text-faint)]">
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircleQuestion className="h-3 w-3" />
                    Searches across every whiteboard you own.
                  </span>
                </div>
                <button
                  onClick={() => void submitAsk()}
                  disabled={!prompt.trim() || askSubmitting}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
                  style={
                    prompt.trim() && !askSubmitting
                      ? {
                          background: "var(--home-cta-bg)",
                          color: "var(--home-cta-fg)",
                        }
                      : {
                          background: "var(--home-chrome-fill)",
                          color: "var(--home-text-faint)",
                        }
                  }
                >
                  {askSubmitting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  <span>Ask</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </GlassPanel>
          )}

          {/* Reasoning settings panel — collapsed by default. Lets
              users customize lenses + process toggles before submit.
              Hidden during clarifier flow (the user has already
              committed; toggling settings mid-clarify would race). */}
          {promptMode === "create" && !clarifyingActive && (
            <div className="mt-2">
              <ReasoningSettingsPanel
                open={reasoningOpen}
                onToggle={() => setReasoningOpen((v) => !v)}
                settings={reasoningSettings}
                onChange={setReasoningSettings}
                disabled={createSubmitting}
              />
            </div>
          )}

          {/* Apps & Inputs popup — mirrors the reference design: all
              third-party integrations visible (even unlaunched) so the
              user can see the full surface. Click outside or the close
              affordance to dismiss. */}
          {promptMode === "create" && appsOpen && (
            <div className="relative mt-2">
              <GlassPanel tier="modal" radius={18} className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[12px] font-semibold text-[color:var(--home-text)]">
                    Apps & Inputs
                  </div>
                  <button
                    onClick={() => setAppsOpen(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--home-text-faint)] transition-colors hover:text-[color:var(--home-text)]"
                    title="Close"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[color:var(--home-text-faint)]">
                    Integrations
                  </div>
                  <span className="text-[10px] text-[color:var(--home-text-faint)]">
                    Coming soon
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                  {INTEGRATIONS.map(({ id, label, Logo }) => (
                    <button
                      key={id}
                      className="group flex flex-col items-center gap-1 rounded-xl p-2 transition-colors"
                      style={{ border: "1px solid transparent" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor =
                          "var(--home-chrome-stroke)";
                        e.currentTarget.style.background =
                          "var(--home-chrome-fill)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "transparent";
                        e.currentTarget.style.background = "transparent";
                      }}
                      title={`${label} — coming soon`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center">
                        <Logo />
                      </span>
                      <span className="text-[10.5px] font-medium text-[color:var(--home-text-mid)]">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
                <div
                  className="mt-3 flex items-center justify-between pt-3 text-[10.5px] text-[color:var(--home-text-faint)]"
                  style={{ borderTop: "1px solid var(--glass-hairline)" }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" />
                    Drag & drop files anywhere, or paste from clipboard.
                  </span>
                  <div className="flex items-center gap-1.5">
                    {FILE_CHIPS.map(({ label, icon: Icon }) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                        style={{
                          border: "1px solid var(--home-chrome-stroke)",
                          background: "var(--home-chrome-fill)",
                        }}
                      >
                        <Icon className="h-2.5 w-2.5" strokeWidth={1.75} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </GlassPanel>
            </div>
          )}

          {askError && promptMode === "ask" && (
            <div className="mt-2 text-center text-[10.5px] text-red-500">
              {askError}
            </div>
          )}
          {createError && promptMode === "create" && (
            <div className="mt-2 text-center text-[10.5px] text-red-500">
              {createError}
            </div>
          )}

          <div className="mt-4 text-center text-[11px] font-medium text-[color:var(--home-text-faint)]">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Hover a floating card to peek inside. Click to open the space.
            </span>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FloatingCard — one possibility card, parallax + tilt + bloom details
// ─────────────────────────────────────────────────────────────────────

type TemplateForCard = ImmersiveHomeProps["templates"][number];

interface FloatingCardProps {
  template: TemplateForCard;
  position: { top: string; left: string; z: 0 | 1 | 2; driftClass: string };
  depth: { scale: number; opacity: number; blur: number; width: number };
  pending: boolean;
  othersPending: boolean;
  hovered: boolean;
  anyHovered: boolean;
  cursor: CursorState;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}

function FloatingCard({
  template,
  position,
  depth,
  pending,
  othersPending,
  hovered,
  anyHovered,
  cursor,
  onHover,
  onSelect,
}: FloatingCardProps) {
  const cardEl = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState<{ rx: number; ry: number }>({
    rx: 0,
    ry: 0,
  });

  // Parallax offset — front cards shift more than back.
  const depthFactor = position.z + 1;
  const parallaxX = cursor.x * depthFactor * PARALLAX_STRENGTH_X;
  const parallaxY = cursor.y * depthFactor * PARALLAX_STRENGTH_Y;

  // Hover interaction: scale up + tilt toward cursor + pause drift.
  const isForeground = hovered;
  const isBackground = anyHovered && !hovered;
  const pendingOthers = othersPending;

  const effectiveScale = isForeground
    ? 1.14
    : isBackground
      ? depth.scale * 0.94
      : depth.scale;
  const effectiveOpacity =
    isBackground || pendingOthers ? 0.28 : depth.opacity;
  const effectiveBlur =
    isBackground || pendingOthers ? depth.blur + 2 : depth.blur;

  // Cursor-lean tilt: when hovered, compute pointer position inside
  // the card bounds and rotate the card toward it. Resets smoothly
  // on mouse leave.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!hovered || !cardEl.current) return;
      const rect = cardEl.current.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5; // [-0.5, 0.5]
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      // rotateX is inverse Y (pulling the top edge toward you feels
      // right when cursor is above center).
      setTilt({
        rx: -py * TILT_MAX_DEG * 2,
        ry: px * TILT_MAX_DEG * 2,
      });
    },
    [hovered],
  );

  // When hover ends, spring tilt back to 0 (single-frame reset is
  // jarring; let CSS transition handle it via `transform` below).
  useEffect(() => {
    if (!hovered) setTilt({ rx: 0, ry: 0 });
  }, [hovered]);

  // Resolve the lucide icon by string name with a Sparkles fallback.
  const IconCandidate =
    (LucideIcons as unknown as Record<string, unknown>)[template.icon] ??
    LucideIcons.Sparkles;
  const IconComponent = IconCandidate as React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;

  const surfaceLabel = surfaceLabelFor(template.default_surface);

  return (
    <div
      className={cn("absolute pointer-events-auto", position.driftClass)}
      style={{
        top: position.top,
        left: position.left,
        width: depth.width,
        zIndex: hovered ? 20 : position.z + 1,
        // Pause drift ONLY for the hovered card; others keep moving.
        animationPlayState: hovered ? "paused" : "running",
      }}
    >
      {/* Inner wrapper handles parallax. Keeping drift + parallax on
          separate wrappers lets each animate independently. */}
      <div
        style={{
          transform: `translate3d(${parallaxX}px, ${parallaxY}px, 0)`,
          transition: "transform 80ms linear",
          transformStyle: "preserve-3d",
          perspective: "800px",
        }}
      >
        <button
          ref={cardEl}
          onClick={onSelect}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onMouseMove={handleMouseMove}
          disabled={pending || pendingOthers}
          className="block w-full cursor-pointer text-left disabled:cursor-wait"
          style={{
            transform: `
              scale(${effectiveScale})
              rotateX(${tilt.rx}deg)
              rotateY(${tilt.ry}deg)
            `,
            opacity: effectiveOpacity,
            filter: effectiveBlur ? `blur(${effectiveBlur}px)` : undefined,
            transition:
              "transform 420ms cubic-bezier(0.25, 0.8, 0.25, 1), opacity 320ms ease, filter 320ms ease",
            transformStyle: "preserve-3d",
          }}
        >
          <GlassPanel
            tier={
              position.z === 2 ? "float" : position.z === 1 ? "card" : "plate"
            }
            radius={18}
            accent={template.accent_color}
            className="overflow-hidden p-4"
          >
            {/* Card header — icon + name + tagline */}
            <div className="flex items-start gap-3">
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: `color-mix(in srgb, ${template.accent_color} calc(var(--accent-fill-medium) * 100%), transparent)`,
                }}
              >
                {pending ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    style={{ color: template.accent_color }}
                  />
                ) : (
                  <IconComponent
                    className="h-4 w-4"
                    strokeWidth={1.5}
                    style={{ color: template.accent_color }}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[color:var(--home-text)]">
                  {template.name}
                </div>
                <div
                  className="mt-0.5 line-clamp-2 text-[11px] font-light text-[color:var(--home-text-mid)]"
                  title={template.tagline}
                >
                  {template.tagline}
                </div>
                <div className="mt-2">
                  <AccentChip
                    accent={template.accent_color}
                    size="xs"
                    variant="ghost"
                  >
                    {template.category}
                  </AccentChip>
                </div>
              </div>
            </div>

            {/* Bloom details — slides in on hover. Kept max-height
                animated so it expands the card rather than overlapping
                other content. */}
            <div
              style={{
                maxHeight: hovered ? 160 : 0,
                opacity: hovered ? 1 : 0,
                overflow: "hidden",
                transition:
                  "max-height 400ms cubic-bezier(0.25, 0.8, 0.25, 1), opacity 220ms ease",
              }}
            >
              <div
                className="mt-3 space-y-1.5 pt-3 text-[11px] font-light text-[color:var(--home-text-mid)]"
                style={{ borderTop: "1px solid var(--glass-hairline)" }}
              >
                {template.description && (
                  <div className="line-clamp-3 text-[11px] leading-relaxed text-[color:var(--home-text-mid)]">
                    {template.description}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1 text-[10.5px] font-medium text-[color:var(--home-text-faint)]">
                  <span>
                    <span
                      className="font-semibold"
                      style={{ color: template.accent_color }}
                    >
                      {template.seed_entity_count}
                    </span>{" "}
                    seed nodes
                  </span>
                  <span>
                    <span
                      className="font-semibold"
                      style={{ color: template.accent_color }}
                    >
                      {template.question_count}
                    </span>{" "}
                    starter questions
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[10px] text-[color:var(--home-text-faint)]">
                    Opens in{" "}
                    <span
                      className="font-semibold"
                      style={{ color: template.accent_color }}
                    >
                      {surfaceLabel}
                    </span>
                  </span>
                  <span
                    className="flex items-center gap-1 text-[10.5px] font-semibold"
                    style={{ color: template.accent_color }}
                  >
                    Open
                    <ArrowRight className="h-2.5 w-2.5" />
                  </span>
                </div>
              </div>
            </div>
          </GlassPanel>
        </button>
      </div>
    </div>
  );
}

// ── Surface routing ──
//
// Template `default_surface` → relative path inside the created
// space. Whiteboard is canonical per the transformation plan; other
// surfaces preserve their existing routes.

function mapSurfacePath(surface: string | undefined): string {
  switch (surface) {
    case "journal":
      return "/journal";
    case "whiteboard_playground":
      return "/whiteboard/brainstorm";
    case "whiteboard_overview":
      return "/whiteboard/overview";
    case "reading_import":
      return "/intake-review";
    case "structured_form":
    case undefined:
      return "/whiteboard";
    default:
      return "/whiteboard";
  }
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
  sublabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all",
        active ? "shadow-[0_4px_10px_-4px_rgba(0,60,200,0.35)]" : "",
      )}
      style={
        active
          ? {
              background: "var(--home-cta-bg)",
              color: "var(--home-cta-fg)",
            }
          : {
              color: "var(--home-text-mid)",
            }
      }
    >
      {icon}
      <span className="leading-none">
        {label}
        <span
          className="ml-1.5 text-[10px] font-medium"
          style={{
            color: active
              ? "color-mix(in srgb, var(--home-cta-fg) 75%, transparent)"
              : "var(--home-text-faint)",
          }}
        >
          {sublabel}
        </span>
      </span>
    </button>
  );
}

function surfaceLabelFor(surface: string): string {
  switch (surface) {
    case "journal":
      return "Journal";
    case "whiteboard_playground":
      return "Brainstorm";
    case "whiteboard_overview":
      return "Overview";
    case "reading_import":
      return "Reading view";
    case "structured_form":
      return "Form";
    default:
      return "Whiteboard";
  }
}

// ── Output toggle pill ──
// Icon-only round switch — active state fills with the accent color so
// the user can see opt-ins at a glance without text labels. Full label,
// ON/OFF state, and description appear in a hover dropdown so the row
// stays compact. Used for Apps / Lab / Skip plan toggles.
function OutputTogglePill({
  label,
  Icon,
  active,
  onClick,
  activeBg,
  title,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  activeBg: string;
  title: string;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label} ${active ? "on" : "off"}`}
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
        style={
          active
            ? {
                background: activeBg,
                color: "#fff",
                border: `1px solid ${activeBg}`,
              }
            : {
                background: "var(--home-chrome-fill)",
                color: "var(--home-text-mid)",
                border: "1px solid var(--home-chrome-stroke)",
              }
        }
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {/* Hover dropdown — pt-1.5 on the wrapper (not mt) so cursor can
          travel from button to popover without losing :hover. */}
      <div className="pointer-events-none invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1.5 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
        <div
          className="w-44 rounded-lg p-2.5 shadow-lg"
          style={{
            background: "var(--home-chrome-fill)",
            border: "1px solid var(--home-chrome-stroke)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[11px] font-semibold"
              style={{ color: "var(--home-text)" }}
            >
              {label}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={
                active
                  ? {
                      background: activeBg,
                      color: "#fff",
                      border: `1px solid ${activeBg}`,
                    }
                  : {
                      background: "transparent",
                      color: "var(--home-text-faint)",
                      border: "1px solid var(--home-chrome-stroke)",
                    }
              }
            >
              {active ? "ON" : "OFF"}
            </span>
          </div>
          <p
            className="mt-1 text-[10.5px] leading-snug"
            style={{ color: "var(--home-text-mid)" }}
          >
            {title}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Strategy count stepper ──
// Compact value chip — shows Target icon + current count. Hover reveals
// a dropdown with the - / + stepper. Bounded by
// STRATEGY_COUNT_MIN..STRATEGY_COUNT_MAX. Default 3. Plumbs into the
// synthesis prompt's option count + a final slice on ranked_strategies
// (strategy-engine.ts).
function StrategyCountStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const safeValue = Math.min(
    STRATEGY_COUNT_MAX,
    Math.max(STRATEGY_COUNT_MIN, value),
  );
  const dec = () => onChange(Math.max(STRATEGY_COUNT_MIN, safeValue - 1));
  const inc = () => onChange(Math.min(STRATEGY_COUNT_MAX, safeValue + 1));
  const decDisabled = safeValue <= STRATEGY_COUNT_MIN;
  const incDisabled = safeValue >= STRATEGY_COUNT_MAX;
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={`${safeValue} ${safeValue === 1 ? "strategy" : "strategies"}`}
        className="flex h-7 items-center gap-1 rounded-full px-2 transition-colors"
        style={{
          border: "1px solid var(--home-chrome-stroke)",
          background: "var(--home-chrome-fill)",
          color: "var(--home-text-mid)",
        }}
      >
        <Target className="h-3 w-3" strokeWidth={1.75} />
        <span
          className="min-w-[8px] text-center text-[11px] font-bold tabular-nums"
          style={{ color: "var(--home-text-strong, var(--home-text))" }}
        >
          {safeValue}
        </span>
      </button>
      <div className="pointer-events-none invisible absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1.5 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
        <div
          className="rounded-lg p-2.5 shadow-lg"
          style={{
            background: "var(--home-chrome-fill)",
            border: "1px solid var(--home-chrome-stroke)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-3 whitespace-nowrap">
            <span
              className="text-[11px] font-semibold"
              style={{ color: "var(--home-text)" }}
            >
              Strategies
            </span>
            <span
              className="text-[9.5px]"
              style={{ color: "var(--home-text-faint)" }}
            >
              {STRATEGY_COUNT_MIN}–{STRATEGY_COUNT_MAX}
            </span>
          </div>
          <div
            className="inline-flex items-center gap-0.5 rounded-full p-[3px]"
            style={{
              border: "1px solid var(--home-chrome-stroke)",
              background: "var(--home-chrome-fill)",
            }}
          >
            <button
              type="button"
              onClick={dec}
              disabled={decDisabled}
              className="flex h-5 w-5 items-center justify-center rounded-full transition-colors disabled:opacity-30"
              style={{ color: "var(--home-text-mid)" }}
              aria-label="Fewer strategies"
            >
              <Minus className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
            <span
              className="min-w-[20px] text-center text-[11px] font-bold tabular-nums"
              style={{ color: "var(--home-text-strong, var(--home-text-mid))" }}
            >
              {safeValue}
            </span>
            <button
              type="button"
              onClick={inc}
              disabled={incDisabled}
              className="flex h-5 w-5 items-center justify-center rounded-full transition-colors disabled:opacity-30"
              style={{ color: "var(--home-text-mid)" }}
              aria-label="More strategies"
            >
              <Plus className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

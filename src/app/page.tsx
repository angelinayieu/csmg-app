// ── / (public landing) ──
//
// Marketing surface for unauthenticated visitors. Composed top-down:
//
//   1. LandingMarketingNav — sticky brand + nav + Log in / Get started
//   2. Immersive hero — the same <ImmersiveHome /> rendered for /app,
//      with `demoMode` enabled so:
//        • the greeting becomes the rotating-word marketing headline,
//        • the prompt textbox is replaced with the whiteboard's
//          PlaygroundDock,
//        • Enter / template-card click stash the intent in
//          sessionStorage and redirect to /auth/signup,
//        • after auth, /app's PendingIntakeRunner picks up the stash
//          and runs the same downstream call the visitor would have
//          fired if they'd been signed in.
//   3. Feature tiles + ecosystem diagram — preserved from the prior
//      landing page; they remain the strongest existing sections.
//   4. Footer.
//
// Single source of truth: the immersive demo IS ImmersiveHome — there
// is no parallel landing-only floating-cards component. Adding a card
// position or polishing a hover state is a one-file change.

import { redirect } from "next/navigation";
import {
  SlidersHorizontal,
  GitBranch,
  Database,
  BarChart3,
  Globe,
  Network,
  PieChart,
  Wrench,
  Cloud,
  User,
} from "lucide-react";
import { ImmersiveHome } from "@/components/home/immersive-home";
import { LandingMarketingNav } from "@/components/landing/landing-marketing-nav";
import { LandingV2, type LandingCard } from "@/components/landing/landing-v2";
import { AuthModal } from "@/components/auth/auth-modal";
import { TEMPLATE_LIST, getTemplate } from "@/lib/use-cases/library";
import { getAuthUser } from "@/lib/supabase/server";

const features = [
  { icon: SlidersHorizontal, label: "Adjustable\nreasoning depth" },
  { icon: GitBranch, label: "Cross-reasoning across\ncontext spaces" },
  { icon: Database, label: "Active storage of\nall your apps" },
  { icon: BarChart3, label: "Chat Overview\nAnalytic Insights" },
];

const ecosystemNodes = [
  { icon: Globe, label: "Weekly new tool updates", x: 50, y: 8 },
  {
    icon: BarChart3,
    label: "24/7 personalized real-time\nweb updates",
    x: 85,
    y: 30,
  },
  {
    icon: Network,
    label: "Reasoning with deep logic\nconstruction",
    x: 15,
    y: 30,
  },
  {
    icon: PieChart,
    label: "Precise statistical insights\nand metric analysis",
    x: 85,
    y: 65,
  },
  {
    icon: Wrench,
    label: "Embedded Third Party and\nCustom Tools",
    x: 15,
    y: 65,
  },
  { icon: Cloud, label: "Cloud Backup", x: 50, y: 88 },
];

// Curated carousel for the V2 landing preview — pulls live data straight
// from the template library so the cards never drift from the real
// templates. `team_retro` shows as the shorter "Retrospective" label.
const V2_CAROUSEL_IDS = [
  "journal_self_discovery",
  "reading_synthesis",
  "research_project",
  "team_retro",
  "career_pivot",
] as const;
const V2_LABEL_OVERRIDES: Record<string, string> = { team_retro: "Retrospective" };

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{ v2?: string }>;
}) {
  // ── New landing preview (/?v2=1) ──
  // Gated variant for A/B'ing the new design without touching the current
  // landing. Rendered BEFORE the logged-in redirect so it stays previewable
  // while signed in. Flip the default here once it wins.
  const params = await searchParams;
  if (params?.v2 === "1") {
    const cards = V2_CAROUSEL_IDS.map((id): LandingCard | null => {
      const t = getTemplate(id);
      if (!t) return null;
      return {
        id: t.id,
        name: V2_LABEL_OVERRIDES[t.id] ?? t.name,
        tagline: t.tagline,
        category: t.category,
        // Black & white: feed the card ink instead of the per-template color.
        // Every card visual (glyph, chips, Generates icons, banner, CTA) reads
        // this one value, so this single line makes the whole card monochrome.
        // Revert to `t.accent_color` to bring the per-template colors back.
        accent: "#0B0B0C",
      };
    }).filter((c): c is LandingCard => c !== null);
    return <LandingV2 cards={cards} />;
  }

  // If the visitor already has a valid Supabase session cookie, skip the
  // marketing surface and drop them straight on /app. Supabase SSR
  // persists the session in cookies, so this "remembers" them across
  // browser restarts — no re-login needed until the refresh token expires.
  const user = await getAuthUser();
  if (user) {
    redirect("/app");
  }

  const templates = TEMPLATE_LIST.map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    icon: t.icon,
    accent_color: t.accent_color,
    category: t.category,
    default_surface: t.default_surface,
    seed_entity_count: t.seed_entities.length,
    question_count: t.question_library.length,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      {/* ─── Hero ─────────────────────────────────────────────────────
          Full-viewport immersive demo. The marketing nav is rendered
          inside this section so it sits above the floating-cards
          surface (z-50), which itself uses absolute inset-0. */}
      <section className="relative h-screen overflow-hidden bg-white">
        <LandingMarketingNav />
        <ImmersiveHome
          demoMode
          greetingName=""
          templates={templates}
          mode="canvas"
        />
      </section>

      <main className="flex-1">
        {/* ─── Feature tiles ───────────────────────────────────────── */}
        <section
          id="platform"
          className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 pt-24 pb-12 md:grid-cols-4"
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.label}
                className="glass-card-icon flex flex-col items-center rounded-2xl p-6 text-center"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/50 bg-white/60 shadow-sm">
                  <Icon className="h-8 w-8 text-interaxis-600" />
                </div>
                <p className="mt-4 whitespace-pre-line text-sm font-medium leading-tight text-gray-700">
                  {feature.label}
                </p>
              </div>
            );
          })}
        </section>

        {/* ─── Ecosystem diagram ───────────────────────────────────── */}
        <section
          id="solutions"
          className="mx-auto max-w-3xl px-6 pb-24 pt-8"
        >
          <div className="glass-card rounded-3xl px-8 pt-8 pb-12">
            <div className="mx-auto mb-8 w-fit rounded-full border border-gray-200/80 bg-white/70 px-6 py-2">
              <h2 className="text-lg font-semibold text-gray-900">
                Your Digital Ecosystem
              </h2>
            </div>

            <div className="relative mx-auto" style={{ height: 420 }}>
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {ecosystemNodes.map((node, i) => (
                  <line
                    key={i}
                    x1="50"
                    y1="48"
                    x2={node.x}
                    y2={node.y}
                    className="eco-line"
                  />
                ))}
              </svg>

              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-interaxis-200 bg-white shadow-md">
                  <User className="h-9 w-9 text-gray-600" />
                </div>
              </div>

              {ecosystemNodes.map((node) => {
                const Icon = node.icon;
                return (
                  <div
                    key={node.label}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200/80 bg-white shadow-sm">
                        <Icon className="h-6 w-6 text-gray-600" />
                      </div>
                      <p className="max-w-[140px] whitespace-pre-line text-center text-xs font-medium leading-tight text-gray-600">
                        {node.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── Closing CTA ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">
            Ready to build your intelligence system?
          </h2>
          <p className="mt-3 text-base text-gray-600">
            Sign up free — your prompt picks up exactly where you left it.
          </p>
          <div className="mt-6">
            <a
              href="#signup"
              className="inline-flex items-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.02] hover:bg-slate-800"
            >
              Get started
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200/60 px-6 py-6 text-center text-sm text-gray-400">
        InterAxis &mdash; Your Intelligence System
      </footer>

      <AuthModal />
    </div>
  );
}

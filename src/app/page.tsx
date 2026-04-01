import Link from "next/link";
import {
  Lock,
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
  Search,
} from "lucide-react";

const navTabs = [
  { label: "Home", href: "/", active: true },
  { label: "Advice", href: "#" },
  { label: "Library", href: "#" },
  { label: "Enterprise", href: "#" },
  { label: "Innovation", href: "#" },
  { label: "Join Us", href: "/auth/signup" },
];

const features = [
  { icon: SlidersHorizontal, label: "Adjustable\nreasoning depth" },
  { icon: GitBranch, label: "Cross-reasoning across\ncontext spaces" },
  { icon: Database, label: "Active storage of\nall your apps" },
  { icon: BarChart3, label: "Chat Overview\nAnalytic Insights" },
];

const ecosystemNodes = [
  {
    icon: Globe,
    label: "Weekly new tool updates",
    x: 50,
    y: 8,
    labelSide: "right" as const,
  },
  {
    icon: BarChart3,
    label: "24/7 personalized real-time\nweb updates",
    x: 85,
    y: 30,
    labelSide: "right" as const,
  },
  {
    icon: Network,
    label: "Reasoning with deep logic\nconstruction",
    x: 15,
    y: 30,
    labelSide: "left" as const,
  },
  {
    icon: PieChart,
    label: "Precise statistical insights\nand metric analysis",
    x: 85,
    y: 65,
    labelSide: "right" as const,
  },
  {
    icon: Wrench,
    label: "Embedded Third Party and\nCustom Tools",
    x: 15,
    y: 65,
    labelSide: "left" as const,
  },
  {
    icon: Cloud,
    label: "Cloud Backup",
    x: 50,
    y: 88,
    labelSide: "right" as const,
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="relative flex items-center justify-between px-8 py-5">
        <span className="text-xl font-bold tracking-tight">InterAxis</span>

        {/* Centered pill nav */}
        <nav className="absolute left-1/2 -translate-x-1/2 rounded-full border border-gray-200/80 bg-white/70 px-2 py-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-1">
            {navTabs.map((tab) => (
              <Link
                key={tab.label}
                href={tab.href}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab.active
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {tab.label}
              </Link>
            ))}
            <button className="rounded-full p-1.5 text-gray-500 hover:text-gray-700">
              <Search className="h-4 w-4" />
            </button>
          </div>
        </nav>

        <Link
          href="/auth/login"
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Log in
        </Link>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
          <h1 className="text-5xl font-bold tracking-tight text-gray-900">
            Your intelligence system
          </h1>

          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white/60 px-3 py-1 backdrop-blur-sm">
            <Lock className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-sm text-gray-600">encrypted data</span>
          </div>

          <div className="mt-6 space-y-1">
            <p className="text-base text-gray-700">
              <strong className="font-bold text-gray-900">AI</strong> with
              enhanced real world logic reasoning capabilities
            </p>
            <p className="text-base text-gray-700">
              <strong className="font-bold text-gray-900">
                Digital Infrastructure
              </strong>{" "}
              for speed, quality, and accuracy
            </p>
          </div>

          <div className="mt-8">
            <Link href="/auth/signup" className="btn-gradient-outline text-base">
              Get Started
            </Link>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 pb-20 md:grid-cols-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.label}
                className="glass-card-icon flex flex-col items-center rounded-2xl p-6 text-center"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/60 border border-white/50 shadow-sm">
                  <Icon className="h-8 w-8 text-interaxis-600" />
                </div>
                <p className="mt-4 text-sm font-medium leading-tight text-gray-700 whitespace-pre-line">
                  {feature.label}
                </p>
              </div>
            );
          })}
        </section>

        {/* Ecosystem Diagram */}
        <section className="mx-auto max-w-3xl px-6 pb-24">
          <div className="glass-card rounded-3xl px-8 pt-8 pb-12">
            <div className="mx-auto mb-8 w-fit rounded-full border border-gray-200/80 bg-white/70 px-6 py-2">
              <h2 className="text-lg font-semibold text-gray-900">
                Your Digital Ecosystem
              </h2>
            </div>

            {/* Hub and spoke */}
            <div className="relative mx-auto" style={{ height: 420 }}>
              {/* SVG connecting lines */}
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

              {/* Center hub */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-interaxis-200 bg-white shadow-md">
                  <User className="h-9 w-9 text-gray-600" />
                </div>
              </div>

              {/* Spoke nodes */}
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
                      <p className="max-w-[140px] text-center text-xs font-medium leading-tight text-gray-600 whitespace-pre-line">
                        {node.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200/60 px-6 py-6 text-center text-sm text-gray-400">
        InterAxis &mdash; Your Intelligence System
      </footer>
    </div>
  );
}

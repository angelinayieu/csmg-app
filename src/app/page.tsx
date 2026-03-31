import Link from "next/link";
import { ArrowRight, GitBranch, Layers, Network } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Network className="h-6 w-6 text-blue-600" />
          <span className="text-lg font-semibold">CSMG</span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/auth/login"
            className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Log in
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign up
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Map Your Thinking
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            Paste any complex situation and decompose it into a structured
            knowledge graph. Discover hidden connections, leverage points, risks,
            and feedback loops — then act on them.
          </p>
          <div className="mt-8">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-base font-medium text-white hover:bg-blue-700"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mx-auto mt-24 grid max-w-4xl gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
            <Layers className="mb-3 h-8 w-8 text-blue-600" />
            <h3 className="font-semibold">Decompose</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Break any situation into entities, relationships, constraints, and
              feedback loops across structured tiers.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
            <GitBranch className="mb-3 h-8 w-8 text-teal-600" />
            <h3 className="font-semibold">Weave</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Connect multiple decompositions through shared variables to
              discover cross-domain insights and contradictions.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
            <Network className="mb-3 h-8 w-8 text-purple-600" />
            <h3 className="font-semibold">Meta-Analyze</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Run reasoning operations — find leverage points, trace cycles,
              simulate failures, and predict missing connections.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 px-6 py-6 text-center text-sm text-gray-500 dark:border-gray-800">
        CSMG &mdash; Context Space Meta-Graph
      </footer>
    </div>
  );
}

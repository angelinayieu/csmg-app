// ── Parallel-path empty state ──
//
// Three distinct branches based on the user's strategy publishing state.
// Mirrors the synergy-discover-empty pattern (informative, never
// scolding). Apple Mail "Nothing in this folder" energy — calm,
// passive, with a clear next step when one exists.

import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";

interface Props {
  myStrategiesCount: number;
  myMatchablePublishedCount: number;
}

export function ParallelEmptyState({
  myStrategiesCount,
  myMatchablePublishedCount,
}: Props) {
  // Branch 1: no strategies at all
  if (myStrategiesCount === 0) {
    return (
      <Frame title="No strategies yet">
        <p className="text-[13px] leading-relaxed text-gray-500">
          Publish your first strategy to find people on parallel paths —
          others pursuing similar goals via possibly different routines.
        </p>
        <Link
          href="/app/synergy"
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-800"
        >
          Go to brainstorms
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      </Frame>
    );
  }

  // Branch 2: strategies exist but none are matchable + published
  if (myMatchablePublishedCount === 0) {
    return (
      <Frame title="Your strategies aren't indexed yet">
        <p className="text-[13px] leading-relaxed text-gray-500">
          Parallel-path matching needs at least one published, matchable
          strategy. Publish from any brainstorm and the matcher takes care
          of the rest.
        </p>
        <Link
          href="/app/synergy"
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-[12.5px] font-medium text-gray-700 transition hover:border-gray-300"
        >
          Go to brainstorms
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      </Frame>
    );
  }

  // Branch 3: indexed, but no matches yet
  return (
    <Frame title="Indexed — scanning the pool">
      <p className="text-[13px] leading-relaxed text-gray-500">
        Your {myMatchablePublishedCount} matchable strateg
        {myMatchablePublishedCount === 1 ? "y is" : "ies are"} in the
        cross-user pool. Parallel-path matches will surface here as the
        community grows.
      </p>
      <p className="mt-3 text-[12px] leading-relaxed text-gray-400">
        We&apos;ll email you when a strong match lands, if you&apos;ve
        opted in on your profile.
      </p>
    </Frame>
  );
}

function Frame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-8 py-16 text-center">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
        <Compass className="h-4 w-4 text-gray-500" strokeWidth={1.5} />
      </div>
      <h2 className="font-display mt-5 text-[17px] font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      <div className="mx-auto mt-2 max-w-sm">{children}</div>
    </div>
  );
}

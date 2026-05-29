// Temporary visual preview for the pearl AmbientBackdrop + FloatingCard
// primitive (the layered-rooms substrate). Public route so it can be
// inspected without auth. SAFE TO DELETE.

"use client";

import { AmbientBackdrop } from "@/components/layout/ambient-backdrop";
import { FloatingCard } from "@/components/ui/floating-card";

export default function Page() {
  return (
    <div className="min-h-screen" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}>
      <AmbientBackdrop />

      <div className="mx-auto max-w-5xl px-6 pb-24 pt-16">
        <div
          className="mb-8 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Layered-rooms substrate · pearl backdrop + FloatingCard
        </div>

        {/* The headline "floating room pane" — what the Lab page now
            renders as: one glowing card over the pearl substrate. */}
        <FloatingCard tier="float" glow className="overflow-hidden">
          <div
            className="border-b"
            style={{ borderColor: "rgba(15,23,42,0.06)" }}
          >
            <div className="flex items-center justify-between gap-3 px-6 py-3">
              <div className="flex items-center gap-3 text-[11px]" style={{ color: "rgba(15,23,42,0.45)" }}>
                <span>← Back to room</span>
                <span style={{ color: "rgba(15,23,42,0.28)" }}>/</span>
                <span>Goal-Driven Knowledge Pathways</span>
                <span style={{ color: "rgba(15,23,42,0.28)" }}>/</span>
                <span className="font-semibold uppercase tracking-[0.12em]" style={{ color: "#0A84FF" }}>Lab</span>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                style={{ color: "rgba(15,23,42,0.62)", border: "1px solid rgba(15,23,42,0.06)" }}
              >
                Discuss
              </span>
            </div>
          </div>
          <div className="px-6 py-8">
            <h1
              className="text-[26px] font-semibold tracking-tight"
              style={{ color: "rgba(15,23,42,0.92)", letterSpacing: "-0.02em" }}
            >
              Contextual Content Filter
            </h1>
            <p className="mt-1 text-[12px]" style={{ color: "rgba(15,23,42,0.45)" }}>
              4 variations
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {["Contextual Relevance Filtering", "Goal-Based Content Prioritization", "Dynamic Context Awareness", "User Feedback-Driven Filtering"].map((v) => (
                <FloatingCard key={v} tier="card" className="px-4 py-3">
                  <div className="text-[13px] font-semibold" style={{ color: "rgba(15,23,42,0.92)" }}>{v}</div>
                  <div className="mt-1 text-[11px]" style={{ color: "rgba(15,23,42,0.45)" }}>Awaiting rubric score</div>
                </FloatingCard>
              ))}
            </div>
          </div>
        </FloatingCard>

        {/* The depth ladder — all four tiers, so you can see the
            elevation steps (blur + fill opacity + shadow + radius). */}
        <div className="mt-12 mb-4 text-[11px] font-medium uppercase tracking-[0.2em]" style={{ color: "rgba(15,23,42,0.45)" }}>
          Depth tiers
        </div>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {(["plate", "card", "float", "modal"] as const).map((tier) => (
            <FloatingCard key={tier} tier={tier} parallax className="flex h-28 items-center justify-center">
              <span className="text-[12px] font-semibold capitalize" style={{ color: "rgba(15,23,42,0.7)" }}>{tier}</span>
            </FloatingCard>
          ))}
        </div>
      </div>
    </div>
  );
}

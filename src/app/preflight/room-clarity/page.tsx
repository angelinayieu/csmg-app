// Preflight brainstorm harness — room-interior clarity treatments.
// Renders one realistic mock room and toggles between the current
// treatment and five clarity directions, on mock data only.
// Public route. SAFE TO DELETE once a direction is chosen.

"use client";

import { appleVibe } from "@/lib/apple-vibe-tokens";
import { RoomClarityLab } from "./room-clarity";

export default function RoomClarityPreviewPage() {
  return (
    <div
      style={{
        background:
          "radial-gradient(1200px 600px at 50% -10%, #eef1f6 0%, #f5f6f8 55%, #f1f2f5 100%)",
        minHeight: "100vh",
      }}
      className="px-6 py-10"
    >
      <div className="mx-auto max-w-6xl">
        <div
          className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em]"
          style={{ color: appleVibe.text.tertiary }}
        >
          Preflight · Room clarity brainstorm (mock data)
        </div>
        <p
          className="mb-6 max-w-2xl text-[13px] leading-relaxed"
          style={{ color: appleVibe.text.secondary }}
        >
          The room interior (Problems / Mechanisms / Results) is dense: every
          card repeats its verb, the &ldquo;derived from&rdquo; strip is always
          on, and the causal links between columns are nearly invisible. Flip
          between the current treatment and five clarity directions below — each
          one targets a specific failure. Tell me which to promote (e.g.
          &ldquo;quiet + trace&rdquo;) and I&apos;ll wire it into the real lanes.
        </p>

        <RoomClarityLab />
      </div>
    </div>
  );
}

// Preflight: render the DESIGN.md + tailwind.config.ts blocks for a sample
// taste-profile snapshot, so we can eyeball what Opus will see before paying
// for a real generation. No auth, no DB — pure server render.

import { composeFromSnapshot } from "@/lib/objective-canvas/tech-spec/taste-design-block";

const SAMPLE_SNAPSHOT = {
  voice: {
    tone: "Direct, technical, MVP-first",
    style: "Short sentences, named tradeoffs, no marketing prose.",
  },
  vocabulary: {
    coined: [
      { term: "Substrate", kind: "pattern" },
      { term: "Taste receipt", kind: "outcome" },
    ],
    grounded: [
      { term: "Concept slug", kind: "entity" },
      { term: "Object link", kind: "entity" },
    ],
    ai: [],
  },
  tensions: ["Coherence vs speed", "Brand fit vs novelty"],
  sources: [
    {
      ingestedFileId: "img-1",
      name: "Reference 1",
      thumbUrl: null,
      conceptSlugs: ["editorial-grid", "warm-terracotta"],
    },
  ],
  no_gos: ["Purple gradients", "Inter as default"],
  pinned: {},
  generated_at: new Date(0).toISOString(),
  thin_signal: false,
};

const EMPTY_SNAPSHOT = {
  voice: { tone: "", style: "" },
  vocabulary: { coined: [], grounded: [], ai: [] },
  tensions: [],
  sources: [],
  no_gos: [],
  pinned: {},
  generated_at: new Date(0).toISOString(),
  thin_signal: true,
};

export default function PreflightTasteDesignBlock() {
  const filled = composeFromSnapshot(SAMPLE_SNAPSHOT);
  const empty = composeFromSnapshot(EMPTY_SNAPSHOT);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Preflight — taste-design-block</h1>
      <p style={{ color: "#64748B" }}>
        hasContent (filled): <strong>{String(filled.hasContent)}</strong> · empty:{" "}
        <strong>{String(empty.hasContent)}</strong>
      </p>

      <h2>DESIGN.md (sample)</h2>
      <pre
        style={{
          background: "#0F172A",
          color: "#F8FAFC",
          padding: 16,
          borderRadius: 12,
          overflow: "auto",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {filled.designMd}
      </pre>

      <h2>tailwind.config.ts (sample)</h2>
      <pre
        style={{
          background: "#0F172A",
          color: "#F8FAFC",
          padding: 16,
          borderRadius: 12,
          overflow: "auto",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {filled.tailwindConfig}
      </pre>

      <h2>Empty-snapshot case</h2>
      <pre
        style={{
          background: "#F1F5F9",
          color: "#0F172A",
          padding: 16,
          borderRadius: 12,
          overflow: "auto",
          fontSize: 12,
        }}
      >
        designMd: {JSON.stringify(empty.designMd)}
        {"\n"}tailwindConfig: {JSON.stringify(empty.tailwindConfig)}
        {"\n"}hasContent: {String(empty.hasContent)}
      </pre>
    </main>
  );
}

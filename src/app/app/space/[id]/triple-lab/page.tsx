// Triple-lab page — a dedicated 3-split view for watching the
// knowledge graph develop and insights emerge as raw signal comes in.
//
// Left: raw signal panel (drop / paste / sticky / paper cards w/ hover
//       actions + Claude-powered concept-expansion toggle).
// Middle: live d3-force visualization of the KG, animated by the
//         structural event SSE bus.
// Right: insights panel (synthesis_data + guardrail question queue).
//
// Built on top of the existing SpaceDataContext provided by the parent
// layout — no new SSR queries.

import { TripleLab } from "@/components/triple-lab/triple-lab";

export default async function TripleLabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TripleLab spaceId={id} />;
}

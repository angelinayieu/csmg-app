// ── Explore page ──
// Route: /app/explore
//
// Dedicated entry point for research-grade templates. Distinct from
// /app/use-cases (which holds consumer-grade journal/career/etc.
// templates). Each card here scaffolds a fully-populated workspace —
// KG, layer ontology, evidence-backed edges, starter subjects,
// intervention catalog, and a wired-up lab — in one click.

import { ExploreGallery } from "@/components/explore/explore-gallery";

export default function ExplorePage() {
  return <ExploreGallery />;
}

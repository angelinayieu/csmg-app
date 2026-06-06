# Prototype Richness Plan

**Goal:** Push the HTML-prototype generator from "static CSS mockup" to Claude-Code-grade fidelity with deep taste integration, multi-source context, and rich interactivity.

**Status:** Step 1 in progress.

---

## Current baseline (2026-06-05)

- `POST /api/canvas/prototype` + `/refine` → Opus → sanitized HTML in `sandbox=""` iframe.
- Hard rules in `compose-prototype.ts:19`: **ONE self-contained `<!DOCTYPE html>`, NO JavaScript, NO external resources, CSS-only interactivity.**
- Feedback loop = text-only refine; `version` bumps, persisted to `artifacts` with version history.
- Image descriptors wired into **gpt-image-1** (commit `2bd7f79`) but NOT into the HTML prototype path.
- `TasteReceipt` scans the title post-hoc — display, not input.

## Tier model

| Tier | Runtime | Capability |
|---|---|---|
| **T0** (today) | Single HTML doc, `sandbox=""` | CSS-only interactivity |
| **T1** | `sandbox="allow-scripts"` (no allow-same-origin) | Vanilla JS, real state, animations, CDN libs |
| **T2** | Sandpack + claude-artifact-runner template | React + shadcn + Tailwind + Lucide + Recharts + Three.js |
| **T3** *(deferred)* | WebContainers / E2B | Full Node + npm + Next.js + mock APIs |

---

## Execution order

### Step 1 — Inject taste BEFORE generation
Materialize `taste-profile.ts` as a `DESIGN.md` block + synthesized `tailwind.config.ts` token export; prepend both into `composePrototypeHtml` and `refinePrototypeHtml`. v0/Lovable/Bolt SOTA pattern. **Zero new infra, biggest taste win.**

### Step 2 — Install Anthropic `frontend-design` skill
Add alongside existing `loadUiSkillSystem()`. Forces aesthetic commitment, bans clichés, pairs with shadcn.

### Step 3 — shadcn Skill + shadcn MCP
Wire first-party shadcn Skill + MCP so Opus stops hallucinating component props. T1 still HTML-only; this gives the model correct shadcn vocabulary for when T2 lands.

### Step 4 — Tighten T1 safety
Lift `sandbox=""` to `sandbox="allow-scripts"` (NOT `allow-same-origin`). Add explicit CSP `frame-src 'self'`. Upgrade DOMPurify to v3.4.8. Pre-requisite for emitting any JS.

### Step 5 — Multi-input refine
Extend `/api/canvas/prototype/refine` to accept `linkedObjectIds[]`. Mirror `generate-screen`: traverse `object_links`, hydrate `image_narrative` + `concept_slug` + sibling-prototype titles into the refine prompt. Drag-to-wire UX reuses `image-wire-overlay` pattern.

### Step 6 — Read `draw-a-ui` before designing T2
tldraw + GPT-4V → HTML in iframe. Architecturally identical to our stack. Find what NOT to build before reaching for Sandpack.

### Step 7 — T2 tier (Sandpack + claude-artifact-runner)
Sandpack shape on the board, preload shadcn + Tailwind + Lucide + Recharts + Three.js. Opus Artifact-style output renders unchanged. **Caveat:** Sandpack moved to "limited maintenance" March 2026 — plan migration path (esbuild-wasm DIY).

### Step 8 — T3 tier (DEFERRED)
Only when a prototype actually needs `npm install` or a backend route. WebContainers (commercial license at scale) vs E2B (server-side, paid hosting). Do not pre-build.

---

## Reference repos (read before building each tier)

- **T0/T1 reference:** [SawyerHood/draw-a-ui](https://github.com/SawyerHood/draw-a-ui) — same stack as ours.
- **T2 template:** [claudio-silva/claude-artifact-runner](https://github.com/claudio-silva/claude-artifact-runner) — exact Artifact dependency set.
- **T3 reference:** [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) — MIT WebContainers clone.
- **Image-grounded UI generation:** [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) — 71k★ multi-model pipeline.
- **Leaked system prompts to diff:** [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) — v0, Lovable, Bolt, Cursor verbatim.

## Safety constraints

- Iframe combo: `sandbox="allow-scripts"` WITHOUT `allow-same-origin` (null-origin; can't unset its own sandbox).
- srcdoc inherits parent CSP — add explicit `frame-src 'self'`.
- DOMPurify v3.4.8 minimum (first-party TS types, Trusted Types support).
- `vm2` is DEAD as of Oct 2025 (9.8 CVSS escape) — if any server-side eval is added, use isolated-vm.

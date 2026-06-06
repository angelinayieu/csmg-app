# Prototype Richness Plan

**Goal:** Push the HTML-prototype generator from "static CSS mockup" to Claude-Code-grade fidelity with deep taste integration, multi-source context, and rich interactivity.

**Status:** Steps 1–7 shipped. Step 8 deferred by design.

---

## Current state (2026-06-06)

Two prototype tiers live on the whiteboard:
- **T0/T1 (HTML)** — `prototype-card` shape. Skill stack (UI agent + frontend-design + shadcn primer) + taste injection (DESIGN.md + tailwind.config.ts) + DOMPurify v3.4.8 + `sandbox="allow-scripts"` (null-origin) + CSP meta + multi-input refine (linkedObjectIds → image_narratives + concept_slugs + sibling prototypes).
- **T2 (React, Sandpack)** — `prototype-react` shape. Multi-file `{ entry, files }` output via Opus JSON, validated by `sanitizeReactT2` (import allowlist + banned APIs + byte caps + path traversal block), bootstrapped with claude-artifact-runner dep set (react + lucide-react + clsx + tailwind-merge + recharts + three + @react-three/fiber + @react-three/drei) and Tailwind via JIT CDN.

## Tier model

| Tier | Runtime | Capability | Shape |
|---|---|---|---|
| **T0/T1** | `sandbox="allow-scripts"` (null-origin) | Inline JS, real state, animations, deny-all CSP | `prototype-card` |
| **T2** | Sandpack bundler iframe | React + Tailwind + Lucide + Recharts + Three.js | `prototype-react` |
| **T3** *(deferred)* | WebContainers / E2B | Full Node + npm + Next.js + mock APIs | — |

---

## Step status

### Step 1 — Inject taste BEFORE generation ✅
`taste-profile.ts` → DESIGN.md block + synthesized `tailwind.config.ts` token export (brand `appleVibe` hexes + the user's voice/vocab/tensions/no-gos), prepended into both compose calls. New file: [`taste-design-block.ts`](src/lib/objective-canvas/tech-spec/taste-design-block.ts).

### Step 2 — frontend-design skill ✅
Anthropic's official skill vendored verbatim into [`frontend-design /SKILL.md`](frontend-design /SKILL.md). Loader at [`frontend-design-skill.ts`](src/lib/objective-canvas/tech-spec/frontend-design-skill.ts).

### Step 3 — shadcn vocabulary primer ✅
Distilled from `ui.shadcn.com/r/index.json`. 56 canonical primitives + composition DNA (cn/cva/Radix). [`shadcn /SKILL.md`](shadcn /SKILL.md). MCP integration deferred until T2 generates real npm-installable React (chip-worthy follow-on).

### Step 4 — T1 safety ✅
DOMPurify 3.4.8 + `sandbox="allow-scripts"` null-origin + deny-all CSP meta injected at top of `<head>`. Three independent layers. New file: [`sanitize-prototype-t1.ts`](src/lib/objective-canvas/tech-spec/sanitize-prototype-t1.ts). 8/8 behavioral assertions pass.

### Step 5 — Multi-input refine ✅
`linkedObjectIds[]` → traverses `object_links`, hydrates `image_narrative` + `concept_slug` + sibling-prototype titles via `library_objects` ↔ `ingested_files` ↔ `artifacts`. New file: [`hydrate-refine-context.ts`](src/lib/objective-canvas/tech-spec/hydrate-refine-context.ts). 8/8 composer assertions pass.

**Drag-to-wire UX deferred to chip `task_145fcc16`** (whiteboard-base.tsx is hot under parallel-session edits; cleaner to land that in its own worktree).

### Step 6 — Read draw-a-ui ✅
4 files / ~300 lines / MIT. Punchlist of what NOT to build in T2: no streaming, no Code/Preview tab, no modal preview, no image-input as primary path. Applied to Step 7.

### Step 7 — T2 tier (Sandpack) ✅
Sandpack 2.20.0 (caveat: "limited maintenance" since March 2026 — esbuild-wasm DIY fallback noted for future migration). New files:
- [`compose-prototype-react.ts`](src/lib/objective-canvas/tech-spec/compose-prototype-react.ts) — Opus emits JSON `{ entry, files }`.
- [`sanitize-react-t2.ts`](src/lib/objective-canvas/tech-spec/sanitize-react-t2.ts) — import allowlist + banned-API regex + byte/file caps + strict path validator.
- [`sandpack-template.ts`](src/lib/objective-canvas/tech-spec/sandpack-template.ts) — boot files (index.html with Tailwind JIT CDN, React 18 root, cn() helper) + dep manifest.
- [`prototype-react-shape.tsx`](src/components/objective/shapes/prototype-react-shape.tsx) — tldraw shape.
- [`prototype-react/route.ts`](src/app/api/canvas/prototype-react/route.ts) — POST handler.

Registered in [`board-shape-utils.ts`](src/components/objective/board-shape-utils.ts) so the shape renders on the board.

### Step 8 — T3 tier (DEFERRED)
Only when a prototype actually needs `npm install` or a backend route. WebContainers (commercial license at scale) vs E2B (server-side, paid hosting). Do not pre-build.

---

## Still missing (open follow-ons)

1. **Drag-to-wire UI overlay on the prototype shape** — chip `task_145fcc16`.
2. **Board entry point for T2 ("Build React prototype" button)** — `/api/canvas/prototype-react` is live, the shape is registered, but no UI yet fires the build. Easiest landing: extend `objective-board:build-prototype` to take a `tier: "html" | "react"` flag and add a small toggle next to the existing "Build prototype" button. Not done because the build-prototype event handler lives in whiteboard-base.tsx (parallel-session hot zone) — better as its own chip.
3. **T2 refine round-trip** — `refinePrototypeReact()` helper exists in compose-prototype-react.ts but the route only exposes generate; refine route to come when iteration becomes useful.
4. **T2 persistence to `artifacts` table** — needs the entry point first.
5. **shadcn MCP** — requires a tool-use loop in `anthropic.messages.create()`; deferred until T2 traffic justifies it.

## Recurring risk: parallel-session clobber

Per memory `project_parallel_workstreams`, parallel sessions co-edit `whiteboard-base.tsx`, `compose-prototype.ts`, `prototype-card-shape.tsx`, and similar hot files. **This session has been clobbered twice** (mid-Step 4 and again before the final polish). Re-application went smoothly each time. If clobbered again: re-apply from this plan + the new files (they survive — they're untracked).

## Reference repos

- **T0/T1 reference:** [SawyerHood/draw-a-ui](https://github.com/SawyerHood/draw-a-ui) — same stack as ours.
- **T2 template:** [claudio-silva/claude-artifact-runner](https://github.com/claudio-silva/claude-artifact-runner) — exact Artifact dependency set.
- **T3 reference:** [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) — MIT WebContainers clone.
- **Image-grounded UI generation:** [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) — 71k★ multi-model pipeline.
- **Leaked system prompts to diff:** [x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools) — v0, Lovable, Bolt, Cursor verbatim.

## Safety constraints

- Iframe combo: `sandbox="allow-scripts"` WITHOUT `allow-same-origin` (null-origin; can't unset its own sandbox).
- srcdoc inherits parent CSP — DOMPurify wedges an explicit deny-all CSP at top of `<head>`.
- DOMPurify v3.4.8 minimum (first-party TS types, Trusted Types support, OWASP-active).
- `vm2` is DEAD as of Oct 2025 (9.8 CVSS escape) — if any server-side eval is added, use isolated-vm.
- Sandpack's bundler iframe runs at codesandbox.io's origin — separate sandbox; our null-origin rules don't apply identically. Server-side `sanitizeReactT2` is the layer that matters for T2.

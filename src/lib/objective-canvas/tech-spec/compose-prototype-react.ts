// ── compose-prototype-react — Opus → multi-file React for Sandpack ──
//
// The T2 sibling of compose-prototype. Shares the same skill stack (UI
// agent + frontend-design + shadcn primer) and the same taste injection
// (DESIGN.md + tailwind.config.ts block), but Opus emits JSON instead of
// a single HTML doc:
//
//   { entry: "/App.tsx", files: { "/App.tsx": "...", "/Foo.tsx": "..." } }
//
// We validate the JSON, run sanitizeReactT2 (import allowlist + banned APIs
// + byte caps), and return a normalized `{ entry, files }` ready to splice
// into the Sandpack template. The shape's renderer wraps with our boot
// files (index.html with Tailwind CDN + index.tsx React-18 root + lib/cn).
//
// Per Step 6 (draw-a-ui review): keep this MINIMAL. No streaming, no
// chunked render, no separate Code/Preview tabs. One fetch → validated
// files → Sandpack renders.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import { loadFrontendDesignSkill } from "./frontend-design-skill";
import { loadShadcnSkill } from "./shadcn-skill";
import {
  sanitizeReactT2,
  type SanitizeResult,
} from "./sanitize-react-t2";
import type { TasteDesignContext } from "./taste-design-block";
import type { TechSpec } from "./types";

const OPUS_MODEL = BEST_CLAUDE_MODEL;

export interface ReactPrototype {
  entry: string;
  files: Record<string, string>;
}

const BASE_RULES = `Hard rules:
- Emit STRICT JSON: { "entry": "/App.tsx", "files": { "/App.tsx": "...", "/Foo.tsx": "..." } }.
- entry MUST be "/App.tsx" (the boot files import App from there).
- Files keys start with "/", end with .tsx / .ts / .jsx / .js / .css / .json.
- React 18 + Tailwind (preloaded via the project's tailwind CDN — write classNames freely).
- Allowed imports: react, react-dom, lucide-react, clsx, tailwind-merge, recharts, three, @react-three/fiber, @react-three/drei, "./lib/cn" (a cn() helper is already wired). And relative paths within your own files.
- DO NOT import shadcn from a registry — if you need a primitive, build it inline with Radix-style composition + Tailwind. Hand-roll <Button>, <Card> etc. as small components.
- NO fetch / XMLHttpRequest / WebSocket / EventSource. Prototypes are offline; use useState + realistic placeholder data.
- NO localStorage / sessionStorage / indexedDB / eval / new Function / dynamic import().
- NO inline event handlers — use onClick={fn}, etc., as JSX props (which is fine, that's normal React; the ban is on the HTML on* attribute form which doesn't apply to React).
- Make it feel REAL: concrete copy, realistic data, the key components from the UI plan, real interactivity (state, animations, keyboard nav). Surface a non-happy-path state (empty/loading) somewhere.
- Honor the design language from the brief (glass tier, density, motion intent, accent, hero pattern).
- Cap: ≤ 16 files, ≤ 32KB per file, ≤ 200KB total. Aim for 1–6 files; don't sprawl.
- Return ONLY the JSON object — no prose, no markdown fence.`;

const TASTE_RULE = `When a DESIGN.md and/or tailwind.config.ts block is provided below, treat them as the project-level taste contract. The user's vocabulary terms (marked "yours") must appear verbatim where natural; their anti-patterns must not appear at all; the brand color/radius/shadow tokens MUST shape your Tailwind className choices — use bg-[#hex], text-[#hex], rounded-[Npx], shadow-[…] arbitrary-value classes so the hexes from the contract land literally.`;

const GENERATE_SYSTEM = `You are a senior product designer + front-end engineer. Produce a high-fidelity, INTERACTIVE multi-file React prototype of this product's primary screen(s) from its technical spec + UI plan. ${BASE_RULES} ${TASTE_RULE}`;

const REFINE_SYSTEM = `You are a senior product designer + front-end engineer iterating on an existing React prototype. Apply the user's feedback precisely while preserving everything that works. ${BASE_RULES} ${TASTE_RULE}`;

function tasteContextBlock(ctx: TasteDesignContext | null | undefined): string {
  if (!ctx || !ctx.hasContent) return "";
  const parts: string[] = [];
  if (ctx.designMd) parts.push(ctx.designMd);
  if (ctx.tailwindConfig)
    parts.push(`## tailwind.config.ts\n\n${ctx.tailwindConfig}`);
  return parts.join("\n\n") + "\n\n";
}

function specBrief(spec: TechSpec): string {
  return JSON.stringify(
    {
      title: spec.title,
      overview: spec.overview,
      target_users: spec.target_users,
      ui_plan: spec.ui_plan,
      features: spec.features.map((f) => ({
        name: f.name,
        description: f.description,
      })),
    },
    null,
    2,
  );
}

/** Pull the JSON payload out of the model's reply. Accepts a fenced block,
 *  a bare object, or a noisy response with a JSON island. */
function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  const slice = body.slice(start, end + 1);
  return JSON.parse(slice);
}

async function opusReact(
  system: string,
  user: string,
): Promise<{ prototype: ReactPrototype; sanitizer: SanitizeResult }> {
  const [uiSkillPrefix, frontendDesignPrefix, shadcnPrefix] = await Promise.all([
    loadUiSkillSystem(),
    loadFrontendDesignSkill(),
    loadShadcnSkill(),
  ]);
  const anthropic = getAnthropicClient();
  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      max_tokens: 16000,
      system: [uiSkillPrefix, frontendDesignPrefix, shadcnPrefix, system]
        .filter(Boolean)
        .join("\n\n"),
      messages: [{ role: "user", content: user }],
    },
    { timeout: 5 * 60 * 1000 },
  );
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

  const raw = extractJson(text) as { entry?: unknown; files?: unknown };
  const entry =
    typeof raw.entry === "string" && raw.entry.trim() ? raw.entry : "/App.tsx";
  const sanitizer = sanitizeReactT2(raw.files);
  if (!sanitizer.ok) {
    // Hand back a soft-error file the shape can render in lieu of the prototype.
    return {
      prototype: {
        entry: "/App.tsx",
        files: {
          "/App.tsx": `export default function App() {
  return (
    <div className="p-6 text-slate-700 text-sm">
      <p className="font-semibold mb-1">Prototype rejected by sanitizer.</p>
      <p className="text-slate-500">${(sanitizer.reason ?? "unknown").replace(/[<>]/g, "")}</p>
    </div>
  );
}
`,
        },
      },
      sanitizer,
    };
  }
  return {
    prototype: { entry, files: sanitizer.files },
    sanitizer,
  };
}

/** Generate the first T2 React prototype from a TechSpec. */
export async function composePrototypeReact(
  spec: TechSpec,
  taste?: TasteDesignContext | null,
): Promise<{ prototype: ReactPrototype; sanitizer: SanitizeResult }> {
  return opusReact(
    GENERATE_SYSTEM,
    `${tasteContextBlock(taste)}Build the multi-file React prototype for this product.\n\nSPEC + UI PLAN:\n${specBrief(
      spec,
    )}`,
  );
}

/** Regenerate the T2 React prototype with feedback applied. */
export async function refinePrototypeReact(
  currentFiles: Record<string, string>,
  feedback: string,
  spec: TechSpec | null,
  taste?: TasteDesignContext | null,
  linkedContext?: string,
): Promise<{ prototype: ReactPrototype; sanitizer: SanitizeResult }> {
  const currentBlock =
    currentFiles && Object.keys(currentFiles).length
      ? `CURRENT FILES (JSON):\n${JSON.stringify(currentFiles).slice(0, 20000)}\n\n`
      : "CURRENT FILES: none — treat this as a retry; build from spec + feedback.\n\n";
  const linked = linkedContext && linkedContext.trim() ? `${linkedContext.trim()}\n\n` : "";
  return opusReact(
    REFINE_SYSTEM,
    tasteContextBlock(taste) +
      linked +
      currentBlock +
      (spec ? `PRODUCT CONTEXT:\n${specBrief(spec)}\n\n` : "") +
      `USER FEEDBACK:\n${feedback}\n\nReturn the full revised JSON object.`,
  );
}

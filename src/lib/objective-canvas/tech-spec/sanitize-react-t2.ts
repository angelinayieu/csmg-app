// ── sanitize-react-t2 — defenses for LLM-emitted React files ────────
//
// Sandpack runs in its OWN iframe at the codesandbox.io bundler origin —
// it can't read our cookies or hit our APIs. That's the runtime sandbox.
// THIS module is the static-source layer: we still want to keep the LLM's
// output predictable, bounded, and free of obvious foot-guns before we
// hand it to Sandpack to bundle.
//
// What this DOES:
//   - Caps file count (≤ 16) and per-file bytes (≤ 32KB) and total bytes (≤ 200KB).
//   - Whitelists import specifiers against T2_IMPORT_ALLOWLIST + relative
//     paths within the project. Anything else fails the whole submission.
//   - Bans dynamic code execution: `eval(`, `new Function(`, `import(`,
//     `Function(`. These work in a JS file but are foot-guns for review +
//     would let the model exfiltrate via fetch() if Sandpack ever proxies.
//   - Bans direct network APIs in source: `fetch(`, `XMLHttpRequest`,
//     `WebSocket(`, `EventSource(`. The prototype is offline by design;
//     reads from network-free state, not live data.
//   - Bans `localStorage`/`sessionStorage`/`indexedDB` to keep prototypes
//     stateless across refreshes (state should be useState only).
//
// What this DOESN'T do:
//   - Parse the AST. Cheap string scans suffice; sneaky obfuscation is
//     out-of-scope for a creative-tools sandbox.
//   - Validate semantic correctness. That's Sandpack's bundler's job.
//
// Returns: { ok: true, files } on success, { ok: false, reason } otherwise.
// Soft-fails the prototype call → renders a friendly error instead of 500.

import { T2_IMPORT_ALLOWLIST } from "./sandpack-template";

export interface SanitizeResult {
  ok: boolean;
  files: Record<string, string>;
  reason: string | null;
}

const MAX_FILES = 16;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024;

const BANNED_API_PATTERNS: RegExp[] = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bFunction\s*\(\s*["'`]/,
  /\bimport\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnew\s+WebSocket\s*\(/,
  /\bnew\s+EventSource\s*\(/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
];

const SAFE_FILE_EXT = /\.(tsx|ts|jsx|js|css|json)$/i;
// Path body uses alphanumeric + `_` + `-` + `/` only (no `.` or `..` segments).
// One `.ext` suffix at the end. Rejects `/.././x`, `/foo/../bar`, etc.
const SAFE_PATH = /^\/[a-zA-Z0-9_\-/]+\.[a-zA-Z0-9]+$/;

/** Top-level entry point. Pass the raw `files` map the LLM returned;
 *  receive either a clean copy or a rejection with the first reason found. */
export function sanitizeReactT2(rawFiles: unknown): SanitizeResult {
  if (!rawFiles || typeof rawFiles !== "object") {
    return reject("files must be an object");
  }
  const entries = Object.entries(rawFiles as Record<string, unknown>);
  if (entries.length === 0) return reject("no files emitted");
  if (entries.length > MAX_FILES)
    return reject(`too many files (${entries.length} > ${MAX_FILES})`);

  let total = 0;
  const cleaned: Record<string, string> = {};
  for (const [path, contents] of entries) {
    if (typeof path !== "string" || typeof contents !== "string")
      return reject(`bad entry shape at ${path}`);
    if (!SAFE_PATH.test(path)) return reject(`unsafe path: ${path}`);
    if (!SAFE_FILE_EXT.test(path))
      return reject(`unsupported file ext: ${path}`);
    const bytes = Buffer.byteLength(contents, "utf8");
    if (bytes > MAX_FILE_BYTES)
      return reject(`${path}: file too large (${bytes} bytes)`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES)
      return reject(`total project size exceeds ${MAX_TOTAL_BYTES} bytes`);

    // Banned APIs.
    for (const pat of BANNED_API_PATTERNS) {
      if (pat.test(contents)) {
        return reject(`${path}: banned API ${pat.source}`);
      }
    }

    // Import allowlist — only for code files (not JSON/CSS).
    if (/\.(tsx|ts|jsx|js)$/i.test(path)) {
      const offenders = scanImports(contents).filter(
        (spec) => !isAllowedImport(spec, path),
      );
      if (offenders.length) {
        return reject(`${path}: disallowed imports ${offenders.join(", ")}`);
      }
    }

    cleaned[path] = contents;
  }
  return { ok: true, files: cleaned, reason: null };
}

function reject(reason: string): SanitizeResult {
  return { ok: false, files: {}, reason };
}

/** Pull every import specifier out of a source file via regex. Covers:
 *    import x from "spec"; import "spec"; import {a} from "spec";
 *    import * as x from "spec"; export {x} from "spec"; export * from "spec";
 *  Ignores comments? — no; banned comments are an explicit non-goal. The
 *  bundler will see them; if Opus comments out a malicious import there's
 *  bigger problems. */
function scanImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:.*?\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function isAllowedImport(spec: string, fromPath: string): boolean {
  if (T2_IMPORT_ALLOWLIST.has(spec)) return true;
  // Relative imports are allowed (Sandpack will resolve them against the
  // project files; bundler will fail if they don't exist).
  if (spec.startsWith("./") || spec.startsWith("../")) return true;
  // Strip subpaths from a dep: `@react-three/fiber/foo` → `@react-three/fiber`.
  for (const allowed of T2_IMPORT_ALLOWLIST) {
    if (spec === allowed) return true;
    if (spec.startsWith(allowed + "/")) return true;
  }
  // Unknown bare specifiers are rejected. From-path used for logging only.
  void fromPath;
  return false;
}

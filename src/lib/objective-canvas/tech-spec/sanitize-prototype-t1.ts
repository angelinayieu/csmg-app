// ── sanitizeHtmlT1 — sanitize-html-based, T1-tier sanitizer ───────
//
// Pre-requisite for letting Opus emit any JavaScript at all.
//
// Tier T1 contract (vs the existing kill-all sanitizeHtml in generate-mockup):
//   ALLOWED:
//     - Inline <script> blocks (so the prototype can have real state)
//     - Inline <style>
//     - Data: image URLs (so a charts library inlining SVG works)
//   DENIED:
//     - Any external resource: no remote <script src>, <link href>, <img src>,
//       <iframe src>, <object>, <embed>, <form action>, <a href> protocols
//       beyond `#`, `data:image/`, `mailto:`, `tel:`.
//     - Inline event handlers (onclick=...) — we strip these via transformTags.
//     - javascript: / data:text/html in href/src.
//     - <base>, <meta http-equiv> tags from the LLM (we inject our own CSP).
//
// The iframe is rendered with sandbox="allow-scripts" (NOT allow-same-origin)
// so the document runs in a null origin: even if the sanitizer slipped, the
// script can't read parent cookies, fetch our APIs, or remove its own
// sandbox attribute. CSP + sandbox + sanitize-html = three independent layers.
//
// Why sanitize-html (not isomorphic-dompurify): isomorphic-dompurify pulls in
// jsdom on the server, and jsdom@29's html-encoding-sniffer transitively
// requires the ESM-only @exodus/bytes — which Vercel's Lambda runtime can't
// `require()` (no unflagged require(esm) on its Node), producing an
// ERR_REQUIRE_ESM at function cold-start. sanitize-html is pure CJS, uses
// htmlparser2 (dual-export, with a CJS build picked via the `require`
// condition), and ships zero ESM-only transitive deps.
//
// Reference: research bucket 7 (joshua.hu "One-Way Sandboxed Iframes" +
// HackTricks srcdoc inherits-parent-CSP gotcha).

import sanitizeHtml from "sanitize-html";

const FORBIDDEN_TAGS = new Set([
  "base",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
]);

const EXTRA_FORBIDDEN_ATTRS = new Set(["formaction"]);

const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "srcset",
  "background",
  "poster",
]);

const SAFE_URL_PREFIXES = ["#", "data:image/", "mailto:", "tel:"];

function isSafeUrl(value: string): boolean {
  const v = (value || "").trim().toLowerCase();
  if (!v) return true;
  // Block javascript: / vbscript: / data:text/html / file: / blob: / etc.
  if (
    v.startsWith("javascript:") ||
    v.startsWith("vbscript:") ||
    v.startsWith("data:text/html") ||
    v.startsWith("data:application/") ||
    v.startsWith("file:") ||
    v.startsWith("blob:") ||
    v.startsWith("ftp:")
  ) {
    return false;
  }
  // Allow only the known-safe prefixes (no remote http/https — T1 is offline).
  return SAFE_URL_PREFIXES.some((p) => v.startsWith(p));
}

const T1_CONFIG: sanitizeHtml.IOptions = {
  // allowedTags: false  →  allow every tag (we blocklist via exclusiveFilter).
  // The prototype is supposed to render a real product surface; the LLM picks
  // its own tag vocabulary. Forbidden tags are dropped below.
  allowedTags: false,
  // allowedAttributes: false  →  allow every attribute (we strip on* event
  // handlers + formaction + http-equiv + unsafe URLs via transformTags).
  allowedAttributes: false,
  // Explicit re-allow of <script> + <style>. sanitize-html flags these as
  // "vulnerable" by default; here they're load-bearing for interactivity.
  // Safety is enforced by the iframe sandbox (null origin) + CSP layers.
  allowVulnerableTags: true,
  // sanitize-html's built-in URL scheme filter runs BEFORE our transformTags
  // attr filter, so any scheme NOT listed here is stripped before we see it.
  // Open the list to everything we might keep (data: is critical for inline
  // SVG/image data URLs) — our transformTags + isSafeUrl below does the real
  // precision filtering (e.g. data:image/* yes, data:text/html no).
  allowedSchemes: ["http", "https", "data", "mailto", "tel", "ftp"],
  allowedSchemesAppliedToAttributes: [
    "href",
    "src",
    "action",
    "formaction",
    "srcset",
    "background",
    "poster",
    "cite",
  ],
  // Preserve SVG tag/attribute case (path, viewBox, etc.).
  parser: {
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
  },
  // Drop forbidden tags entirely (their text content goes too).
  exclusiveFilter: (frame) => FORBIDDEN_TAGS.has(frame.tag.toLowerCase()),
  // Strip event handlers, formaction, http-equiv (we inject our own CSP),
  // and any URL attribute pointing somewhere the T1 contract doesn't allow.
  transformTags: {
    "*": (tagName: string, attribs: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [name, value] of Object.entries(attribs)) {
        const lower = name.toLowerCase();
        if (lower.startsWith("on")) continue; // onclick / onload / …
        if (EXTRA_FORBIDDEN_ATTRS.has(lower)) continue;
        if (tagName.toLowerCase() === "meta" && lower === "http-equiv") continue;
        if (URL_ATTRS.has(lower) && !isSafeUrl(value)) continue;
        out[name] = value;
      }
      return { tagName, attribs: out };
    },
  },
};

/** The T1 CSP. Renders inside a `sandbox="allow-scripts"` iframe whose origin
 *  is null, so 'self' is meaningless — everything must be 'none' or
 *  'unsafe-inline'. This locks the document to its own inline code; no
 *  exfiltration, no remote loads, no nested iframes, no form submission. */
const T1_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data:; " +
  "font-src 'none'; " +
  "connect-src 'none'; " +
  "frame-src 'none'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none';";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${T1_CSP}">`;

/** Sanitize the LLM's HTML for the T1 iframe runtime. Returns a complete
 *  document with the original <!DOCTYPE> preserved and our CSP meta injected
 *  at the top of <head>. Empty/invalid input returns a minimal empty doc. */
export function sanitizeHtmlT1(html: string): string {
  if (!html || typeof html !== "string") {
    return `<!DOCTYPE html><html><head>${CSP_META}</head><body></body></html>`;
  }
  // Preserve the leading DOCTYPE — sanitize-html drops it from the output,
  // but T1 documents are full standalone pages and the browser needs the
  // DOCTYPE to enter standards mode.
  const doctypeMatch = html.match(/^\s*<!DOCTYPE[^>]*>/i);
  const doctype = doctypeMatch ? doctypeMatch[0].trim() : "<!DOCTYPE html>";
  const cleaned = sanitizeHtml(html, T1_CONFIG);
  return injectCspMeta(`${doctype}${cleaned}`);
}

/** Inject the CSP meta tag as the FIRST child of <head>. If the doc has no
 *  <head>, synthesize one. Regex-based — sanitize-html already parsed; doing
 *  it here means we own the precedence — CSP is the first byte the browser
 *  sees in <head>. */
function injectCspMeta(doc: string): string {
  if (doc.includes(CSP_META)) return doc;
  const headOpen = doc.match(/<head\b[^>]*>/i);
  if (headOpen) {
    const idx = headOpen.index! + headOpen[0].length;
    return doc.slice(0, idx) + CSP_META + doc.slice(idx);
  }
  // No <head> — wedge one in immediately after <html ...> (or at the very
  // start if no <html>).
  const htmlOpen = doc.match(/<html\b[^>]*>/i);
  if (htmlOpen) {
    const idx = htmlOpen.index! + htmlOpen[0].length;
    return doc.slice(0, idx) + `<head>${CSP_META}</head>` + doc.slice(idx);
  }
  return `<head>${CSP_META}</head>${doc}`;
}

/** Exposed for the preflight harness. */
export const T1_CSP_FOR_PREFLIGHT = T1_CSP;

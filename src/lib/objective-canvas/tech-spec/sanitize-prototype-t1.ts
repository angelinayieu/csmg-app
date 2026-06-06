// ── sanitizeHtmlT1 — DOMPurify-based, T1-tier sanitizer ────────────
//
// Pre-requisite for letting Opus emit any JavaScript at all.
//
// Tier T1 contract (vs the existing kill-all sanitizeHtml in generate-mockup):
//   ALLOWED:
//     - Inline <script> blocks (so the prototype can have real state)
//     - Inline event handlers (we strip these — see DENIED — but inline
//       <script> can wire `addEventListener` instead)
//     - Inline <style>
//     - Data: image URLs (so a charts library inlining SVG works)
//   DENIED:
//     - Any external resource: no remote <script src>, <link href>, <img src>,
//       <iframe src>, <object>, <embed>, <form action>, <a href> protocols
//       beyond `#`, `data:`, `mailto:`, `tel:`.
//     - Inline event handlers (onclick=...) — DOMPurify drops these by default.
//     - javascript: / data:text/html in href/src.
//     - <base>, <meta http-equiv> tags from the LLM (we inject our own CSP).
//
// The iframe is rendered with sandbox="allow-scripts" (NOT allow-same-origin)
// so the document runs in a null origin: even if the sanitizer slipped, the
// script can't read parent cookies, fetch our APIs, or remove its own
// sandbox attribute. CSP + sandbox + DOMPurify = three independent layers.
//
// Reference: research bucket 7 (joshua.hu "One-Way Sandboxed Iframes" +
// HackTricks srcdoc inherits-parent-CSP gotcha + DOMPurify v3.4.8 OWASP).

import DOMPurify from "isomorphic-dompurify";

const T1_CONFIG = {
  // Allow scripts back in — DOMPurify defaults strip them.
  ADD_TAGS: ["script", "style", "meta"],
  ADD_ATTR: ["target", "rel", "type"],
  // FORBID event handlers (DOMPurify already does this for the default
  // allowlist; re-asserting belt + suspenders for explicit-intent).
  FORBID_ATTR: [
    "onabort", "onafterprint", "onbeforeprint", "onbeforeunload",
    "onblur", "oncanplay", "oncanplaythrough", "onchange", "onclick",
    "oncontextmenu", "oncopy", "oncuechange", "oncut", "ondblclick",
    "ondrag", "ondragend", "ondragenter", "ondragleave", "ondragover",
    "ondragstart", "ondrop", "ondurationchange", "onemptied", "onended",
    "onerror", "onfocus", "onhashchange", "oninput", "oninvalid",
    "onkeydown", "onkeypress", "onkeyup", "onload", "onloadeddata",
    "onloadedmetadata", "onloadstart", "onmessage", "onmousedown",
    "onmouseenter", "onmouseleave", "onmousemove", "onmouseout",
    "onmouseover", "onmouseup", "onmousewheel", "onoffline", "ononline",
    "onpagehide", "onpageshow", "onpaste", "onpause", "onplay",
    "onplaying", "onpopstate", "onprogress", "onratechange", "onreset",
    "onresize", "onscroll", "onsearch", "onseeked", "onseeking",
    "onselect", "onshow", "onstalled", "onstorage", "onsubmit",
    "onsuspend", "ontimeupdate", "ontoggle", "onunload", "onvolumechange",
    "onwaiting", "onwheel", "formaction",
  ],
  // External-resource attributes we strip entirely. (DOMPurify allows
  // href/src by default; we re-allow them per-tag below via uri filter.)
  // Use hook below for URL filtering — these blanket FORBIDs are too coarse.
  FORBID_TAGS: ["base", "iframe", "object", "embed", "frame", "frameset"],
  WHOLE_DOCUMENT: true,
  // Required to keep the <!DOCTYPE html> + <html><head><body> structure
  // that BASE_RULES require.
  ALLOW_DATA_ATTR: true,
  RETURN_TRUSTED_TYPE: false,
};

const SAFE_URL_PREFIXES = ["#", "data:image/", "mailto:", "tel:"];

function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
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

// Register a hook ONCE — DOMPurify hooks are module-level. We tag with a
// symbol so re-imports (HMR) don't double-register.
const HOOK_FLAG = Symbol.for("ccd.shadcn-prototype.t1-hook");
type DPWithFlag = typeof DOMPurify & { [HOOK_FLAG]?: true };
if (!(DOMPurify as DPWithFlag)[HOOK_FLAG]) {
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    // Strip external URLs from href/src/action/formaction/srcset.
    const name = data.attrName;
    if (
      name === "href" ||
      name === "src" ||
      name === "action" ||
      name === "formaction" ||
      name === "srcset" ||
      name === "background" ||
      name === "poster"
    ) {
      const val = data.attrValue || "";
      if (!isSafeUrl(val)) {
        data.keepAttr = false;
      }
    }
    // Strip <meta http-equiv="…"> — we inject our own CSP.
    if (
      node.nodeName === "META" &&
      name === "http-equiv" &&
      typeof data.attrValue === "string"
    ) {
      data.keepAttr = false;
    }
  });
  (DOMPurify as DPWithFlag)[HOOK_FLAG] = true;
}

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
 *  document with our CSP meta injected at the top of <head>. Empty/invalid
 *  input returns a minimal empty doc. */
export function sanitizeHtmlT1(html: string): string {
  if (!html || typeof html !== "string") {
    return `<!DOCTYPE html><html><head>${CSP_META}</head><body></body></html>`;
  }
  const cleaned = DOMPurify.sanitize(html, T1_CONFIG) as string;
  return injectCspMeta(cleaned);
}

/** Inject the CSP meta tag as the FIRST child of <head>. If the doc has no
 *  <head>, synthesize one. Regex-based (DOMPurify already parsed; doing it
 *  here means we own the precedence — CSP is the first byte the browser
 *  sees in <head>). */
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
  return `<head>${CSP_META}</head>` + doc;
}

/** Exposed for the preflight harness. */
export const T1_CSP_FOR_PREFLIGHT = T1_CSP;

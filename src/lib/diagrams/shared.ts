/**
 * Shared helpers for the diagram generators.
 *
 * Mermaid is picky about node IDs (no spaces, no dots, no leading digits)
 * and fussy about label escaping. These helpers make the rest of the
 * generator code read like intent, not like character soup.
 */

/**
 * Sanitize an arbitrary string into a safe Mermaid node id.
 *   "C1_sub2"      → "C1_sub2"
 *   "Growth rate"  → "Growth_rate"
 *   "42 flavors"   → "n42_flavors"  (IDs can't start with a digit)
 */
export function toNodeId(input: string): string {
  const cleaned = (input ?? "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
  if (!cleaned) return "n_" + Math.random().toString(36).slice(2, 6);
  if (/^\d/.test(cleaned)) return "n" + cleaned;
  return cleaned;
}

/**
 * Escape a string for use inside a Mermaid node label.
 * Labels live in [...] / (...) / {...}  brackets; quote chars, pipes,
 * and braces inside them break the parser.
 */
export function escapeLabel(input: string): string {
  if (!input) return "";
  return input
    .replace(/"/g, "'")
    .replace(/\n/g, "<br/>")
    .replace(/[\[\]{}|<>]/g, (c) => {
      switch (c) {
        case "[":
          return "&#91;";
        case "]":
          return "&#93;";
        case "{":
          return "&#123;";
        case "}":
          return "&#125;";
        case "|":
          return "&#124;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        default:
          return c;
      }
    })
    .slice(0, 80); // cap label length so diagrams stay legible
}

/** Convenience: build a Mermaid node statement `ID["Label"]`. */
export function nodeLine(id: string, label: string, shape: "box" | "round" | "stadium" | "circle" = "box"): string {
  const safe = toNodeId(id);
  const esc = escapeLabel(label);
  switch (shape) {
    case "round":
      return `${safe}(("${esc}"))`;
    case "stadium":
      return `${safe}(["${esc}"])`;
    case "circle":
      return `${safe}((("${esc}")))`;
    case "box":
    default:
      return `${safe}["${esc}"]`;
  }
}

/**
 * Validation helpers for the ingest layer.
 *
 * Three kinds of checks live here:
 *   - File size + MIME allowlist (prevents accidental huge binaries)
 *   - URL shape (must parse, must be http/https)
 *   - SSRF safety (blocks private IP ranges so the server can't be used
 *     to fetch internal infra from a public endpoint)
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // OpenAI Vision soft cap
export const MAX_PDF_PAGES = 300;
export const MAX_EXTRACTED_CHARS = 500_000; // hard ceiling post-extraction
export const URL_FETCH_TIMEOUT_MS = 15_000;

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export type IngestError = {
  code:
    | "file_too_large"
    | "unsupported_type"
    | "invalid_url"
    | "ssrf_blocked"
    | "fetch_failed"
    | "extraction_failed"
    | "empty_content"
    | "too_many_pages"
    | "content_too_large";
  message: string;
};

export function validateFile(file: { size: number; type: string; name?: string }):
  | { ok: true; resolvedType: string }
  | { ok: false; error: IngestError } {
  // Some browsers send "" as MIME for uncommon extensions — fall back to filename
  const type = file.type || inferMimeFromName(file.name);
  const isImage = isImageMime(type);

  // Images get a tighter cap than documents (vision API token cost scales w/ resolution)
  const cap = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > cap) {
    return {
      ok: false,
      error: {
        code: "file_too_large",
        message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — exceeds the ${cap / 1024 / 1024} MB limit for ${isImage ? "images" : "documents"}.`,
      },
    };
  }

  if (!SUPPORTED_MIME_TYPES.includes(type as (typeof SUPPORTED_MIME_TYPES)[number])) {
    return {
      ok: false,
      error: {
        code: "unsupported_type",
        message: `Unsupported file type: ${type || "unknown"}. Supported: PDF, DOCX, TXT, Markdown, PNG, JPG, WEBP, GIF.`,
      },
    };
  }

  return { ok: true, resolvedType: type };
}

export function inferMimeFromName(name?: string): string {
  if (!name) return "";
  const ext = name.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt": return "text/plain";
    case "md": return "text/markdown";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    default: return "";
  }
}

/**
 * SSRF guard: rejects URLs that resolve to private / link-local / loopback
 * IP ranges, plus obviously-wrong schemes.
 *
 * Note: This is a first-pass defense. It does NOT do DNS resolution, so a
 * hostile DNS could bypass it. For a production app exposed to untrusted
 * users, a DNS-resolving check + re-check on redirect is also wise.
 */
export function validateUrl(raw: string):
  | { ok: true; url: URL }
  | { ok: false; error: IngestError } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: { code: "invalid_url", message: "Could not parse URL." } };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: { code: "invalid_url", message: "URL must be http or https." },
    };
  }

  const host = url.hostname.toLowerCase();

  // Block common internal hostnames
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return {
      ok: false,
      error: { code: "ssrf_blocked", message: "Internal hostnames are not allowed." },
    };
  }

  // Block private / link-local IPv4 ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    const privateRanges =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0;
    if (privateRanges) {
      return {
        ok: false,
        error: { code: "ssrf_blocked", message: "Private IP ranges are blocked." },
      };
    }
  }

  // Block IPv6 loopback / link-local (rough check — full parse is out of scope)
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return {
      ok: false,
      error: { code: "ssrf_blocked", message: "Private IP ranges are blocked." },
    };
  }

  return { ok: true, url };
}

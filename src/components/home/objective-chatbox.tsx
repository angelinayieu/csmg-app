"use client";

// ── Objective chatbox ──
//
// The centerpiece of the minimal home. A single white card where the
// user drops a thought + context, then hits "+" to spin up an objective
// canvas. Context comes from three real integrations:
//   • Files   — drag/drop or paperclip → POST /api/ingest (space_id null),
//               attached by id on submit (back-linked + folded into the
//               research seed by /api/brainstorm/start).
//   • tabs    — open browser tabs synced by the Chrome extension; attach
//               their URLs (scraped via the URL ingest path).
//   • drive   — Google Drive files picked via OAuth + the Google Picker.
//
// Files are wired end-to-end here. The tabs/drive popovers reflect the
// real connection state and hand off to the integration endpoints.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Paperclip,
  Plus,
  X,
  FileText,
  Globe,
  HardDrive,
  Check,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { openDrivePicker } from "@/components/home/drive-picker";

export interface SyncedTab {
  id: string;
  url: string;
  title: string | null;
  favicon_url: string | null;
  tab_group: string | null;
}

interface Props {
  /** Tabs synced from the browser extension (Phase 4). */
  syncedTabs: SyncedTab[];
  /** Whether the user has connected Google Drive (Phase 3). */
  driveConnected: boolean;
  /** Fired when composition starts/stops (objective becomes non-empty /
   *  empty) so the host can morph onto the whiteboard surface. */
  onActiveChange?: (active: boolean) => void;
}

type AttachmentStatus = "uploading" | "parsing" | "ready" | "error";
type AttachmentKind = "file" | "url" | "drive";

interface Attachment {
  localId: string;
  name: string;
  kind: AttachmentKind;
  status: AttachmentStatus;
  /** ingested_files id once the upload lands. */
  assetId?: string;
  error?: string;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,image/*";

export function ObjectiveChatbox({
  syncedTabs,
  driveConnected,
  onActiveChange,
}: Props) {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [popover, setPopover] = useState<"tabs" | "drive" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Signal the host when composition starts/stops (objective non-empty)
  // so the home can morph onto / off the whiteboard surface.
  useEffect(() => {
    onActiveChange?.(objective.trim().length > 0);
  }, [objective, onActiveChange]);

  // ── Attachment helpers ────────────────────────────────────────────
  const patch = useCallback(
    (localId: string, next: Partial<Attachment>) =>
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, ...next } : a)),
      ),
    [],
  );

  const removeAttachment = useCallback(
    (localId: string) =>
      setAttachments((prev) => prev.filter((a) => a.localId !== localId)),
    [],
  );

  // Poll parse-status for background-parsed assets (PDF/DOCX) so the chip
  // flips uploading → parsing → ready. Mirrors the triple-lab poller.
  const pollParse = useCallback(
    async (assetId: string, localId: string) => {
      const start = Date.now();
      while (Date.now() - start < 90_000) {
        await new Promise((r) => setTimeout(r, 1200));
        try {
          const res = await fetch(`/api/ingest/${assetId}/parse-status`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const body = (await res.json()) as {
            status?: string;
            error?: string | null;
          };
          if (body.status === "ready") return patch(localId, { status: "ready" });
          if (body.status === "error" || body.status === "skipped") {
            return patch(localId, {
              status: "error",
              error: body.error?.trim() || "Could not parse this file.",
            });
          }
        } catch {
          /* transient — keep polling */
        }
      }
      patch(localId, { status: "error", error: "Parse timed out." });
    },
    [patch],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const localId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `f-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAttachments((prev) => [
        ...prev,
        { localId, name: file.name, kind: "file", status: "uploading" },
      ]);
      const fd = new FormData();
      fd.append("file", file); // no space_id — claimed on submit
      try {
        const res = await fetch("/api/ingest", { method: "POST", body: fd });
        const json = (await res.json()) as {
          ingested_file_id?: string;
          awaiting_parse?: boolean;
          error?: string;
        };
        if (!res.ok || !json.ingested_file_id) {
          patch(localId, {
            status: "error",
            error: json.error ?? `Upload failed (HTTP ${res.status}).`,
          });
          return;
        }
        patch(localId, {
          assetId: json.ingested_file_id,
          status: json.awaiting_parse ? "parsing" : "ready",
        });
        if (json.awaiting_parse) pollParse(json.ingested_file_id, localId);
      } catch (err) {
        patch(localId, {
          status: "error",
          error: err instanceof Error ? err.message : "Network error.",
        });
      }
    },
    [patch, pollParse],
  );

  const attachUrl = useCallback(
    async (url: string, label: string, kind: AttachmentKind = "url") => {
      // Skip if this URL is already attached.
      const localId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAttachments((prev) => [
        ...prev,
        { localId, name: label, kind, status: "uploading" },
      ]);
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "url", url }),
        });
        const json = (await res.json()) as {
          ingested_file_id?: string;
          error?: string;
        };
        if (!res.ok || !json.ingested_file_id) {
          patch(localId, {
            status: "error",
            error: json.error ?? "Could not read that page.",
          });
          return;
        }
        patch(localId, { assetId: json.ingested_file_id, status: "ready" });
      } catch (err) {
        patch(localId, {
          status: "error",
          error: err instanceof Error ? err.message : "Network error.",
        });
      }
    },
    [patch],
  );

  // ── Drag + drop ───────────────────────────────────────────────────
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      files.forEach(uploadFile);
    },
    [uploadFile],
  );

  // ── Submit ────────────────────────────────────────────────────────
  const uploadingNow = attachments.some((a) => a.status === "uploading");
  const canSubmit = objective.trim().length >= 4 && !submitting && !uploadingNow;

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!canSubmit) return;
      setError(null);
      const attachedFileIds = attachments
        .filter((a) => a.assetId && a.status !== "error")
        .map((a) => a.assetId as string);
      startTransition(async () => {
        try {
          const res = await fetch("/api/brainstorm/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              objective: objective.trim(),
              // Land directly on the stripped canvas — no autopilot
              // sub-objective generation we'd only hide in minimal mode.
              mode: "human",
              // Minimal-mode intake: only the Prompt Sharpening Card runs;
              // skip the old pipeline (research + annotations + rooms).
              sharpenOnly: true,
              attachedFileIds,
            }),
          });
          const json = (await res.json()) as
            | { spaceId: string }
            | { error: string };
          if (!res.ok || !("spaceId" in json)) {
            setError(
              "error" in json ? json.error : "Could not start. Try again.",
            );
            return;
          }
          router.push(`/app/objective/${json.spaceId}`);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Network error.",
          );
        }
      });
    },
    [attachments, canSubmit, objective, router],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* ── Main card ── */}
      <form
        onSubmit={handleSubmit}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={onDrop}
        className="relative"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${
            dragging ? appleVibe.stroke.medium : appleVibe.stroke.soft
          }`,
          borderRadius: appleVibe.radius.xl,
          boxShadow: appleVibe.shadow.card,
          transition: "border-color 0.2s ease, box-shadow 0.3s ease",
        }}
      >
        {/* Drag overlay */}
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
              style={{
                borderRadius: appleVibe.radius.xl,
                background: "rgba(15,23,42,0.04)",
                border: `1.5px dashed ${appleVibe.stroke.medium}`,
              }}
            >
              <span
                className="text-[13px] font-semibold"
                style={{ color: appleVibe.text.secondary }}
              >
                Drop files to attach
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Eyebrow */}
        <div className="flex items-center gap-1.5 px-5 pt-4">
          <span
            aria-hidden
            className="text-[10px] leading-none"
            style={{ color: appleVibe.text.faint, letterSpacing: "1px" }}
          >
            ⠿
          </span>
          <span
            className="text-[11px] font-semibold"
            style={{ color: appleVibe.text.tertiary }}
          >
            Objective
          </span>
        </div>

        {/* Thought input */}
        <textarea
          value={objective}
          onChange={(e) => {
            setObjective(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={4000}
          placeholder="What are you working on?"
          className="block w-full resize-none bg-transparent px-5 pb-2 pt-3 text-[16px] leading-relaxed outline-none placeholder:font-light"
          style={{ color: appleVibe.text.primary, minHeight: 64 }}
        />

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-1">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.localId}
                attachment={a}
                onRemove={() => removeAttachment(a.localId)}
              />
            ))}
          </div>
        )}

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-4 pb-3.5 pt-1.5">
          <div className="flex items-center gap-1.5">
            <ToolbarIconButton
              label="Attach files"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" strokeWidth={1.9} />
            </ToolbarIconButton>

            <SourceChip
              label="tabs"
              active={popover === "tabs"}
              onClick={() => setPopover((p) => (p === "tabs" ? null : "tabs"))}
            />
            <SourceChip
              label="drive"
              active={popover === "drive"}
              onClick={() => setPopover((p) => (p === "drive" ? null : "drive"))}
            />
          </div>

          <motion.button
            type="submit"
            disabled={!canSubmit}
            aria-label="Create objective"
            whileHover={canSubmit ? { scale: 1.05 } : undefined}
            whileTap={canSubmit ? { scale: 0.94 } : undefined}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
            style={{
              background: canSubmit
                ? appleVibe.accent.primary
                : "rgba(15,23,42,0.06)",
              color: canSubmit ? "white" : appleVibe.text.faint,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                className="block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent"
              />
            ) : (
              <Plus className="h-5 w-5" strokeWidth={2.5} />
            )}
          </motion.button>
        </div>

        {/* Source popovers */}
        <AnimatePresence>
          {popover === "tabs" && (
            <TabsPopover
              tabs={syncedTabs}
              attachedUrls={new Set(
                attachments.filter((a) => a.kind === "url").map((a) => a.name),
              )}
              onAttach={(t) => attachUrl(t.url, t.title || t.url, "url")}
              onClose={() => setPopover(null)}
            />
          )}
          {popover === "drive" && (
            <DrivePopover
              connected={driveConnected}
              onPicked={(name, assetId) =>
                setAttachments((prev) => [
                  ...prev,
                  {
                    localId:
                      typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? crypto.randomUUID()
                        : `d-${Date.now()}`,
                    name,
                    kind: "drive",
                    status: "ready",
                    assetId,
                  },
                ])
              }
              onClose={() => setPopover(null)}
            />
          )}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            files.forEach(uploadFile);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      </form>

      {/* ── Synced-tabs status strip ── */}
      <SyncedStrip tabs={syncedTabs} />

      {error && (
        <div
          className="mt-2 rounded-xl px-3.5 py-2.5 text-[12.5px]"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "rgba(127,29,29,0.95)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ── Attachment chip ──────────────────────────────────────────────────

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const Icon =
    attachment.kind === "url"
      ? Globe
      : attachment.kind === "drive"
        ? HardDrive
        : FileText;
  const isError = attachment.status === "error";
  const isBusy =
    attachment.status === "uploading" || attachment.status === "parsing";
  return (
    <span
      className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full py-1 pl-2 pr-1"
      style={{
        background: isError ? "rgba(220,38,38,0.06)" : appleVibe.surface.chip,
        border: `1px solid ${
          isError ? "rgba(220,38,38,0.18)" : appleVibe.stroke.hairline
        }`,
      }}
      title={isError ? attachment.error : attachment.name}
    >
      {isBusy ? (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
          className="block h-3 w-3 rounded-full border-[1.5px] border-current border-r-transparent"
          style={{ color: appleVibe.text.tertiary }}
        />
      ) : isError ? (
        <X className="h-3 w-3" style={{ color: "rgba(127,29,29,0.9)" }} />
      ) : (
        <Icon className="h-3 w-3" style={{ color: appleVibe.text.tertiary }} />
      )}
      <span
        className="truncate text-[11.5px] font-medium"
        style={{
          color: isError ? "rgba(127,29,29,0.95)" : appleVibe.text.secondary,
        }}
      >
        {attachment.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-black/5"
      >
        <X className="h-3 w-3" style={{ color: appleVibe.text.faint }} />
      </button>
    </span>
  );
}

// ── Toolbar pieces ───────────────────────────────────────────────────

function ToolbarIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/5"
      style={{ color: appleVibe.text.tertiary }}
    >
      {children}
    </button>
  );
}

function SourceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
      style={{
        background: active ? appleVibe.accent.primary : "rgba(15,23,42,0.9)",
        color: "white",
      }}
    >
      {label}
    </button>
  );
}

// ── Tabs popover ─────────────────────────────────────────────────────

function TabsPopover({
  tabs,
  attachedUrls,
  onAttach,
  onClose,
}: {
  tabs: SyncedTab[];
  attachedUrls: Set<string>;
  onAttach: (t: SyncedTab) => void;
  onClose: () => void;
}) {
  return (
    <Popover onClose={onClose}>
      {tabs.length === 0 ? (
        <div className="px-3 py-3">
          <p
            className="text-[12.5px] font-semibold"
            style={{ color: appleVibe.text.secondary }}
          >
            No tabs synced yet
          </p>
          <p
            className="mt-1 text-[11.5px] font-light leading-snug"
            style={{ color: appleVibe.text.tertiary }}
          >
            Install the InterAxis tab-sync extension to pull your open research
            tabs in as context.
          </p>
          <a
            href="/app/connect/tabs"
            className="mt-2 inline-block text-[11.5px] font-semibold"
            style={{ color: appleVibe.stage.features }}
          >
            Connect browser tabs →
          </a>
        </div>
      ) : (
        <div className="max-h-[260px] overflow-y-auto py-1">
          {tabs.map((t) => {
            const attached = attachedUrls.has(t.title || t.url);
            return (
              <button
                key={t.id}
                type="button"
                disabled={attached}
                onClick={() => onAttach(t)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/[0.03] disabled:opacity-60"
              >
                <Globe
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: appleVibe.text.faint }}
                />
                <span
                  className="flex-1 truncate text-[12px] font-medium"
                  style={{ color: appleVibe.text.secondary }}
                >
                  {t.title || t.url}
                </span>
                {attached && (
                  <Check
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: appleVibe.stage.outcomes }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

// ── Drive popover ────────────────────────────────────────────────────

function DrivePopover({
  connected,
  onPicked,
  onClose,
}: {
  connected: boolean;
  onPicked: (name: string, assetId: string) => void;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick() {
    setErr(null);
    setWorking(true);
    try {
      await openDrivePicker(onPicked);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open Drive.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Popover onClose={onClose}>
      <div className="px-3 py-3">
        {connected ? (
          <>
            <p
              className="text-[12.5px] font-semibold"
              style={{ color: appleVibe.text.secondary }}
            >
              Google Drive connected
            </p>
            <button
              type="button"
              onClick={pick}
              disabled={working}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-60"
              style={{ background: appleVibe.accent.primary, color: "white" }}
            >
              <HardDrive className="h-3.5 w-3.5" strokeWidth={2} />
              {working ? "Opening…" : "Choose files"}
            </button>
          </>
        ) : (
          <>
            <p
              className="text-[12.5px] font-semibold"
              style={{ color: appleVibe.text.secondary }}
            >
              Connect Google Drive
            </p>
            <p
              className="mt-1 text-[11.5px] font-light leading-snug"
              style={{ color: appleVibe.text.tertiary }}
            >
              Pull in Docs, Sheets, and PDFs as context for your objective.
            </p>
            <a
              href="/api/integrations/google/start"
              className="mt-2 inline-block text-[11.5px] font-semibold"
              style={{ color: appleVibe.stage.features }}
            >
              Connect Drive →
            </a>
          </>
        )}
        {err && (
          <p
            className="mt-2 text-[11px]"
            style={{ color: "rgba(127,29,29,0.95)" }}
          >
            {err}
          </p>
        )}
      </div>
    </Popover>
  );
}

// ── Shared popover shell ─────────────────────────────────────────────

function Popover({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      {/* click-away */}
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="absolute bottom-[52px] left-4 z-30 w-[280px] overflow-hidden"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.md,
          boxShadow: appleVibe.shadow.cardHover,
        }}
      >
        {children}
      </motion.div>
    </>
  );
}

// ── Synced-tabs status strip (below the card) ────────────────────────

function SyncedStrip({ tabs }: { tabs: SyncedTab[] }) {
  if (tabs.length === 0) return null;
  // Group labels: tab_group when set, else the URL host.
  const groups = Array.from(
    new Set(
      tabs.map((t) => {
        if (t.tab_group) return t.tab_group;
        try {
          return new URL(t.url).hostname.replace(/^www\./, "");
        } catch {
          return "tabs";
        }
      }),
    ),
  ).slice(0, 6);

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5"
      style={{
        background: "rgba(255,255,255,0.6)",
        border: `1px dashed ${appleVibe.stroke.soft}`,
      }}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: appleVibe.stage.outcomes }}
        />
        <span
          className="text-[12px] font-semibold"
          style={{ color: appleVibe.text.secondary }}
        >
          tabs synced
        </span>
      </span>
      {groups.map((g) => (
        <span
          key={g}
          className="text-[12px] font-light"
          style={{ color: appleVibe.text.tertiary }}
        >
          {g}
        </span>
      ))}
    </div>
  );
}

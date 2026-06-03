"use client";

// ── ChatboxCardShapeUtil ──
//
// The intake chatbox AS A CARD on the board. The user types their objective
// directly on the whiteboard; on submit it promotes the draft space and
// transforms IN PLACE into an objective-card (PROMOTE_TO_OBJECTIVE_EVENT),
// with the Prompt Sharpening Card forking below. Interactive-input pattern
// proven by prototype-card-shape (stopEventPropagation + canEdit=false).
//
// CRITICAL: keydown must stopPropagation or tldraw deletes the shape on
// Backspace/Delete while the user is typing.

import { useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Paperclip, Plus, FileText } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { PROMOTE_TO_OBJECTIVE_EVENT } from "@/components/objective/board-bus";

export type ChatboxCardShape = TLBaseShape<
  "chatbox-card",
  {
    w: number;
    h: number;
    spaceId: string;
    /** seed text carried from the home chatbox (sessionStorage). */
    seedText: string;
    color: string;
  }
>;

export class ChatboxCardShapeUtil extends BaseBoxShapeUtil<ChatboxCardShape> {
  static override type = "chatbox-card" as const;
  static override props: RecordProps<ChatboxCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    seedText: T.string,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: ChatboxCardShape,
    info: TLResizeInfo<ChatboxCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): ChatboxCardShape["props"] {
    return {
      w: 420,
      h: 176,
      spaceId: "",
      seedText: "",
      color: appleVibe.accent.primary,
    };
  }

  component(shape: ChatboxCardShape) {
    return <ChatboxCardRenderer shape={shape} />;
  }

  indicator(shape: ChatboxCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={22} ry={22} />;
  }
}

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= 70 ? t : t.slice(0, 69).trimEnd() + "…";
}

function ChatboxCardRenderer({ shape }: { shape: ChatboxCardShape }) {
  const { spaceId } = shape.props;
  const [value, setValue] = useState(shape.props.seedText ?? "");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Autofocus + put the cursor at the end of the carried-over text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  async function uploadFile(file: File) {
    setUploading((n) => n + 1);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const json = (await res.json()) as { ingested_file_id?: string };
      if (res.ok && json.ingested_file_id) {
        setAssetIds((ids) => [...ids, json.ingested_file_id as string]);
      }
    } catch {
      /* soft-fail */
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }

  const canSubmit = value.trim().length >= 4 && !submitting && uploading === 0;

  async function submit() {
    if (!canSubmit) return;
    const objective = value.trim();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/objective/${spaceId}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective, attachedFileIds: assetIds }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Could not create. Try again.");
        setSubmitting(false);
        return;
      }
      // Transform this card → objective card in place + fork sharpening.
      window.dispatchEvent(
        new CustomEvent(PROMOTE_TO_OBJECTIVE_EVENT, {
          detail: {
            chatboxId: shape.id,
            spaceId,
            title: deriveTitle(objective),
            objective,
          },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        onPointerDown={stopEventPropagation}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 22,
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.card,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "11px 15px 0",
          }}
        >
          <span style={{ fontSize: 10, color: appleVibe.text.faint }}>⠿</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: appleVibe.text.tertiary,
            }}
          >
            Objective
          </span>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            // Stop tldraw from seeing the key (Backspace would delete the
            // shape; shortcuts would fire). Cmd/Ctrl+Enter submits.
            e.stopPropagation();
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="What are you working on?"
          rows={2}
          maxLength={4000}
          disabled={submitting}
          style={{
            flex: 1,
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: "6px 15px 4px",
            fontSize: 15.5,
            lineHeight: 1.4,
            color: appleVibe.text.primary,
            fontFamily: appleVibe.font.stack,
          }}
        />

        {error && (
          <div
            style={{
              padding: "0 15px",
              fontSize: 11.5,
              color: "rgba(127,29,29,0.95)",
            }}
          >
            {error}
          </div>
        )}

        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px 11px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach files"
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 32,
                height: 32,
                borderRadius: 999,
                border: "none",
                background: "transparent",
                color: appleVibe.text.tertiary,
                cursor: "pointer",
              }}
            >
              <Paperclip style={{ width: 16, height: 16 }} strokeWidth={1.9} />
            </button>
            {(assetIds.length > 0 || uploading > 0) && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 550,
                  color: appleVibe.text.tertiary,
                }}
              >
                <FileText style={{ width: 12, height: 12 }} strokeWidth={2} />
                {uploading > 0
                  ? `${assetIds.length}+${uploading}…`
                  : `${assetIds.length} attached`}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            aria-label="Create objective"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "none",
              background: canSubmit
                ? appleVibe.accent.primary
                : "rgba(15,23,42,0.06)",
              color: canSubmit ? "white" : appleVibe.text.faint,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? (
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  border: "2px solid currentColor",
                  borderRightColor: "transparent",
                  animation: "spin 0.9s linear infinite",
                }}
              />
            ) : (
              <Plus style={{ width: 20, height: 20 }} strokeWidth={2.5} />
            )}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            files.forEach(uploadFile);
            e.target.value = "";
          }}
        />
      </div>
    </HTMLContainer>
  );
}

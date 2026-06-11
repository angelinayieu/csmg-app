"use client";

// "Add anything" composer — one box that takes pasted text, a URL, or a
// pasted/picked image, and hands it to /api/trove/ingest for decomposition.
// Stays open with a live status while Opus chews (20-60s), then closes.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTrove } from "../_lib/store";

const PHASES = [
  "Reading what you dropped…",
  "Decomposing into concepts…",
  "Tracing causes and variables…",
  "Filing it into your folders…",
];

export function IngestComposer() {
  const { composerOpen, setComposerOpen, ingest, toast } = useTrove();
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (composerOpen) setTimeout(() => boxRef.current?.focus(), 60);
  }, [composerOpen]);

  useEffect(() => {
    if (!working) return;
    setPhase(0);
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 9000);
    return () => clearInterval(t);
  }, [working]);

  const readFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.split(",")[1] ?? "";
      if (base64) setImage({ base64, mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      for (const item of e.clipboardData?.items ?? []) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            readFile(file);
            return;
          }
        }
      }
    },
    [readFile],
  );

  const close = useCallback(() => {
    if (working) return;
    setComposerOpen(false);
    setText("");
    setImage(null);
  }, [working, setComposerOpen]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && !image) return;
    setWorking(true);
    const isUrl = /^https?:\/\/\S+$/i.test(trimmed) && !trimmed.includes("\n");
    const outcome = await ingest(
      image
        ? { image: { base64: image.base64, mediaType: image.mediaType }, text: trimmed || undefined }
        : isUrl
          ? { url: trimmed }
          : { text: trimmed },
    );
    setWorking(false);
    if (!outcome.ok) {
      toast(outcome.error ?? "Could not ingest that", "err");
      return;
    }
    setComposerOpen(false);
    setText("");
    setImage(null);
    toast(
      `“${outcome.rootTitle ?? "Saved"}” decomposed into ${outcome.childCount ?? 0} nodes${
        outcome.collectionName ? ` → ${outcome.collectionName}` : ""
      }`,
    );
  }, [text, image, ingest, toast, setComposerOpen]);

  if (!composerOpen) return null;

  return (
    <div className="tr-scrim" onClick={close} role="dialog" aria-label="Add to your trove">
      <div className="tr-composer" onClick={(e) => e.stopPropagation()}>
        <div className="tr-composer-head">
          <h2>Add anything</h2>
          <p>Paste an idea, an article link, or an image — Trove decomposes and files it.</p>
        </div>
        {image && (
          <div className="tr-composer-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.preview} alt="Pasted attachment" />
            {!working && (
              <button className="tr-composer-image-x" onClick={() => setImage(null)} aria-label="Remove image">
                ✕
              </button>
            )}
          </div>
        )}
        <textarea
          ref={boxRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          disabled={working}
          placeholder={
            image
              ? "Add a note about this image (optional)…"
              : "A concept, a hunch, a paragraph, a link…  (⌘V an image works too)"
          }
          rows={6}
        />
        <div className="tr-composer-foot">
          {working ? (
            <div className="tr-working">
              <span className="tr-working-dot" />
              {PHASES[phase]}
            </div>
          ) : (
            <button className="tr-btn-ghost" onClick={() => fileRef.current?.click()}>
              🖼️ Attach image
            </button>
          )}
          <div className="tr-composer-cta">
            <button className="tr-btn-ghost" onClick={close} disabled={working}>
              Cancel
            </button>
            <button
              className="tr-btn-primary"
              onClick={() => void submit()}
              disabled={working || (!text.trim() && !image)}
            >
              {working ? "Decomposing…" : "Add to trove"}
            </button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

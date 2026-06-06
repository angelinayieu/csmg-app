"use client";

// ── PrototypeReactShape (T2) ──
//
// T2 sibling of PrototypeCardShape. Renders multi-file React in a Sandpack
// preview iframe — Sandpack runs in its own bundler iframe at codesandbox.io
// so it can't reach our cookies or APIs. Files come from
// composePrototypeReact() and are MERGED with buildSandpackFiles() (which
// owns index.html / index.tsx / lib/cn — the model can't override these).
//
// Why this shape instead of extending PrototypeCardShape: completely different
// runtime (React + Sandpack vs static HTML iframe), different sanitizer
// (sanitizeReactT2 vs sanitizeHtmlT1), different state shape (files map vs
// html string). Forking is honest.
//
// IMPORTANT: this shape MUST also be declared in src/types/tldraw-shapes.d.ts
// (project memory `project_prompt_sharpening_card`: new shapes that bypass
// the type module fail the TLShape constraint).

import { useMemo, useState } from "react";
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
import { Loader2, AlertCircle } from "lucide-react";
import {
  Sandpack,
  type SandpackFiles,
} from "@codesandbox/sandpack-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  buildSandpackFiles,
  T2_DEPENDENCIES,
} from "@/lib/objective-canvas/tech-spec/sandpack-template";

type Status = "generating" | "ready" | "error";

export type PrototypeReactShape = TLBaseShape<
  "prototype-react",
  {
    w: number;
    h: number;
    title: string;
    /** entry path the boot files import App from — usually "/App.tsx" */
    entry: string;
    /** the LLM-emitted files (no boot files; those are owned by template). */
    files: Record<string, string>;
    status: Status;
    /** human-readable rejection reason when sanitizer fails (status=error). */
    errorReason: string | null;
    /** versionable; bumped by refine. */
    version: number;
    specJson: string | null;
  }
>;

const REACT_W = 720;
const REACT_H = 520;

export class PrototypeReactShapeUtil extends BaseBoxShapeUtil<PrototypeReactShape> {
  static override type = "prototype-react" as const;
  static override props: RecordProps<PrototypeReactShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    entry: T.string,
    files: T.dict(T.string, T.string),
    status: T.literalEnum("generating", "ready", "error"),
    errorReason: T.string.nullable(),
    version: T.number,
    specJson: T.string.nullable(),
  };

  override getDefaultProps(): PrototypeReactShape["props"] {
    return {
      w: REACT_W,
      h: REACT_H,
      title: "React prototype",
      entry: "/App.tsx",
      files: {},
      status: "generating",
      errorReason: null,
      version: 1,
      specJson: null,
    };
  }

  override canResize = () => true;
  override canEdit = () => false;

  override onResize(shape: PrototypeReactShape, info: TLResizeInfo<PrototypeReactShape>) {
    return resizeBox(shape, info);
  }

  override component(shape: PrototypeReactShape) {
    return <PrototypeReactBody shape={shape} />;
  }

  override indicator(shape: PrototypeReactShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function PrototypeReactBody({ shape }: { shape: PrototypeReactShape }) {
  const { title, entry, files, status, errorReason, version } = shape.props;

  // Compose Sandpack files from the boot template + the LLM's emission.
  const sandpackFiles: SandpackFiles = useMemo(() => buildSandpackFiles(files), [files]);

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.xl,
        boxShadow: appleVibe.shadow.card,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header — drag handle */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: appleVibe.text.secondary,
          fontSize: 12.5,
          fontWeight: 600,
          background: appleVibe.surface.chip,
        }}
      >
        <span style={{ color: appleVibe.text.primary }}>{title}</span>
        <span
          style={{
            padding: "2px 6px",
            background: "rgba(15,23,42,0.06)",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            color: appleVibe.text.tertiary,
          }}
        >
          T2 · React
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: appleVibe.text.tertiary }}>
          v{version} · {entry}
        </span>
      </div>

      {/* Body */}
      <div
        style={{ position: "relative", flex: 1, minHeight: 0, background: "#fff" }}
        onPointerDown={stopEventPropagation}
        onWheelCapture={(e) => e.stopPropagation()}
      >
        {status === "generating" ? (
          <Center>
            <Loader2 className="animate-spin" style={{ width: 22, height: 22 }} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Generating React…</span>
          </Center>
        ) : status === "error" ? (
          <Center color={appleVibe.text.tertiary}>
            <AlertCircle style={{ width: 22, height: 22 }} strokeWidth={2} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Generation failed</span>
            {errorReason ? (
              <span style={{ fontSize: 11, opacity: 0.8, textAlign: "center", maxWidth: 320 }}>
                {errorReason}
              </span>
            ) : null}
          </Center>
        ) : (
          <Sandpack
            template="react-ts"
            files={sandpackFiles}
            customSetup={{ dependencies: T2_DEPENDENCIES, entry }}
            options={{
              showNavigator: false,
              showTabs: false,
              showLineNumbers: false,
              showInlineErrors: true,
              editorHeight: "100%",
              editorWidthPercentage: 0,
            }}
            theme="light"
          />
        )}
      </div>
    </HTMLContainer>
  );
}

function Center({
  children,
  color = appleVibe.text.tertiary,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        color,
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

// Static-only state state ignored to keep this file lint-clean.
void useState;

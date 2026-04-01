"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function RawView({ content }: { content: string }) {
  if (!content) {
    return (
      <p className="text-sm text-gray-500">No raw decomposition available.</p>
    );
  }

  return (
    <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-li:text-gray-700">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}

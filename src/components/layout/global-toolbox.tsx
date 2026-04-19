"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ToolboxSphere } from "@/components/space/toolbox-sphere";
import { CommentModal } from "@/components/space/comment-modal";

export function GlobalToolbox() {
  const [commentOpen, setCommentOpen] = useState(false);
  const pathname = usePathname();

  // Derive a spaceId when on a space page; otherwise use "global" bucket for comments
  const spaceIdMatch = pathname?.match(/^\/app\/space\/([^/]+)/);
  const spaceId = spaceIdMatch?.[1] ?? "global";

  return (
    <>
      <ToolboxSphere onOpenComment={() => setCommentOpen(true)} />
      {commentOpen && (
        <CommentModal spaceId={spaceId} onClose={() => setCommentOpen(false)} />
      )}
    </>
  );
}

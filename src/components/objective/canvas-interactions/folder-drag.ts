// ── Folder drag payload (Library rail → board) ────────────────────────
//
// A "folder" is a `subsystem` cluster of library_objects. To drag one back
// onto the whiteboard we carry exactly what deployFolderToBoard needs, so the
// drop is self-contained (no refetch on drop). Shared by the rail (drag source
// + "Send to board" button) and the board-level drop handler.

import type { OcCardKind } from "../shapes/oc-card-shape";

export const FOLDER_DND_MIME = "application/x-akiboe-folder";

/** sessionStorage key for seeding a freshly-spun-off child board with a folder's
 *  copied cards. Written before navigating to the child; read once on the child
 *  board's load (deploy-then-clear). Same-tab nav keeps sessionStorage intact. */
export const folderSeedKey = (spaceId: string) => `akiboe:seedFolder:${spaceId}`;

export interface FolderDragCard {
  objectId: string;
  kind: OcCardKind;
  name: string;
  body: string;
  subsystem?: string;
}

export interface FolderDragPayload {
  v: 1;
  spaceId: string;
  folderName: string;
  cards: FolderDragCard[];
}

/** oc-card only renders "feature" | "variable"; map every other object type
 *  onto a neutral "feature" face so a mixed folder still materializes. The
 *  card's name/body carry the real content; the kind only tints the accent. */
export function toOcKind(objectType: string): OcCardKind {
  return objectType === "variable" ? "variable" : "feature";
}

export function encodeFolderDrag(dt: DataTransfer, payload: FolderDragPayload): void {
  try {
    dt.setData(FOLDER_DND_MIME, JSON.stringify(payload));
  } catch {
    /* setData can throw in some browsers mid-drag — best effort */
  }
  try {
    // Plain-text fallback so the drag is at least recognized cross-context.
    dt.setData("text/plain", `folder: ${payload.folderName}`);
  } catch {
    /* best effort */
  }
  dt.effectAllowed = "copy";
}

export function decodeFolderDrag(dt: DataTransfer): FolderDragPayload | null {
  let raw = "";
  try {
    raw = dt.getData(FOLDER_DND_MIME);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as FolderDragPayload;
    if (p && p.v === 1 && Array.isArray(p.cards) && p.cards.length > 0) return p;
  } catch {
    /* malformed payload */
  }
  return null;
}

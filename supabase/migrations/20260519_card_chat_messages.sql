-- ── Arc 5C.1 — Card chat persistence ─────────────────────────────────
--
-- Arc 5C shipped a two-stage chatbox in the canvas sidecar, but messages
-- lived in a module-scoped Map keyed by shape id. Browser refresh → gone.
-- This migration makes the chat survive reloads, multi-tab use, and
-- (future) multi-device collab.
--
-- One row per message. Grouped by `card_shape_id` (the tldraw shape the
-- conversation is anchored to — same opaque-text pattern as shape_threads).
--
-- Message kinds:
--   • "text"            → plain chat message (role=user or assistant)
--   • "proposed_change" → assistant message containing a structured
--                          strategy edit the user can Apply/Skip (Arc 5C.6)
--
-- The `content` JSONB column carries the shape-specific payload:
--   For text:            { "text": "...", "enriching": false }
--   For proposed_change: {
--     "preamble": "...",
--     "proposal": { change_type, target, current, proposed, reasoning,
--                   impact, urgency, target_id? },
--     "decision": "pending" | "applied" | "skipped",
--     "decision_note"?: "..."
--   }
--
-- Why JSONB not normalised columns:
--   The shape-specific fields (proposal object, enrichment flags,
--   decision state) vary per kind. Normalising would require 5+ columns
--   that are null for text messages. JSONB keeps the schema tight and
--   matches how ChatMessage is modelled in use-card-chat.ts.

CREATE TABLE public.card_chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- tldraw shape id — opaque string (same as shape_threads.shape_id)
  card_shape_id   text NOT NULL,

  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  kind            text NOT NULL CHECK (kind IN ('text', 'proposed_change')),
  content         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast "load history for this card" — the hot path on sidecar mount.
CREATE INDEX idx_card_chat_messages_card_space
  ON public.card_chat_messages (space_id, card_shape_id, created_at);

-- Per-user "all my chats" (future inbox / digest).
CREATE INDEX idx_card_chat_messages_user
  ON public.card_chat_messages (user_id, created_at DESC);

-- Touch updated_at on PATCH (matches shape_threads pattern).
CREATE OR REPLACE FUNCTION public.card_chat_messages_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER card_chat_messages_updated_at
  BEFORE UPDATE ON public.card_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.card_chat_messages_touch_updated_at();

-- ── RLS ──
ALTER TABLE public.card_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_chat_messages_select_own_space" ON public.card_chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.spaces s
      WHERE s.id = card_chat_messages.space_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "card_chat_messages_insert_own_space" ON public.card_chat_messages
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.spaces s
      WHERE s.id = card_chat_messages.space_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "card_chat_messages_update_own" ON public.card_chat_messages
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "card_chat_messages_delete_own" ON public.card_chat_messages
  FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE public.card_chat_messages IS
  'Persistent chat history for CardSidecar two-stage chat (Arc 5C.1).';
COMMENT ON COLUMN public.card_chat_messages.card_shape_id IS
  'tldraw shape id — opaque text (matches shape_threads.shape_id).';
COMMENT ON COLUMN public.card_chat_messages.content IS
  'JSONB payload — shape depends on kind. See migration header.';

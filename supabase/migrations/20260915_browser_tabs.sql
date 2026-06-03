-- ── Browser tabs (home intake integrations) ──
--
-- Open browser tabs synced from the InterAxis Chrome tab-sync extension.
-- The extension POSTs the user's selected-window tabs to /api/tabs/sync
-- (authenticated by the user's browser_tabs pairing_token in
-- user_integrations), which upserts them here. The objective chatbox
-- reads them to offer "attach this tab as context" + the synced strip.
--
-- A sync is a snapshot of the chosen windows: /api/tabs/sync upserts the
-- payload and deletes the user's rows not in the new set.

CREATE TABLE IF NOT EXISTS browser_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  favicon_url text,
  -- Chrome tab-group id (stringified) when the tab belongs to a group.
  tab_group text,
  synced_at timestamptz NOT NULL DEFAULT now(),

  -- Upsert key: one row per (user, url). /api/tabs/sync uses
  -- onConflict: "user_id,url".
  UNIQUE (user_id, url)
);

-- Per-user listing, most-recent first (the home loader + tabs popover).
CREATE INDEX IF NOT EXISTS idx_browser_tabs_user_recent
  ON browser_tabs (user_id, synced_at DESC);

-- ── RLS — owner only. The extension writes via the service-role client. ──
ALTER TABLE browser_tabs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "browser_tabs_owner_all" ON browser_tabs;
CREATE POLICY "browser_tabs_owner_all"
  ON browser_tabs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE browser_tabs IS
  'Open browser tabs synced from the Chrome tab-sync extension via /api/tabs/sync. One row per (user_id, url). Each sync snapshots the chosen windows. Owner-only RLS; service-role writes.';

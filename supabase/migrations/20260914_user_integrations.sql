-- ── User integrations (home intake integrations) ──
--
-- Per-user connection state + secrets for the integrations wired into the
-- objective chatbox:
--   • provider='google_drive' — OAuth2 tokens for the Drive picker.
--       access_token / refresh_token / token_expires_at / scopes are
--       written by /api/integrations/google/callback and refreshed by
--       getDriveAccessToken (src/lib/integrations/google-drive.ts).
--   • provider='browser_tabs' — a pairing_token the user pastes into the
--       Chrome tab-sync extension; /api/tabs/sync resolves it → user_id
--       via the service-role client (RLS-bypassing).
--
-- One row per (user, provider). Owner-only RLS; the service-role client
-- bypasses RLS for the extension's token→user resolution.

CREATE TABLE IF NOT EXISTS user_integrations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google_drive', 'browser_tabs')),

  -- Connection lifecycle: 'pending' (token issued, not yet confirmed) →
  -- 'connected' (OAuth completed / first sync landed).
  status text CHECK (status IN ('pending', 'connected')),

  -- ── google_drive OAuth tokens ──
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[],

  -- ── browser_tabs pairing ──
  -- Opaque per-user token pasted into the extension; sent as a Bearer
  -- header on /api/tabs/sync.
  pairing_token text,

  connected_at timestamptz,
  updated_at timestamptz,
  last_synced_at timestamptz,

  PRIMARY KEY (user_id, provider)
);

-- Extension token resolution: /api/tabs/sync looks up by
-- (provider, pairing_token) with the service-role client.
CREATE INDEX IF NOT EXISTS idx_user_integrations_pairing
  ON user_integrations (provider, pairing_token)
  WHERE pairing_token IS NOT NULL;

-- ── RLS — owner only. Service-role bypasses for the extension sync path. ──
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_integrations_owner_all" ON user_integrations;
CREATE POLICY "user_integrations_owner_all"
  ON user_integrations
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE user_integrations IS
  'Per-user connection state + secrets for intake integrations (google_drive OAuth tokens, browser_tabs pairing token). One row per (user_id, provider). Owner-only RLS; service-role bypasses for extension token resolution.';

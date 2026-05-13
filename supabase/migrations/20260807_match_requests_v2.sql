-- ── match_requests v2 (Phase 4c hardening) ──
--
-- Closes the gaps between the v1 ship and the canonical design spec:
--   1. match_id  → FK to component_matches so the inbox can re-pull
--      LLM rationale + scores without re-running the matcher
--   2. additional_component_ids → uuid[] of optional extra components
--      the sender wants to share on accept (capped at 3 client-side)
--   3. seen_at   → bookkeeping for the unread bell badge (receiver sets
--      when they first open the inbox)
--   4. canonical-pair index → fast lookup for "any existing request
--      between these two users in any direction" so bidirectional
--      simultaneous requests can be detected before insert
--
-- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS where
-- supported (Postgres 9.6+) and DROP/CREATE INDEX IF NOT EXISTS so
-- the migration runs idempotently against both fresh + live DBs.

alter table public.match_requests
  add column if not exists match_id uuid references public.component_matches(id) on delete set null;

alter table public.match_requests
  add column if not exists additional_component_ids uuid[] not null default '{}';

alter table public.match_requests
  add column if not exists seen_at timestamptz;

-- Length guard on the array: hard-cap at 5 to backstop the
-- client's 3-item soft limit. Prevents abuse via direct API call.
alter table public.match_requests
  drop constraint if exists match_requests_additional_len_check;
alter table public.match_requests
  add constraint match_requests_additional_len_check
  check (array_length(additional_component_ids, 1) is null
         or array_length(additional_component_ids, 1) <= 5);

-- ── Canonical-pair index ──
-- Lets the POST /requests handler ask: "does ANY request exist
-- between user A and user B in any direction?" in O(log N). Used by
-- the bidirectional-simultaneous resolve flow that redirects the
-- second sender to the existing inbound request.

create index if not exists match_requests_canonical_pair_idx
  on public.match_requests(
    least(from_user, to_user),
    greatest(from_user, to_user),
    status
  );

-- Index for the bell-badge query: count(*) where to_user=me AND
-- status='pending' AND seen_at IS NULL. Existing match_requests_to_idx
-- already covers (to_user, status, created_at desc); adding a partial
-- here to keep the badge query a pure index scan.
create index if not exists match_requests_unseen_incoming_idx
  on public.match_requests(to_user)
  where status = 'pending' and seen_at is null;

comment on column public.match_requests.match_id is
  'Provenance: the component_matches row this request came from. '
  'Lets the inbox re-render the LLM rationale + scores without '
  're-running the matcher. ON DELETE SET NULL so request history '
  'survives match cache invalidation.';
comment on column public.match_requests.additional_component_ids is
  'Optional bundle of additional component ids the sender wants to '
  'share on accept. Capped at 5 by the CHECK constraint, 3 by the '
  'client-side UI. Validated by the API to ensure the sender owns '
  'each referenced component.';
comment on column public.match_requests.seen_at is
  'When the receiver first viewed this row in their inbox. Powers '
  'the bell-badge unread count. Set on first GET /requests for the '
  'incoming-pending row(s).';

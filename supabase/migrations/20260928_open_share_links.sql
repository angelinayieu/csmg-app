-- ── Collaborative boards: open-link invites + shared-member RLS ─────
--
-- Two fixes that ship together because sharing was broken end-to-end:
--
-- 1) Open links — the share modal's "Copy board link" used to copy the
--    raw `/app/objective/[spaceId]` URL, which grants no access. We now
--    create a real tokened invite at /invite/[token] with NO email
--    constraint (anyone signed in who has the link can accept). The
--    invitee_email column is therefore made nullable.
--
-- 2) Shared-member RLS — the original 20260920_space_sharing migration
--    added space_members + has_space_access(), but never extended the
--    owner-only RLS on the actual content tables (spaces, objective_boards,
--    improvement_goals, canvases). So even properly invited members were
--    blocked from reading the space row, the board snapshot, or the root
--    goal — every shared board rendered empty. We add SELECT policies
--    via has_space_access() (defense-in-depth that matches the comment
--    in the original sharing migration) plus an INSERT/UPDATE policy on
--    objective_boards for editor-role members so they can co-edit.

-- ── 1) Open invites: invitee_email nullable ─────────────────────────
alter table public.space_invites
  alter column invitee_email drop not null;

-- ── 2) RLS: shared members can read the space row ───────────────────
drop policy if exists "Members read shared spaces" on public.spaces;
create policy "Members read shared spaces"
  on public.spaces for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.space_members m
      where m.space_id = spaces.id and m.user_id = auth.uid()
    )
  );

-- ── 3) RLS: shared members can read the objective board snapshot ────
drop policy if exists "Members read objective_boards" on public.objective_boards;
create policy "Members read objective_boards"
  on public.objective_boards for select to authenticated
  using (public.has_space_access(space_id, auth.uid()));

-- ── 4) RLS: editor members can write the objective board snapshot ───
-- INSERT / UPDATE only — viewers stay read-only. Owner writes are
-- covered by the existing objective_boards_owner ALL policy.
drop policy if exists "Editors write objective_boards" on public.objective_boards;
create policy "Editors write objective_boards"
  on public.objective_boards for insert to authenticated
  with check (
    exists (
      select 1 from public.space_members m
      where m.space_id = objective_boards.space_id
        and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  );

drop policy if exists "Editors update objective_boards" on public.objective_boards;
create policy "Editors update objective_boards"
  on public.objective_boards for update to authenticated
  using (
    exists (
      select 1 from public.space_members m
      where m.space_id = objective_boards.space_id
        and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.space_members m
      where m.space_id = objective_boards.space_id
        and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  );

-- ── 5) RLS: shared members can read improvement_goals ───────────────
-- ?full=1 canvas mode reads the space's root goal + sub-objectives.
-- Minimal mode doesn't, but adding this keeps the full canvas viewable
-- by shared members too.
drop policy if exists "Members read improvement_goals" on public.improvement_goals;
create policy "Members read improvement_goals"
  on public.improvement_goals for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.space_members m
      where m.space_id = improvement_goals.space_id and m.user_id = auth.uid()
    )
  );

-- ── 6) RLS: shared members can read legacy canvases rows ────────────
-- The board GET route falls back to canvases (scope='objective') for
-- boards saved before the objective_boards table existed. canvases is
-- anchored to a root improvement_goal, not directly to a space — so we
-- pivot through improvement_goals to find the space.
drop policy if exists "Members read shared canvases" on public.canvases;
create policy "Members read shared canvases"
  on public.canvases for select to authenticated
  using (
    auth.uid() = owner_id
    or exists (
      select 1
      from public.improvement_goals g
      join public.space_members m on m.space_id = g.space_id
      where g.id = canvases.scope_ref_id
        and canvases.scope_ref_type = 'improvement_goal'
        and canvases.scope = 'objective'
        and m.user_id = auth.uid()
    )
  );

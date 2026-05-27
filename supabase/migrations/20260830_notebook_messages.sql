-- Phase 10c — Lab Notebook chat thread storage.
--
-- Per lock-in L8 in OBJECTIVE_CANVAS_OPERATION_MAP.md: chat history
-- is persisted per sub-objective room (with sub_objective_id set)
-- AND per space (sub_objective_id null) for the canvas-scoped
-- thread. Survives reloads; lets the chat agent reference "what we
-- discussed earlier" across sessions.
--
-- Three roles:
--   - user      — turns the human typed
--   - assistant — the agent's text reply (and optional tool_call)
--   - tool      — the executed-tool result row that the agent reads
--                 back on its next turn (for tools we execute
--                 server-side; suggested_action stays in the
--                 assistant row's tool_call instead)
--
-- tool_call is jsonb { tool_name, args, label?, status: "suggested"|"executed" }.
-- tool_result is jsonb { ok, data?, error? }.

create table public.notebook_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  -- Null = canvas-level (all-rooms) thread for the space.
  -- Non-null = per-room thread.
  sub_objective_id uuid references public.improvement_goals(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  -- Markdown-ish text content. Required for user + assistant; null
  -- for tool result rows (which carry their data in tool_result).
  content text,
  -- Assistant turns optionally include a tool_call. Server-executed
  -- tools have a paired tool result row (role='tool', parent_message_id
  -- pointing here). Client-executed (heavy) tools come back as
  -- suggested_action — UI renders a button, no follow-up tool row.
  tool_call jsonb,
  tool_result jsonb,
  parent_message_id uuid references public.notebook_messages(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Thread fetch pattern: a panel loads by (space_id, sub_objective_id)
-- and reads oldest-first to render the message list naturally. Index
-- supports both per-room (sub_objective_id NOT NULL) and per-space
-- (sub_objective_id IS NULL) lookups via the leading equality on
-- space_id plus the ordering tail.
create index notebook_messages_thread_idx
  on public.notebook_messages(space_id, sub_objective_id, created_at);

-- Per-user latest activity (used by future "what threads are open" UIs).
create index notebook_messages_user_recency_idx
  on public.notebook_messages(user_id, created_at desc);

-- RLS: users can only read/write their own messages.
alter table public.notebook_messages enable row level security;

create policy notebook_messages_own_select
  on public.notebook_messages for select
  using (auth.uid() = user_id);

create policy notebook_messages_own_insert
  on public.notebook_messages for insert
  with check (auth.uid() = user_id);

create policy notebook_messages_own_delete
  on public.notebook_messages for delete
  using (auth.uid() = user_id);

-- Persona onboarding: initial schema (DESIGN.md section 5, plus a few additive columns
-- noted inline). Applied to the Supabase project via MCP; kept here for review and CLI use.

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  owner_uid uuid,
  mode text not null default 'onboarding',      -- onboarding | main
  user_name text,
  need text,
  gmail_status text not null default 'none',    -- none | pending | connected | declined | failed
  gmail_email text,
  agent_name text,
  channel_pref text,                            -- null | text | call
  phase text not null default 'warmup',         -- warmup | collecting | value | graduated
  call_state text not null default 'idle',      -- idle | ringing | live | ended_by_user | dropped | ended_by_bot
  attempts jsonb not null default '{}',         -- {"user_name": 1}
  last_questions jsonb not null default '[]',   -- last 5 questions asked, verbatim
  summary text,                                 -- rolling 5-line summary
  prompt_version text,
  version int not null default 0,               -- optimistic concurrency
  -- additions beyond the design doc (all additive):
  confirmed jsonb not null default '{}',        -- confirm_slot marks: {"user_name": true}
  mock_inbox boolean not null default false,    -- per-session "use demo inbox" toggle
  responding_since timestamptz,                 -- reply lock for /api/chat
  last_heartbeat_at timestamptz,                -- call heartbeat; lazy drop detection
  value_moment_at timestamptz,
  graduated_at timestamptz,
  last_user_activity_at timestamptz,
  oauth_state text,                             -- CSRF nonce for the Google flow
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  client_id uuid,                               -- browser-chosen id for optimistic render + idempotent insert
  channel text not null default 'text',         -- text | call
  role text not null,                           -- user | assistant | system
  kind text not null default 'text',            -- text | tapback | contact_card | link_card | voicemail | call_log | screenshot | audio | summary_card
  content text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists messages_session_idx on messages(session_id, id);
create unique index if not exists messages_client_id_uidx on messages(session_id, client_id) where client_id is not null;

create table if not exists events (
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_session_idx on events(session_id, id);
create index if not exists events_type_idx on events(session_id, type);

create table if not exists oauth_tokens (
  session_id uuid primary key references sessions(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  email text,
  updated_at timestamptz not null default now()
);

create table if not exists memory_events (      -- append only
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  ts timestamptz not null default now(),
  actor text not null,                          -- user | system | gmail | agent
  op text not null,                             -- assert | retract | resolve
  subject text not null,
  predicate text not null,
  object text not null,
  source text not null,                         -- user_call | user_text | oauth | gmail_body | agent_inference
  evidence_ref text
);
create index if not exists memory_events_session_idx on memory_events(session_id, id);

create table if not exists beliefs (            -- projection = replay(memory_events)
  session_id uuid not null references sessions(id) on delete cascade,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence real not null default 0,
  status text not null,                         -- active | superseded | contradicted | pending | quarantined | retracted
  reason text,
  evidence_ids bigint[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (session_id, subject, predicate, object)
);

-- Row level security: the browser signs in anonymously and may only read its own rows.
-- The server uses the service role and bypasses all of this. oauth_tokens has no policy at all.
alter table sessions enable row level security;
alter table messages enable row level security;
alter table events enable row level security;
alter table beliefs enable row level security;
alter table memory_events enable row level security;
alter table oauth_tokens enable row level security;

create policy "own session" on sessions for select to authenticated using (owner_uid = auth.uid());
create policy "own messages" on messages for select to authenticated
  using (exists (select 1 from sessions s where s.id = messages.session_id and s.owner_uid = auth.uid()));
create policy "own events" on events for select to authenticated
  using (exists (select 1 from sessions s where s.id = events.session_id and s.owner_uid = auth.uid()));
create policy "own beliefs" on beliefs for select to authenticated
  using (exists (select 1 from sessions s where s.id = beliefs.session_id and s.owner_uid = auth.uid()));

-- Realtime: the browser subscribes to messages, sessions and beliefs.
alter publication supabase_realtime add table messages, sessions, beliefs;
alter table messages replica identity full;
alter table sessions replica identity full;
alter table beliefs replica identity full;

-- Voicemail audio (optional; the app degrades to transcript-only if the bucket is missing).
insert into storage.buckets (id, name, public) values ('voicemail', 'voicemail', true)
  on conflict (id) do nothing;

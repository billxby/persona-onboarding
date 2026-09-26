-- Intentions: what is on the agent's own mind (DESIGN.md §13b). Additive only.
-- A second append-only ledger (intention_events) folded into one row per (session, key)
-- (intentions), the same shape as memory_events → beliefs.

alter table sessions add column if not exists turn int not null default 0;   -- assistant turns so far

create table if not exists intention_events (     -- append only
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  ts timestamptz not null default now(),
  key text not null,                              -- get_name | learn_need | connect_gmail | name_agent | followup_<slug> ...
  op text not null,                               -- open | nudge | outcome | defer | done | drop | reopen
  actor text not null,                            -- agent | system | user
  turn int,                                       -- sessions.turn at the time of the event
  payload jsonb not null default '{}',            -- open {goal, slot, sticky, priority, channels} · nudge {approach, channel}
                                                  -- outcome {receptivity 0-10, signal, note} · defer {turns, ms, reason} · done/drop {reason}
  evidence_ref text
);
create index if not exists intention_events_session_idx on intention_events(session_id, id);

create table if not exists intentions (           -- projection = replay(intention_events)
  session_id uuid not null references sessions(id) on delete cascade,
  key text not null,
  goal text not null,
  slot text,                                      -- user_name | need | gmail | agent_name | null
  sticky boolean not null default false,          -- never auto-dropped
  priority int not null default 5,
  channels text[] not null default '{text,call}',
  status text not null,                           -- open | asked | done | dropped
  nudges int not null default 0,
  last_nudge_turn int,
  last_nudge_at timestamptz,
  last_approach text,
  approaches text[] not null default '{}',
  receptivity real,                               -- latest 0-10
  receptivity_history real[] not null default '{}',
  receptivity_mean real,
  last_outcome_turn int,
  notes text[] not null default '{}',
  next_eligible_turn int not null default 0,
  next_eligible_at timestamptz not null default 'epoch',
  reason text,
  evidence_ids bigint[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (session_id, key)
);

alter table intention_events enable row level security;   -- server only, no policy
alter table intentions enable row level security;
create policy "own intentions" on intentions for select to authenticated
  using (exists (select 1 from sessions s where s.id = intentions.session_id and s.owner_uid = auth.uid()));

alter publication supabase_realtime add table intentions;
alter table intentions replica identity full;

-- HomePilot Pro – Grundschema
--
-- Im Supabase-Dashboard unter SQL Editor ausführen (oder via Supabase CLI:
-- `supabase db push`). Alle Tabellen liegen in `public`, RLS ist aktiviert
-- und es gibt bewusst KEINE Policies für anon/authenticated: nur der Hub
-- greift zu, und zwar mit dem service_role-Key, der RLS umgeht.

-- ── Räume ────────────────────────────────────────────────────────────────

create table if not exists public.rooms (
  id          text primary key,
  name        text not null,
  sort_order  int  not null default 0
);

-- ── Entitäten (aktueller Zustand) ────────────────────────────────────────

create table if not exists public.entities (
  id           text primary key,          -- "<integration>.<object_id>"
  kind         text        not null,
  name         text        not null,
  integration  text        not null,
  state        jsonb       not null default '{}'::jsonb,
  commands     text[]      not null default '{}',
  available    boolean     not null default true,
  room_id      text        references public.rooms(id) on delete set null,
  updated_at   timestamptz not null default now()
);

create index if not exists entities_integration_idx on public.entities (integration);
create index if not exists entities_room_idx        on public.entities (room_id);

-- ── Zustandsverlauf (Zeitreihe für Charts/Auswertungen) ──────────────────

create table if not exists public.state_history (
  id          bigint generated always as identity primary key,
  entity_id   text        not null,
  state       jsonb       not null,
  recorded_at timestamptz not null default now()
);

-- Absichtlich ohne Fremdschlüssel auf entities: der Verlauf soll erhalten
-- bleiben, auch wenn eine Entität verschwindet (Gerät entfernt, Integration
-- deaktiviert).
create index if not exists state_history_entity_time_idx
  on public.state_history (entity_id, recorded_at desc);

-- ── Automationsläufe (Protokoll) ─────────────────────────────────────────

create table if not exists public.automation_runs (
  id            bigint generated always as identity primary key,
  automation_id text        not null,
  alias         text,
  triggered_at  timestamptz not null default now(),
  success       boolean     not null default true,
  error         text
);

create index if not exists automation_runs_time_idx
  on public.automation_runs (triggered_at desc);

-- ── Aufräumen alter Verlaufsdaten ────────────────────────────────────────

create or replace function public.prune_history(retention_days int default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  delete from public.state_history
   where recorded_at < now() - make_interval(days => retention_days);
  get diagnostics removed = row_count;

  delete from public.automation_runs
   where triggered_at < now() - make_interval(days => retention_days);

  return removed;
end;
$$;

-- Optional täglich laufen lassen (Extension pg_cron im Dashboard aktivieren):
--   select cron.schedule('prune-history', '0 3 * * *',
--                        $$select public.prune_history(90)$$);

-- ── Row Level Security ───────────────────────────────────────────────────

alter table public.rooms           enable row level security;
alter table public.entities        enable row level security;
alter table public.state_history   enable row level security;
alter table public.automation_runs enable row level security;

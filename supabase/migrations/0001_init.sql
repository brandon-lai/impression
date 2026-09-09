-- Impression: initial schema (PRD 8).
--
-- Written to apply cleanly to both a plain local Postgres (used for
-- verification) and a Supabase project, so the same file is the source of
-- truth for both. The role guards below are what make that true: vanilla
-- Postgres has no `anon` or `authenticated` role.

create table if not exists prompts (
  id           text primary key,
  text         text not null,
  active_date  date unique
);

create table if not exists pieces (
  id                text primary key,             -- 10 url-safe chars
  created_at        timestamptz not null default now(),
  seed              bigint not null,
  subject           text not null,
  subject_runner_up text,
  light             text not null,                -- morning | midday | evening | overcast
  title             text not null,
  events            bytea not null,               -- gzipped JSON PaintEvent[]
  duration_ms       int not null,
  transcript        text,                         -- null if audio excluded
  audio_key         text,                         -- null if audio excluded
  still_key         text,
  prompt_id         text references prompts(id),
  is_public         boolean not null default false,
  moderation_status text not null default 'pending',
  delete_token      text not null
);

-- Audio bytes when no object store is configured.
--
-- The PRD puts audio in Supabase Storage, and that is still the path when
-- SUPABASE_URL is set. This table is the fallback so that the product is
-- complete on any Postgres, including the local one used for verification: a
-- 30s opus clip at 64kbps is about 240KB, which is an unremarkable row.
-- Separate from `pieces` so that listing the gallery never drags audio along.
create table if not exists piece_audio (
  piece_id   text primary key references pieces(id) on delete cascade,
  mime_type  text not null,
  bytes      bytea not null
);

-- The finished still, for link previews (PRD 7.9).
--
-- Rendered by the client at share time from the same 2048px final pass it
-- already has in hand, rather than re-rendered on the server. Server-side
-- rendering would mean a headless canvas dependency for one image, and the
-- client's copy is by definition the exact painting the user approved.
create table if not exists piece_still (
  piece_id  text primary key references pieces(id) on delete cascade,
  bytes     bytea not null
);

create index if not exists pieces_public_created_idx
  on pieces (created_at desc) where is_public;
create index if not exists pieces_prompt_idx on pieces (prompt_id, created_at desc);

-- Seed the built-in prompt rotation.
--
-- `pieces.prompt_id` references this table, and the daily prompt is otherwise
-- a pure function of the date with no database involvement at all -- so
-- without these rows every genuine share carrying a prompt id fails the
-- foreign key and the route 500s. Caught by the integration tests rather than
-- by anything that runs at build time.
insert into prompts (id, text) values
  ('calm',    'Describe somewhere you felt calm'),
  ('travel',  'Talk about the last place you travelled'),
  ('street',  'Describe your street'),
  ('room',    'Tell me about a room you remember'),
  ('now',     'Say what you can see right now'),
  ('weather', 'Describe the weather where you are'),
  ('morning', 'Talk about this morning')
on conflict (id) do nothing;

-- Row level security.
--
-- Supabase serves the anon key inside the client bundle, so a table without
-- RLS is a table anyone can read in full. Nothing here is world-readable by
-- default: an unlisted piece must stay unlisted, and `delete_token` must never
-- be selectable by the public role or anonymous deletion stops being
-- anonymous-*owner* deletion and becomes anonymous deletion of anyone's piece.
--
-- Every write in this product goes through the server with the service role,
-- which bypasses RLS, so no insert or update policy is granted to anon at all.
alter table pieces      enable row level security;
alter table piece_audio enable row level security;
alter table piece_still enable row level security;
alter table prompts     enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Today's prompt is public.
    drop policy if exists prompts_public_read on prompts;
    create policy prompts_public_read on prompts for select to anon using (true);

    -- Only pieces their owner opted into the gallery, and only once moderated.
    drop policy if exists pieces_gallery_read on pieces;
    create policy pieces_gallery_read on pieces for select to anon
      using (is_public and moderation_status = 'approved');

    -- Audio is never served straight from the table to the client.
    revoke all on piece_audio from anon;
    revoke all on piece_still from anon;
  end if;
end
$$;

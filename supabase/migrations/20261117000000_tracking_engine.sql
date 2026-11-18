-- Spotlight tracking engine: plans, customer questions, weekly AI checks,
-- results, fix lists and free-check leads.
--
-- Who writes what:
--   * Signed-in users manage their own businesses and questions, tick off fixes,
--     and switch weekly emails on or off.
--   * Everything else (check runs, results, fixes, plans, leads) is written only by
--     the Edge Functions, which use the service role and bypass row level security.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column plan text not null default 'free'
    check (plan in ('free', 'starter', 'growth', 'multi')),
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text,
  add column email_reports boolean not null default true;

-- Users must not be able to give themselves a paid plan. Only the columns they
-- may legitimately change stay updatable from the browser.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, avatar_url, email_reports) on public.profiles to authenticated;

-- Limits per plan. Kept in one place so the database can enforce them.
-- (The same numbers live in supabase/functions/_shared/plans.ts for the UI and functions.)
create function public.plan_max_businesses(p text)
returns int language sql immutable set search_path = '' as $$
  select case p when 'multi' then 1000 else 1 end
$$;

create function public.plan_max_questions(p text)
returns int language sql immutable set search_path = '' as $$
  select case p when 'growth' then 30 when 'multi' then 100 else 10 end
$$;

-- ---------------------------------------------------------------------------
-- Businesses: more detail, and when the next check is due
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column category text check (char_length(category) <= 100),
  add column website text check (char_length(website) <= 500),
  add column google_profile_url text check (char_length(google_profile_url) <= 500),
  add column last_checked_at timestamptz,
  -- Picked up by the scheduler once this time passes. null = no automatic checks.
  add column next_check_at timestamptz default now();

create index businesses_next_check_at_idx on public.businesses(next_check_at)
  where next_check_at is not null;

-- The scheduler owns these two columns.
revoke update on public.businesses from authenticated, anon;
grant update (name, city, category, website, google_profile_url) on public.businesses to authenticated;

create function public.enforce_business_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_plan text;
  existing int;
begin
  select plan into owner_plan from public.profiles where id = new.owner_id;
  select count(*) into existing from public.businesses where owner_id = new.owner_id;
  if existing >= public.plan_max_businesses(coalesce(owner_plan, 'free')) then
    raise exception 'Your plan includes % location(s). Upgrade to add more.',
      public.plan_max_businesses(coalesce(owner_plan, 'free'))
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_business_limit() from public, anon, authenticated;

create trigger businesses_enforce_limit
  before insert on public.businesses
  for each row execute function public.enforce_business_limit();

-- ---------------------------------------------------------------------------
-- Customer questions asked to the AI assistants
-- ---------------------------------------------------------------------------

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 3 and 300),
  active boolean not null default true,
  source text not null default 'custom' check (source in ('generated', 'custom')),
  created_at timestamptz not null default now()
);
create index questions_business_id_idx on public.questions(business_id);
create index questions_owner_id_idx on public.questions(owner_id);

alter table public.questions enable row level security;

create policy "Users can view their own questions" on public.questions
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can add questions to their own businesses" on public.questions
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = (select auth.uid()))
  );
create policy "Users can update their own questions" on public.questions
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own questions" on public.questions
  for delete to authenticated using ((select auth.uid()) = owner_id);

revoke update on public.questions from authenticated, anon;
grant update (text, active) on public.questions to authenticated;

create function public.enforce_question_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_plan text;
  existing int;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  select plan into owner_plan from public.profiles where id = new.owner_id;
  select count(*) into existing from public.questions
    where business_id = new.business_id and active and id <> new.id;
  if existing >= public.plan_max_questions(coalesce(owner_plan, 'free')) then
    raise exception 'Your plan tracks up to % questions per location. Pause one or upgrade.',
      public.plan_max_questions(coalesce(owner_plan, 'free'))
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_question_limit() from public, anon, authenticated;

create trigger questions_enforce_limit
  before insert or update of active on public.questions
  for each row execute function public.enforce_question_limit();

-- ---------------------------------------------------------------------------
-- Check runs, per-answer results and fix lists (written by Edge Functions)
-- ---------------------------------------------------------------------------

create table public.check_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  trigger text not null default 'scheduled' check (trigger in ('scheduled', 'manual')),
  assistants text[] not null default '{}',
  score int check (score between 0 and 100),
  mention_rate numeric(5,4),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report_sent_at timestamptz
);
create index check_runs_business_id_idx on public.check_runs(business_id, started_at desc);
create index check_runs_owner_id_idx on public.check_runs(owner_id);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.check_runs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  question text not null,
  assistant text not null check (assistant in ('chatgpt', 'claude', 'gemini', 'perplexity')),
  mentioned boolean not null default false,
  rank int check (rank > 0),
  competitors text[] not null default '{}',
  answer text,
  error text,
  created_at timestamptz not null default now()
);
create index results_run_id_idx on public.results(run_id);
create index results_business_id_idx on public.results(business_id);
create index results_owner_id_idx on public.results(owner_id);
create index results_question_id_idx on public.results(question_id);

create table public.fixes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid references public.check_runs(id) on delete set null,
  area text not null check (area in ('google', 'reviews', 'website', 'listings', 'content', 'other')),
  impact text not null check (impact in ('high', 'medium', 'low')),
  title text not null check (char_length(title) <= 200),
  detail text check (char_length(detail) <= 2000),
  position int not null default 0,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index fixes_business_id_idx on public.fixes(business_id);
create index fixes_owner_id_idx on public.fixes(owner_id);
create index fixes_run_id_idx on public.fixes(run_id);

alter table public.check_runs enable row level security;
alter table public.results enable row level security;
alter table public.fixes enable row level security;

create policy "Users can view their own check runs" on public.check_runs
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can view their own results" on public.results
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can view their own fixes" on public.fixes
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can tick off their own fixes" on public.fixes
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

revoke insert, update, delete on public.check_runs, public.results from authenticated, anon;
revoke insert, update, delete on public.fixes from authenticated, anon;
grant update (done) on public.fixes to authenticated;

-- ---------------------------------------------------------------------------
-- Free-check leads from the landing page form (service role only)
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business text not null check (char_length(business) between 1 and 200),
  city text not null check (char_length(city) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  score int,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index leads_unique_request on public.leads (lower(email), lower(business), lower(city));
create index leads_pending_idx on public.leads(created_at) where status = 'pending';

alter table public.leads enable row level security;
-- No policies: only the service role (Edge Functions) can read or write leads.

-- ---------------------------------------------------------------------------
-- Scheduler helpers (called by the run-checks Edge Function)
-- ---------------------------------------------------------------------------

-- Take the business whose check is most overdue, and lease it for an hour so two
-- scheduler ticks never check the same business at once.
create function public.claim_due_business()
returns setof public.businesses
language sql security definer set search_path = '' as $$
  update public.businesses b
     set next_check_at = now() + interval '1 hour'
   where b.id = (
     select id from public.businesses
      where next_check_at is not null and next_check_at <= now()
      order by next_check_at
      limit 1
      for update skip locked
   )
  returning b.*
$$;

create function public.claim_pending_lead()
returns setof public.leads
language sql security definer set search_path = '' as $$
  update public.leads l
     set status = 'processing'
   where l.id = (
     select id from public.leads
      where status = 'pending'
      order by created_at
      limit 1
      for update skip locked
   )
  returning l.*
$$;

revoke execute on function public.claim_due_business() from public, anon, authenticated;
revoke execute on function public.claim_pending_lead() from public, anon, authenticated;
grant execute on function public.claim_due_business() to service_role;
grant execute on function public.claim_pending_lead() to service_role;

-- The scheduler proves itself with a random secret kept in Vault (created by
-- supabase/setup/schedule-checks.sql). run-checks asks the database to compare.
create function public.verify_cron_secret(candidate text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(candidate) >= 32, false) and exists (
    select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = candidate
  )
$$;
revoke execute on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- The scheduler is pg_cron + pg_net calling the run-checks function.
-- The schedule itself lives in supabase/setup/schedule-checks.sql.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

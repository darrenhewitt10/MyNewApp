-- Already applied to the Supabase project "spotlight" (mmzkgsgwclgtqrpeectd).
-- Kept here as a record of the database schema.

-- One profile per signed-in user, filled from their Google / Apple / Yahoo account.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- The businesses a user wants Spotlight to track.
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  city text not null check (char_length(city) between 1 and 200),
  created_at timestamptz not null default now()
);
create index businesses_owner_id_idx on public.businesses(owner_id);

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;

create policy "Users can view their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users can view their own businesses" on public.businesses
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can add their own businesses" on public.businesses
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users can update their own businesses" on public.businesses
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete their own businesses" on public.businesses
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Create a profile automatically when someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

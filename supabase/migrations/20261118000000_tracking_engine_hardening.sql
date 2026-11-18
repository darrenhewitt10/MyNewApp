-- Applied right after tracking_engine on the live project, following the
-- Supabase security advisor. (The tracking_engine file above already includes
-- these changes for fresh databases, so this is a no-op there.)
drop function if exists public.current_plan();
drop extension if exists pg_net;
create extension pg_net with schema extensions;

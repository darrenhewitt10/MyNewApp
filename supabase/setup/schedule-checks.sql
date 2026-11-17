-- Run once in the Supabase SQL editor, after deploying the Edge Functions.
-- It makes the database call the run-checks function every 10 minutes. Each call
-- checks the most overdue business and processes one free-check lead.
--
-- Before running: replace CHANGE-ME with the same random value you saved as the
-- CRON_SECRET Edge Function secret (e.g. the output of `openssl rand -hex 32`).

select vault.create_secret('https://mmzkgsgwclgtqrpeectd.supabase.co', 'project_url');
select vault.create_secret('CHANGE-ME', 'cron_secret');

select cron.schedule(
  'spotlight-run-checks',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/run-checks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- To stop it later:  select cron.unschedule('spotlight-run-checks');

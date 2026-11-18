-- Run once in the Supabase SQL editor, after the tracking_engine migration and
-- deploying the Edge Functions. The database then calls the run-checks function
-- every 10 minutes; each call checks the most overdue business and processes
-- one free-check lead.
--
-- The scheduler's secret is generated here and stays inside Vault: run-checks
-- verifies it with public.verify_cron_secret(), so nobody needs to copy it.

select vault.create_secret('https://mmzkgsgwclgtqrpeectd.supabase.co', 'project_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret');

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

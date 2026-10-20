// Shared Supabase client. The publishable key is safe to ship in the browser:
// row level security in the database decides what each signed-in user can see.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

const SUPABASE_URL = "https://mmzkgsgwclgtqrpeectd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_N502ml39iWf8BjEUc_0c_g_AddawCSM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: "pkce" },
});

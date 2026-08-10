import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// Client admin (service_role) : bypass RLS. Serveur uniquement.
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

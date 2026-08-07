const { createClient } = require('@supabase/supabase-js');

function createSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

module.exports = { createSupabaseClient };

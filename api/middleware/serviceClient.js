// api/middleware/serviceClient.js
// Supabase client factories. Two flavors:
//   - getServiceClient(): uses SUPABASE_SERVICE_ROLE_KEY. Bypasses RLS.
//     Use for all server-side writes.
//   - getPublicClient(): uses SUPABASE_ANON_KEY. Subject to RLS.
//     Use only for endpoints that explicitly want public access (e.g. settings GET).
//
// Tests can override `setServiceClientOverride(client)` to inject a fake.

const { createClient } = require('@supabase/supabase-js');

let serviceClientOverride = null;
let publicClientOverride = null;

function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL || '';
  const anonKey = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const mode = (url && (anonKey || serviceKey)) ? 'supabase' : 'unconfigured';
  return { url, anonKey, serviceKey, mode };
}

function getServiceClient() {
  if (serviceClientOverride) return serviceClientOverride;
  const { url, serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function getPublicClient() {
  if (publicClientOverride) return publicClientOverride;
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

function setServiceClientOverride(client) { serviceClientOverride = client; }
function setPublicClientOverride(client) { publicClientOverride = client; }
function clearOverrides() { serviceClientOverride = null; publicClientOverride = null; }

module.exports = {
  getSupabaseConfig,
  getServiceClient,
  getPublicClient,
  setServiceClientOverride,
  setPublicClientOverride,
  clearOverrides,
};
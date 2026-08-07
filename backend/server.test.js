const test = require('node:test');
const assert = require('node:assert/strict');
const { app, getSupabaseConfig } = require('./server');

test('health endpoint responds ok', async () => {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('supabase config is detected when env values are provided', () => {
  const config = getSupabaseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_test_key'
  });

  assert.equal(config.mode, 'supabase');
  assert.equal(config.key, 'sb_publishable_test_key');
});

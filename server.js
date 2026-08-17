// server.js
// Local dev entrypoint. Vercel uses api/index.js directly.

const app = require('./api/index.js');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

if (app.onStartup) {
  app.onStartup().catch(err => console.warn('[startup] error:', err.message));
}

app.listen(PORT, () => {
  console.log(`Kaizema Pure Water System running on http://localhost:${PORT}`);
});
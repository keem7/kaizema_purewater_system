const app = require('./api/index.js');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Kaizema Pure Water System running on http://localhost:${PORT}`);
});

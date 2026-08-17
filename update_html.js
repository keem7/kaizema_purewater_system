const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'frontend', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Add favicon link to <head> if not present
if (!html.includes('<link rel="icon"')) {
  html = html.replace('</head>', '  <link rel="icon" type="image/jpeg" href="logo.jpg">\n</head>');
}

// 2. Replace base64 img src with logo.jpg
html = html.replace(/<img src="data:image\/jpeg;base64,[^"]+"/, '<img src="logo.jpg" alt="Kaizema Logo" class="logo"');

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Successfully updated index.html with favicon and logo.jpg! New size:', html.length);

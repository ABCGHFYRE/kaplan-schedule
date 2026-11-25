// Copies src/index.html to docs/index.html with a version stamp so browsers load the newest app.js/styles.css.
const fs = require('fs');
const v = Date.now().toString(36);
fs.writeFileSync('docs/index.html', fs.readFileSync('src/index.html', 'utf8').replaceAll('__V__', v));
console.log('stamped', v);

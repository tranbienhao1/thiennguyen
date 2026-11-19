'use strict';
const fs = require('fs');
const lines = JSON.parse(fs.readFileSync('scripts/index_es2020_lines.json', 'utf8'));

lines.filter(x => /library\?\.[a-zA-Z0-9_]+/.test(x.text)).forEach(x => {
  console.log(`L${x.line}: ${x.text.trim()}`);
});

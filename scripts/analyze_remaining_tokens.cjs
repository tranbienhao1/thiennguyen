'use strict';
const fs = require('fs');
const remaining = JSON.parse(fs.readFileSync('scripts/remaining_116.json', 'utf8'));

const groups = {};
for (const r of remaining) {
  const matches = r.text.match(/[\w$]+(?:\([^)]*\))?\?\.[\w$]+/g) || [];
  for (const m of matches) {
    groups[m] = (groups[m] || 0) + 1;
  }
}
console.log('Unique token patterns:', Object.entries(groups).sort((a,b) => b[1] - a[1]));

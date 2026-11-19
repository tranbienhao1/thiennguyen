'use strict';
const fs = require('fs');
const lines = fs.readFileSync('index.html', 'utf8').split('\n').slice(2939, 16431);
const remaining = [];
lines.forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
  const stripped = l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
  if (/\?\./.test(stripped)) {
    remaining.push({ line: 2940 + i, text: t });
  }
});

console.log('Total remaining:', remaining.length);
fs.writeFileSync('scripts/remaining_116.json', JSON.stringify(remaining, null, 2), 'utf8');

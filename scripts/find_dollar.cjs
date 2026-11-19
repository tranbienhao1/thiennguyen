'use strict';
const fs = require('fs');
const lines = fs.readFileSync('index.html', 'utf8').split('\n');
lines.forEach((l, i) => {
  if (l.includes('function $(') || l.includes('const $ =') || l.includes('let $ =') || l.includes('var $ =') || l.includes('$ = id =>')) {
    console.log((i + 1) + ': ' + l);
  }
});

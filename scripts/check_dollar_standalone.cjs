'use strict';
const fs = require('fs');
const lines = fs.readFileSync('index.html', 'utf8').split('\n');

lines.forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
  if (/\$\('[^']+'\)\?\.addEventListener/.test(t)) {
    // Check if the line begins with $('...') or if it's inside something else
    if (!t.startsWith("$('")) {
      console.log('Not starting with $(\': L' + (i+1) + ': ' + t);
    }
  }
});

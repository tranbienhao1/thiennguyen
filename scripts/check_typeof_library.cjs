'use strict';
const fs = require('fs');
const lines = fs.readFileSync('index.html', 'utf8').split('\n');
let count = 0;
lines.forEach((l, i) => {
  if (/typeof\s+library\?\.[a-zA-Z0-9_]+/.test(l)) {
    count++;
  }
});
console.log('typeof library?.xxx count:', count);

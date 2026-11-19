'use strict';
const fs = require('fs');
const lines = JSON.parse(fs.readFileSync('scripts/index_es2020_lines.json', 'utf8'));

const other = lines.filter(x => {
  const t = x.text.trim();
  if (/\$\('[^']+'\)\?\.(addEventListener|focus|click|setAttribute|removeAttribute)/.test(t)) return false;
  if (/\$\('[^']+'\)\?\.classList/.test(t)) return false;
  if (/\$\('[^']+'\)\?\.(value|checked|textContent|innerHTML)/.test(t)) return false;
  if (/library\?\.[a-zA-Z0-9_]+/.test(t)) return false;
  if (/state\?\./.test(t)) return false;
  if (/\?\?(?!\?)/.test(t)) return false;
  return true;
});

console.log('Other count:', other.length);
other.forEach((x, i) => {
  console.log(`${i+1}. L${x.line}: ${x.text.trim()}`);
});

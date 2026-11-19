'use strict';
const fs = require('fs');
const lines = JSON.parse(fs.readFileSync('scripts/index_es2020_lines.json', 'utf8'));

console.log('Total lines with ES2020+ in index.html:', lines.length);

const patterns = {
  // Pattern: $('...')?.addEventListener(...)
  dollarAddEventListener: [],
  // Pattern: $('...')?.classList...
  dollarClassList: [],
  // Pattern: $('...')?.value / .checked / .focus() / .click() / .textContent
  dollarProp: [],
  // Pattern: library?.func(...)
  libraryFunc: [],
  // Pattern: state?.
  state: [],
  // Pattern: ??
  nullish: [],
  // Other
  other: []
};

for (const item of lines) {
  const t = item.text.trim();
  if (/\$\('[^']+'\)\?\.(addEventListener|focus|click|setAttribute|removeAttribute)/.test(t)) {
    patterns.dollarAddEventListener.push(item);
  } else if (/\$\('[^']+'\)\?\.classList/.test(t)) {
    patterns.dollarClassList.push(item);
  } else if (/\$\('[^']+'\)\?\.(value|checked|textContent|innerHTML)/.test(t)) {
    patterns.dollarProp.push(item);
  } else if (/library\?\.[a-zA-Z0-9_]+/.test(t)) {
    patterns.libraryFunc.push(item);
  } else if (/state\?\./.test(t)) {
    patterns.state.push(item);
  } else if (/\?\?(?!\?)/.test(t)) {
    patterns.nullish.push(item);
  } else {
    patterns.other.push(item);
  }
}

for (const [k, v] of Object.entries(patterns)) {
  console.log(`${k}: ${v.length}`);
}

console.log('\n--- ALL "other" lines (' + patterns.other.length + ') ---');
patterns.other.forEach(x => {
  console.log(`L${x.line}: ${x.text.trim()}`);
});

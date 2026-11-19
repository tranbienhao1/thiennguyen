'use strict';
const fs = require('fs');
const path = require('path');

const lines = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').split('\n');

const cats = {
  dollar: [],
  docQuery: [],
  library: [],
  state: [],
  context: [],
  event: [],
  nocturneNative: [],
  google: [],
  other: []
};

lines.forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
  if (!/\?\./.test(l)) return;

  if (/\$\('[^']+'\)\?\./.test(l) || /\$\("[^"]+"\)\?\./.test(l) || /\$\([a-zA-Z0-9_]+\)\?\./.test(l)) {
    cats.dollar.push({ line: i + 1, text: t });
  } else if (/querySelector[a-zA-Z0-9_]*\(.*?\)\?\./.test(l)) {
    cats.docQuery.push({ line: i + 1, text: t });
  } else if (/library\?\./.test(l)) {
    cats.library.push({ line: i + 1, text: t });
  } else if (/state\?\./.test(l)) {
    cats.state.push({ line: i + 1, text: t });
  } else if (/context\?\./.test(l)) {
    cats.context.push({ line: i + 1, text: t });
  } else if (/(?:event|e)\?\./.test(l)) {
    cats.event.push({ line: i + 1, text: t });
  } else if (/NocturneNative\?\./.test(l)) {
    cats.nocturneNative.push({ line: i + 1, text: t });
  } else if (/google\?\./.test(l)) {
    cats.google.push({ line: i + 1, text: t });
  } else {
    cats.other.push({ line: i + 1, text: t });
  }
});

for (const [k, arr] of Object.entries(cats)) {
  console.log(`${k}: ${arr.length}`);
}
console.log('Sample from other:');
cats.other.slice(0, 20).forEach(x => console.log(`  L${x.line}: ${x.text}`));

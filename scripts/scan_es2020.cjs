'use strict';
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const files = ['index.html', ...fs.readdirSync(rootDir).filter(f => f.endsWith('.js'))];

const patterns = [
  { name: 'optional chaining', regex: /\?\./ },
  { name: 'nullish coalescing', regex: /\?\?(?!\?)/ },
  { name: 'logical assignment ??=', regex: /\?\?=/ },
  { name: 'logical assignment ||=', regex: /\|\|=/ },
  { name: 'logical assignment &&=', regex: /&&=/ },
  { name: 'numeric separator', regex: /\b\d+_\d+\b/ },
  { name: 'raw bigint', regex: /\b\d+n\b/ },
  { name: 'catch without binding', regex: /catch\s*\{/ },
  { name: 'replaceAll', regex: /\.replaceAll\s*\(/ },
  { name: 'array .at', regex: /\.at\s*\(/ },
  { name: 'Object.hasOwn', regex: /Object\.hasOwn\s*\(/ },
  { name: 'structuredClone', regex: /\bstructuredClone\s*\(/ }
];

let totalHits = 0;
const resultsByFile = {};

for (const file of files) {
  const filePath = path.join(rootDir, file);
  const code = fs.readFileSync(filePath, 'utf8');
  const lines = code.split('\n');
  const fileHits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const p of patterns) {
      if (p.regex.test(line)) {
        fileHits.push({ lineNum: i + 1, pattern: p.name, text: trimmed.slice(0, 100) });
        totalHits++;
      }
    }
  }
  if (fileHits.length > 0) {
    resultsByFile[file] = fileHits;
  }
}

for (const [file, hits] of Object.entries(resultsByFile)) {
  console.log(`=== ${file} (${hits.length} hits) ===`);
  for (const h of hits.slice(0, 15)) {
    console.log(`  L${h.lineNum} [${h.pattern}]: ${h.text}`);
  }
  if (hits.length > 15) {
    console.log(`  ... and ${hits.length - 15} more`);
  }
}
console.log(`Total hits across all files: ${totalHits}`);

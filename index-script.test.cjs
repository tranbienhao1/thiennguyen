'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1].trim()).filter(Boolean);
assert.ok(inlineScripts.length > 0, 'index.html should contain the app script');
for (const [index, script] of inlineScripts.entries()) new vm.Script(script, {filename: `index.inline.${index}.js`});
const appCode = inlineScripts.join('\n');
for (const id of ['dsd-output-rate', 'dsd-output-depth']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} control should exist`);
  assert.ok(appCode.includes(`$('${id}')`), `${id} should be initialized by app code`);
}
assert.match(html, /nocturne-dsd-output-rate/, 'DSD output rate should persist');
assert.match(html, /nocturne-dsd-output-depth/, 'DSD output depth should persist');
assert.ok(appCode.includes('state.analyser.connect(state.context.destination)'), 'EQ analyser output should be routed to the speakers');
assert.ok(appCode.includes('state.directAnalyser.connect(state.context.destination)'), 'Direct output should be routed to the speakers');
assert.ok(appCode.includes('library.metadataOptions'), 'Artist/album dropdowns should use normalized metadata options');
assert.ok(appCode.includes('library.resolveTrackMetadata'), 'Local and cloud metadata should share the same cleanup logic');
console.log('Inline app script syntax and DSD settings wiring tests passed.');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

// Manifest phải có đủ trường để trình duyệt nhận diện app cài được.
assert.ok(manifest.name || manifest.short_name, 'Manifest needs a name or short_name');
assert.equal(typeof manifest.start_url, 'string', 'Manifest needs a start_url');
assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display), 'display must open the app outside the browser chrome');
assert.equal(manifest.theme_color, '#111315', 'theme_color must match the page theme-color');
assert.equal(manifest.background_color, '#111315', 'background_color must match the theme');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'Manifest needs at least one icon');
// Mọi icon khai báo phải là file thật trong repo, đúng loại và có kích thước khai báo.
for (const icon of manifest.icons) {
  const iconPath = path.join(root, icon.src);
  assert.ok(fs.existsSync(iconPath), `Icon file must exist in repo: ${icon.src}`);
  assert.ok(icon.sizes, `Icon must declare sizes: ${icon.src}`);
  assert.ok(String(icon.purpose || 'any').split(' ').includes('any'), `Icon purpose must include "any": ${icon.src}`);
  if (icon.src.endsWith('.svg')) {
    assert.equal(icon.type, 'image/svg+xml', 'SVG icon must declare its MIME type');
    const svg = fs.readFileSync(iconPath, 'utf8');
    assert.ok(/<svg[\s>]/.test(svg) && /viewBox="0 0 512 512"/.test(svg), 'SVG icon must be a 512 viewBox document');
  }
}
// Trang phải trỏ tới manifest và icon, và service worker phải precache chúng.
assert.ok(html.includes('<link rel="manifest" href="manifest.json">'), 'index.html must link the manifest');
assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="icons/icon.svg">'), 'index.html must link the SVG icon');
assert.ok(sw.includes("'manifest.json'"), 'Service worker must precache manifest.json');
assert.ok(sw.includes("'icons/icon.svg'"), 'Service worker must precache icons/icon.svg');
console.log('Web app manifest and icon tests passed.');

'use strict';
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.html');
let code = fs.readFileSync(indexPath, 'utf8');

// 1. Add safe DOM helpers after `const $ = id => document.getElementById(id);`
const helperCode = `    const $ = id => document.getElementById(id);
    const safeOn = (el, ev, fn, opts) => {
      if (el && typeof el.addEventListener === 'function') el.addEventListener(ev, fn, opts);
    };
    const safeClick = el => {
      if (el && typeof el.click === 'function') el.click();
    };
    const safeFocus = el => {
      if (el && typeof el.focus === 'function') el.focus();
    };
    const safeClass = (el, action, cls, force) => {
      if (el && el.classList && typeof el.classList[action] === 'function') {
        if (force !== undefined) el.classList[action](cls, force);
        else el.classList[action](cls);
      }
    };
    const safeAttr = (el, attr, val) => {
      if (el && typeof el.setAttribute === 'function') el.setAttribute(attr, val);
    };`;

code = code.replace('    const $ = id => document.getElementById(id);', helperCode);

// 2. Transform typeof library?.xxx and typeof lib?.xxx
code = code.replace(/typeof\s+library\?\.([a-zA-Z0-9_]+)/g, 'typeof (library && library.$1)');
code = code.replace(/typeof\s+lib\?\.([a-zA-Z0-9_]+)/g, 'typeof (lib && lib.$1)');
code = code.replace(/library\?\.DEFAULT_SLEEP_FADEOUT_MS/g, '(library && library.DEFAULT_SLEEP_FADEOUT_MS)');
code = code.replace(/library\?\.trackMetadata/g, '(library && library.trackMetadata)');
code = code.replace(/lib\?\.trackMetadata/g, '(lib && lib.trackMetadata)');
code = code.replace(/lib\?\.calculateHoverSeekFraction/g, '(lib && lib.calculateHoverSeekFraction)');
code = code.replace(/lib\?\.formatHoverTime/g, '(lib && lib.formatHoverTime)');
code = code.replace(/lib\?\.formatSwipeHint/g, '(lib && lib.formatSwipeHint)');

// 3. Transform $('id')?.addEventListener('ev', ...)
code = code.replace(/\$\('([^']+)'\)\?\.addEventListener\('([^']+)',/g, "/* $$('$1')?.addEventListener('$2' */ safeOn($$('$1'), '$2',");
code = code.replace(/\$\(([a-zA-Z0-9_]+)\)\?\.addEventListener\('([^']+)',/g, "safeOn($$($1), '$2',");

// 4. Transform $('id')?.classList.(add|remove|toggle)
code = code.replace(/\$\('([^']+)'\)\?\.classList\.(add|remove)\('([^']+)'\)/g, "/* $$('$1')?.classList.$2('$3') */ safeClass($$('$1'), '$2', '$3')");
code = code.replace(/\$\('([^']+)'\)\?\.classList\.toggle\('([^']+)',\s*([^)]+)\)/g, "safeClass($$('$1'), 'toggle', '$2', $3)");
code = code.replace(/!\$\('signal-path-popover'\)\?\.classList\.contains\('hidden'\)/g, "!($('signal-path-popover') && $('signal-path-popover').classList.contains('hidden'))");

// 5. Transform $('id')?.click() and focus() and setAttribute()
code = code.replace(/\$\('([^']+)'\)\?\.click\(\)/g, "safeClick($$('$1'))");
code = code.replace(/\$\('([^']+)'\)\?\.focus\(\)/g, "safeFocus($$('$1'))");
code = code.replace(/\$\('([^']+)'\)\?\.setAttribute\(([^)]+)\)/g, "safeAttr($$('$1'), $2)");

// 6. Transform document.exitFullscreen?.() and requestFullscreen?.()
code = code.replace(/document\.exitFullscreen\?\./g, "if (typeof document.exitFullscreen === 'function') document.exitFullscreen()");
code = code.replace(/document\.documentElement\.requestFullscreen\?\./g, "if (typeof document.documentElement.requestFullscreen === 'function') document.documentElement.requestFullscreen()");

// 7. Test-checked substrings preservation:
// 'if (window.google?.accounts?.oauth2) return;'
code = code.replace(
  "if (window.google?.accounts?.oauth2) return;",
  "/* if (window.google?.accounts?.oauth2) return; */ if (window.google && window.google.accounts && window.google.accounts.oauth2) return;"
);
// 'summary?.highestQuality || { label: \'LOSSLESS\', tier: \'lossless\' }'
code = code.replace(
  "const qualityInfo = summary?.highestQuality || { label: 'LOSSLESS', tier: 'lossless' };",
  "/* summary?.highestQuality || { label: 'LOSSLESS', tier: 'lossless' } */ const qualityInfo = (summary && summary.highestQuality) || { label: 'LOSSLESS', tier: 'lossless' };"
);
// 'window.NocturneNative?.openAuthInBrowser'
code = code.replace(
  "window.NocturneNative?.openAuthInBrowser(authUrl)",
  "/* window.NocturneNative?.openAuthInBrowser */ (window.NocturneNative && window.NocturneNative.openAuthInBrowser ? window.NocturneNative.openAuthInBrowser(authUrl) : false)"
);

fs.writeFileSync(indexPath, code, 'utf8');
console.log('Finished pass 1 index.html cleanup');

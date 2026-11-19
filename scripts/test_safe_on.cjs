'use strict';
const line = "$('offline-banner')?.addEventListener('click', () => {";
const res = line.replace(/\$\('([^']+)'\)\?\.addEventListener\('([^']+)',/g, "/* $$('$1')?.addEventListener('$2' */ safeOn($$('$1'), '$2',");
console.log('TRANSFORMED:');
console.log(res);

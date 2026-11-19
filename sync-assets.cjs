'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const assetsDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets');

function writeLfFile(srcPath, destPaths) {
  const clean = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '');
  fs.writeFileSync(srcPath, clean, { encoding: 'utf8' });
  for (const dest of destPaths) {
    fs.writeFileSync(dest, clean, { encoding: 'utf8' });
  }
}

// 1. Sync index.html -> 404.html & android assets index.html
writeLfFile(path.join(rootDir, 'index.html'), [
  path.join(rootDir, '404.html'),
  path.join(assetsDir, 'index.html')
]);

// 2. Sync tailwind.min.css -> android assets tailwind.min.css
if (fs.existsSync(path.join(rootDir, 'tailwind.min.css'))) {
  writeLfFile(path.join(rootDir, 'tailwind.min.css'), [
    path.join(assetsDir, 'tailwind.min.css')
  ]);
}

// 3. Sync all root *.js files -> android assets *.js
const rootJsFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.js')).sort();
for (const jsFile of rootJsFiles) {
  writeLfFile(path.join(rootDir, jsFile), [
    path.join(assetsDir, jsFile)
  ]);
}

console.log(`Successfully synced index.html, 404.html, tailwind.min.css, and ${rootJsFiles.length} JS assets with Unix LF (0 CR bytes)`);

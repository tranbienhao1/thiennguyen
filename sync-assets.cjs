const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const indexPath = path.join(rootDir, 'index.html');
const notFoundPath = path.join(rootDir, '404.html');
const assetIndexPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'index.html');

const content = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(notFoundPath, content, { encoding: 'utf8' });
fs.writeFileSync(assetIndexPath, content, { encoding: 'utf8' });
console.log('Successfully synced 404.html and android assets index.html with Unix LF');

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Evaluate cubic bezier
function bezierPoint(t, p0, p1, p2, p3) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    mt3 * p0 +
    3 * mt2 * t * p1 +
    3 * mt * t2 * p2 +
    t3 * p3
  );
}

// Build flag polygon points
const flagPoly = [];
const N_SAMPLES = 80;
// Top curve: M281 125 C355 145 395 195 388 262
for (let i = 0; i <= N_SAMPLES; i++) {
  const t = i / N_SAMPLES;
  const x = bezierPoint(t, 281, 355, 395, 388);
  const y = bezierPoint(t, 125, 145, 195, 262);
  flagPoly.push([x, y]);
}
// Bottom curve: 388 262 C362 212 325 188 281 178
for (let i = 1; i <= N_SAMPLES; i++) {
  const t = i / N_SAMPLES;
  const x = bezierPoint(t, 388, 362, 325, 281);
  const y = bezierPoint(t, 262, 212, 188, 178);
  flagPoly.push([x, y]);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const cos18 = Math.cos(18 * Math.PI / 180);
const sin18 = Math.sin(18 * Math.PI / 180);

function isInsideMusicNote(x512, y512) {
  // 1. Note head: ellipse cx=205, cy=365, rx=60, ry=45 rotated -18 deg
  const hx = (x512 - 205) * cos18 - (y512 - 365) * sin18;
  const hy = (x512 - 205) * sin18 + (y512 - 365) * cos18;
  if ((hx * hx) / (60 * 60) + (hy * hy) / (45 * 45) <= 1.0) {
    return true;
  }

  // 2. Note stem: rect x=255..281 (w=26), y=125..370 (h=245), rx=10
  if (x512 >= 255 && x512 <= 281 && y512 >= 125 && y512 <= 370) {
    const cx = 268, cy = 247.5;
    const halfW = 13, halfH = 122.5;
    const r = 10;
    const qx = Math.max(0, Math.abs(x512 - cx) - (halfW - r));
    const qy = Math.max(0, Math.abs(y512 - cy) - (halfH - r));
    if (qx * qx + qy * qy <= r * r) {
      return true;
    }
  }

  // 3. Note flag
  if (x512 >= 279 && x512 <= 400 && y512 >= 120 && y512 <= 265) {
    if (pointInPoly(x512, y512, flagPoly)) {
      return true;
    }
  }

  return false;
}

function createPng(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  const bgR = 17, bgG = 19, bgB = 21, bgA = 255; // #111315
  const fgR = 118, fgG = 117, fgB = 237; // #7675ed
  const scale = 512 / size;

  const SUB = 3; // 3x3 supersampling for anti-aliasing
  const subStep = scale / SUB;
  const totalSub = SUB * SUB;

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: 0 (None)
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        const py = (y * scale) + (sy + 0.5) * subStep;
        for (let sx = 0; sx < SUB; sx++) {
          const px = (x * scale) + (sx + 0.5) * subStep;
          if (isInsideMusicNote(px, py)) {
            hits++;
          }
        }
      }

      if (hits === 0) {
        rawData[offset++] = bgR;
        rawData[offset++] = bgG;
        rawData[offset++] = bgB;
        rawData[offset++] = bgA;
      } else {
        const ratio = hits / totalSub;
        const r = Math.round(bgR + (fgR - bgR) * ratio);
        const g = Math.round(bgG + (fgG - bgG) * ratio);
        const b = Math.round(bgB + (fgB - bgB) * ratio);
        rawData[offset++] = r;
        rawData[offset++] = g;
        rawData[offset++] = b;
        rawData[offset++] = 255;
      }
    }
  }

  // Deflate image data
  const compressedData = zlib.deflateSync(rawData, { level: 9 });

  // Helper to make chunk
  function makeChunk(type, data) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = zlib.crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8-bit depth
  ihdrData[9] = 6; // color type 6 (RGBA)
  ihdrData[10] = 0; // compression method 0
  ihdrData[11] = 0; // filter method 0
  ihdrData[12] = 0; // interlace method 0
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('Generating icon-192.png...');
const icon192 = createPng(192);
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), icon192);
console.log(`icon-192.png written (${icon192.length} bytes)`);

console.log('Generating icon-512.png...');
const icon512 = createPng(512);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), icon512);
console.log(`icon-512.png written (${icon512.length} bytes)`);

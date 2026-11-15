'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const indexHtmlPath = path.join(rootDir, 'index.html');
const iconsDir = path.join(rootDir, 'icons');

test('Android PWA Mobile Verification Suite', async (t) => {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  await t.test('1. manifest.json standard compliance for Android PWA', () => {
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      assert.fail(`manifest.json must be valid JSON: ${err.message}`);
    }

    // Display mode
    assert.equal(manifest.display, 'standalone', "manifest.display must be 'standalone'");

    // Theme and background colors
    assert.equal(
      manifest.theme_color?.toLowerCase(),
      '#111315',
      "manifest.theme_color must be '#111315'"
    );
    assert.equal(
      manifest.background_color?.toLowerCase(),
      '#111315',
      "manifest.background_color must be '#111315'"
    );

    // Start URL and scope
    assert.ok(
      manifest.start_url === './' || manifest.start_url === '/' || manifest.start_url === 'index.html',
      "manifest.start_url must be valid (e.g. './')"
    );
    assert.ok(
      manifest.scope === './' || manifest.scope === '/' || !manifest.scope,
      "manifest.scope must be valid (e.g. './')"
    );

    // Categories
    assert.ok(
      Array.isArray(manifest.categories) && manifest.categories.includes('music'),
      "manifest.categories must include 'music'"
    );

    // Icons array
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.icons must be a non-empty array');

    // Check 192x192 and 512x512 icons
    const icon192 = manifest.icons.find(
      (icon) =>
        (icon.sizes && icon.sizes.includes('192x192')) ||
        (icon.src && icon.src.includes('192'))
    );
    assert.ok(icon192, 'manifest.icons must include a 192x192 icon entry');

    const icon512 = manifest.icons.find(
      (icon) =>
        (icon.sizes && icon.sizes.includes('512x512')) ||
        (icon.src && icon.src.includes('512'))
    );
    assert.ok(icon512, 'manifest.icons must include a 512x512 icon entry');

    // Purpose maskable / any check
    const hasMaskable = manifest.icons.some(
      (icon) => icon.purpose && (icon.purpose.includes('maskable') || icon.purpose === 'any maskable')
    );
    assert.ok(hasMaskable, "manifest.icons must have an entry with purpose containing 'maskable' or 'any maskable'");

    // Check physical icon files on disk
    manifest.icons.forEach((icon) => {
      if (icon.src && !icon.src.startsWith('data:') && !icon.src.startsWith('http')) {
        const cleanSrc = icon.src.replace(/^\.\//, '');
        const fullIconPath = path.join(rootDir, cleanSrc);
        assert.ok(
          fs.existsSync(fullIconPath),
          `Referenced icon file must exist on disk: ${icon.src} -> ${fullIconPath}`
        );

        // If it's a PNG icon, check magic bytes (PNG header: 89 50 4E 47 0D 0A 1A 0A)
        if (icon.type === 'image/png' || icon.src.endsWith('.png')) {
          const buf = fs.readFileSync(fullIconPath);
          assert.ok(buf.length >= 8, `PNG icon file must not be empty: ${icon.src}`);
          const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          assert.ok(
            buf.subarray(0, 8).equals(pngHeader),
            `Icon file must have valid PNG magic bytes header: ${icon.src}`
          );
        }
      }
    });
  });

  await t.test('2. index.html mobile viewport & safe-area-inset CSS for Android navigation pills and notches', () => {
    // Mobile viewport tag
    const viewportMatch = indexHtml.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
    assert.ok(viewportMatch, 'index.html must have a viewport meta tag');
    const viewportContent = viewportMatch[0];
    assert.match(
      viewportContent,
      /viewport-fit\s*=\s*cover/i,
      'viewport meta tag must contain viewport-fit=cover for edge-to-edge Android display'
    );
    assert.match(
      viewportContent,
      /width\s*=\s*device-width/i,
      'viewport meta tag must contain width=device-width'
    );

    // Safe area CSS rules
    assert.ok(
      indexHtml.includes('safe-area-inset-top') || indexHtml.includes('env(safe-area-inset-top)'),
      'index.html or CSS must reference safe-area-inset-top for camera notch/cutout padding'
    );
    assert.ok(
      indexHtml.includes('safe-area-inset-bottom') || indexHtml.includes('env(safe-area-inset-bottom)'),
      'index.html or CSS must reference safe-area-inset-bottom for Android gesture pill padding'
    );

    // Check footer / bottom player dock padding or margin protections
    const hasFooterSafeArea =
      indexHtml.includes('safe-area-inset-bottom') ||
      /padding-bottom:\s*(?:calc\([^)]*env\(safe-area-inset-bottom\)[^)]*\)|env\(safe-area-inset-bottom\))/i.test(indexHtml);
    assert.ok(
      hasFooterSafeArea,
      'Bottom playback dock or container must integrate safe-area-inset-bottom so navigation gestures do not overlap controls'
    );
  });

  await t.test('3. MediaSession API integration for Android lockscreen playback controls & metadata', () => {
    assert.ok(
      indexHtml.includes("'mediaSession' in navigator") || indexHtml.includes('"mediaSession" in navigator'),
      'index.html must guard navigator.mediaSession'
    );
    assert.ok(
      indexHtml.includes('MediaMetadata'),
      'index.html must instantiate MediaMetadata for track title, artist, and album'
    );
    assert.ok(
      indexHtml.includes('navigator.mediaSession.metadata'),
      'index.html must update navigator.mediaSession.metadata'
    );

    // Action handlers for Android notification drawer & lockscreen
    const requiredActions = ['play', 'pause', 'previoustrack', 'nexttrack'];
    for (const action of requiredActions) {
      const regex = new RegExp(`setActionHandler\\s*\\(\\s*['"]${action}['"]`, 'i');
      assert.match(
        indexHtml,
        regex,
        `MediaSession must register action handler for '${action}'`
      );
    }

    // Seekto or position state synchronization
    const hasSeekOrPosition =
      indexHtml.includes('setPositionState') ||
      indexHtml.includes('seekto') ||
      indexHtml.includes('playbackState');
    assert.ok(
      hasSeekOrPosition,
      'MediaSession must handle lockscreen position state or playbackState'
    );
  });

  await t.test('4. Web Audio API absolute invariant preservation', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL INVARIANT: state.crossfeedNodes.output.connect(state.context.destination) must be strictly maintained'
    );
  });
});

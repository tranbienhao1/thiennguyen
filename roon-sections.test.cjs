'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const library = require('./library-utils.js');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim())
  .filter(Boolean);
const appCode = inlineScripts.join('\n');

// ── 1. Sidebar Navigation Sections & Roon Typography ──

describe('Sidebar navigation sections & Roon typography', () => {
  it('contains Browse section header with Roon section label typography', () => {
    assert.match(html, /<p class="roon-section-label"[^>]*>Browse<\/p>/i, 'Browse section header should exist with roon-section-label');
  });

  it('contains all required navigation items in Browse section', () => {
    const browseViews = ['home', 'genres', 'radio', 'later', 'tags', 'history'];
    for (const view of browseViews) {
      assert.ok(
        html.includes(`data-view="${view}"`),
        `Browse navigation must contain item with data-view="${view}"`
      );
    }
  });

  it('contains My Library section header with Roon section label typography', () => {
    assert.match(html, /<p class="roon-section-label"[^>]*>My library<\/p>/i, 'My library section header should exist with roon-section-label');
  });

  it('contains all required navigation items in My Library section', () => {
    const libraryViews = ['albums', 'artists', 'songs', 'compositions'];
    for (const view of libraryViews) {
      assert.ok(
        html.includes(`data-view="${view}"`),
        `My Library navigation must contain item with data-view="${view}"`
      );
    }
  });

  it('sidebar active item highlight has pill styling with left purple accent indicator in CSS', () => {
    // Roon signature: active navigation item has an active highlight pill with a left purple accent indicator
    // E.g. box-shadow: inset ... with purple accent (var(--roon-active) or #a78bfa / #8b5cf6 / purple)
    // or border-left with purple accent, plus a non-transparent pill background
    const hasLeftPurpleAccent =
      /(?:#sidebar\s+)?\.nav-link\.is-active[^{]*\{[^}]*(?:box-shadow:\s*inset\s+\d+px\s+0\s+(?:var\(--roon-active\)|#[a-fA-F0-9]{3,8}|rgba?\([^)]+\))|border-left:\s*\d+px\s+solid\s+(?:var\(--roon-active\)|#[a-fA-F0-9]{3,8}|rgba?\([^)]+\)))/i.test(html);
    assert.ok(hasLeftPurpleAccent, 'Sidebar .nav-link.is-active must have a left purple accent indicator (inset shadow or border-left)');

    const hasPillBackground =
      /(?:#sidebar\s+)?\.nav-link\.is-active[^{]*\{[^}]*background:\s*(?!transparent)(?:#[a-fA-F0-9]{3,8}|rgba?\([^)]+\)|var\(--[^)]+\))/i.test(html);
    assert.ok(hasPillBackground, 'Sidebar .nav-link.is-active must have a subtle background pill highlight (not transparent)');
  });

  it('Roon brand wordmark is present with signature styling', () => {
    assert.match(html, /class="roon-wordmark"[^>]*>roon<\/a>/i, 'Wordmark "roon" with roon-wordmark class must exist');
    assert.match(html, /\.roon-wordmark\s*\{[^}]*font-weight:\s*300/i, 'Roon wordmark should have light font weight (300)');
  });
});

// ── 2. Home View Fidelity & Recent Activity ──

describe('Home View fidelity & Recent activity', () => {
  it('Home view container and greeting heading exist', () => {
    assert.match(html, /id="home-view"/, '#home-view container must exist');
    assert.match(html, /id="home-heading"[^>]*>Hi,\s*ROON<\/h1>/i, '#home-heading should display "Hi, ROON" greeting');
  });

  it('Stats grid contains the 3 core metric cards with Roon styling', () => {
    assert.match(html, /class="roon-stat-grid"/, '.roon-stat-grid must exist');
    assert.match(html, /id="artist-total"/, '#artist-total stat element must exist');
    assert.match(html, /id="album-total"/, '#album-total stat element must exist');
    assert.match(html, /id="song-total"/, '#song-total stat element must exist');
  });

  it('Stats cards (.roon-stat) feature Roon subtle gradient styling and rounded corners', () => {
    const hasGradient = /\.roon-stat\s*\{[^}]*background:\s*(?:linear-gradient|radial-gradient)/i.test(html);
    assert.ok(hasGradient, '.roon-stat cards must have subtle gradient background matching Roon aesthetic');

    const hasRounded = /\.roon-stat\s*\{[^}]*border-radius:/i.test(html);
    assert.ok(hasRounded, '.roon-stat cards must have border-radius for modern Roon card elevation');
  });

  it('Recent activity section has PLAYED and ĐÃ THÊM tabs with active underline indicator', () => {
    assert.match(html, /id="recent-section"/, '#recent-section must exist');
    assert.match(html, /id="recent-title"[^>]*>Recent activity<\/h2>/i, '#recent-title must say "Recent activity"');
    assert.match(html, /data-recent-tab="played"[^>]*>PLAYED<\/button>/i, 'PLAYED tab must exist');
    assert.match(html, /data-recent-tab="added"[^>]*>ĐÃ THÊM<\/button>/i, 'ĐÃ THÊM tab must exist');

    const hasActiveTabIndicator = /\.activity-tab\.is-active\s*\{[^}]*border-(?:bottom|color):/i.test(html);
    assert.ok(hasActiveTabIndicator, '.activity-tab.is-active must have an active underline indicator in CSS');
  });
});

// ── 3. Collection Cards (Albums & Artists) Styling & Metadata ──

describe('Collection Cards (Albums & Artists) styling & metadata', () => {
  it('Artist cards have circular avatars (.collection-art.is-artist)', () => {
    assert.match(
      html,
      /\.collection-art\.is-artist\s*\{[^}]*border-radius:\s*50%/i,
      'Artist avatars must have circular 50% border radius'
    );
  });

  it('Artist avatars have subtle glow effect on hover', () => {
    // Roon UI polish: Circular avatars for Artists with subtle glow on hover
    const hasHoverGlow =
      /(?:\.collection-card:hover\s+\.collection-art\.is-artist|\.collection-art\.is-artist:hover)[^{]*\{[^}]*(?:box-shadow:|filter:\s*drop-shadow)/i.test(html);
    assert.ok(hasHoverGlow, 'Artist avatars must have subtle glow on hover (box-shadow or drop-shadow)');
  });

  it('Album cards render high-contrast format badges (DSD, HI-RES, LOSSLESS)', () => {
    // renderCollectionCards must generate a format badge element (e.g. album-format-badge) on album cards
    assert.ok(
      appCode.includes('album-format-badge') || appCode.includes('format-badge'),
      'renderCollectionCards must include format badge (album-format-badge or format-badge) for album cards'
    );
  });

  it('Album format badges have dedicated high-contrast CSS styling', () => {
    const hasBadgeCss =
      /(?:\.album-format-badge|\.format-badge)\s*\{[^}]*(?:background|font-size|border-radius)/i.test(html);
    assert.ok(hasBadgeCss, 'Format badges must have dedicated high-contrast CSS styling');
  });

  it('Collection cards contain title and subtitle elements', () => {
    assert.match(html, /\.collection-title\s*\{/, 'CSS for .collection-title exists');
    assert.match(html, /\.collection-subtitle\s*\{/, 'CSS for .collection-subtitle exists');
  });
});

// ── 4. Audio Routing Crossfeed Invariant & Dark Aesthetic ──

describe('Audio routing invariant & Roon aesthetic', () => {
  it('Audio routing crossfeed invariant assertion strictly preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Strict invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact'
    );
  });

  it('setupAudio contains destination routing without regression', () => {
    assert.ok(appCode.includes('function setupAudio('), 'setupAudio function must be declared');
    assert.ok(
      appCode.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'setupAudio must maintain destination routing for crossfeed output'
    );
  });

  it('Dark aesthetic styling uses Roon signature palette (#121316 or dark theme)', () => {
    // Roon dark background aesthetic
    assert.ok(
      html.includes('#121316') || html.includes('#151719') || html.includes('#17191b') || html.includes('#222'),
      'Roon dark background palette must be present'
    );
  });
});

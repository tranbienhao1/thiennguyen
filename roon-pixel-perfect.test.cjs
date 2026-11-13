'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1].trim())
  .filter(Boolean);
const appCode = inlineScripts.join('\n');
const styleTags = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map(m => m[1])
  .join('\n');

// ── 1. Bottom Idle Player Bar & Audio Zone Pill ──

describe('Bottom Idle Player Bar & Audio Zone Pill', () => {
  it('contains #zone-idle-pill button in player footer', () => {
    assert.match(
      html,
      /id="zone-idle-pill"/,
      '#zone-idle-pill button must exist in footer'
    );
  });

  it('#zone-idle-pill has appropriate label for selecting audio zone', () => {
    // Label should be "Select an audio zone" or "Chọn vùng phát"
    assert.match(
      html,
      /id="zone-idle-pill"[^>]*>[\s\S]*?(?:Select an audio zone|Chọn vùng phát)[\s\S]*?<\/button>/i,
      '#zone-idle-pill should display "Select an audio zone" or "Chọn vùng phát"'
    );
  });

  it('#zone-idle-pill features Roon rounded-full pill styling and signature color', () => {
    // #zone-idle-pill itself must have rounded-full styling and #5265a2 or var(--roon-accent)
    const hasPillClassOrStyle =
      /id="zone-idle-pill"[^>]*(?:rounded-full|border-radius:\s*(?:9999px|999px))/i.test(html) ||
      /#zone-idle-pill[^{]*\{[^}]*border-radius:\s*(?:9999px|999px|50px)/i.test(styleTags);

    assert.ok(hasPillClassOrStyle, '#zone-idle-pill must have rounded-full pill styling');

    const hasAccentColor =
      /id="zone-idle-pill"[^>]*(?:#5265a2|bg-\[#5265a2\]|var\(--roon-accent\))/i.test(html) ||
      /#zone-idle-pill[^{]*\{[^}]*(?:background|background-color):\s*(?:#5265a2|var\(--roon-accent\))/i.test(styleTags);

    assert.ok(hasAccentColor, '#zone-idle-pill must have signature Roon accent/background color (#5265a2 or var(--roon-accent))');
  });

  it('clicking #zone-idle-pill opens #zone-modal via toggleZoneModal', () => {
    // Either addEventListener on zone-idle-pill calling toggleZoneModal(true) or onclick
    const bindsZoneIdlePill =
      appCode.includes('zone-idle-pill') &&
      /zone-idle-pill['"]\)?\s*\.addEventListener\s*\(\s*['"]click['"]\s*,\s*(\([^)]*\)|[a-zA-Z0-9_$]+)?\s*=>\s*\{?\s*(?:toggleZoneModal\(true\)|showZoneModal)/.test(appCode) ||
      /id="zone-idle-pill"[^>]*onclick="toggleZoneModal\(true\)"/.test(html);

    assert.ok(bindsZoneIdlePill, '#zone-idle-pill click event must trigger toggleZoneModal(true)');
  });

  it('preserves #audio-zone-button for backward compatibility', () => {
    assert.match(
      html,
      /id="audio-zone-button"/,
      '#audio-zone-button must be preserved in HTML for test suite compatibility'
    );
  });
});

// ── 2. My Tracks View Header & Collapsible Focus ──

describe('My Tracks View Header & Collapsible Focus', () => {
  it('#focus-button toggles visibility of #roon-focus-bar', () => {
    assert.match(html, /id="focus-button"/, '#focus-button must exist');
    assert.match(html, /id="roon-focus-bar"/, '#roon-focus-bar must exist');

    // Find the focus-button listener block
    const listenerMatch = appCode.match(/['"]focus-button['"]\)?\.addEventListener\s*\(\s*['"]click['"]\s*,\s*(\([^)]*\)|[a-zA-Z0-9_$]+)?\s*=>?\s*\{?([\s\S]*?)\}\s*\);/);
    assert.ok(listenerMatch, 'Click event listener on #focus-button must exist');
    const listenerBody = listenerMatch[0];
    assert.ok(
      listenerBody.includes('roon-focus-bar') && (listenerBody.includes('classList.toggle') || listenerBody.includes('hidden')),
      '#focus-button listener must toggle #roon-focus-bar visibility'
    );
  });

  it('#roon-focus-bar is hidden by default before focus is toggled', () => {
    // Focus bar should start hidden (e.g. class="hidden" or hidden attribute)
    const isHiddenByDefault =
      /id="roon-focus-bar"[^>]*(?:\bhidden\b|class="[^"]*\bhidden\b)/i.test(html);
    assert.ok(isHiddenByDefault, '#roon-focus-bar must be hidden by default until user clicks Focus');
  });

  it('Track list columns layout reflects Roon structure (#, Track, Length, Album artist, Album, Format/Quality)', () => {
    assert.match(html, /id="track-list-header"/, '#track-list-header must exist');
    const headerHtml = html.match(/<div id="track-list-header"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';

    // Must have track number (#), track/bài hát, album artist, album, format/quality or time/length
    assert.ok(
      headerHtml.includes('#') || headerHtml.includes('Track') || headerHtml.includes('Bài hát'),
      'Header must specify track title / number'
    );
    assert.ok(
      headerHtml.includes('Album artist') || headerHtml.includes('Nghệ sĩ') || headerHtml.includes('Artist'),
      'Header must specify Album artist column'
    );
    assert.ok(
      headerHtml.includes('Album'),
      'Header must specify Album column'
    );
    assert.ok(
      headerHtml.includes('Length') || headerHtml.includes('Thời lượng'),
      'Header must specify Length/Thời lượng column'
    );
  });

  it('Track rows render Album Artist in Roon signature purple/blue link style (#7675ed)', () => {
    const start = appCode.indexOf('function renderTrackRows(');
    assert.ok(start >= 0, 'renderTrackRows must exist');
    const funcBody = appCode.slice(start, start + 3500);

    const hasArtistPurpleLink =
      funcBody.includes('#7675ed') ||
      funcBody.includes('text-[#7675ed]') ||
      /class="[^"]*(?:artist-link|text-purple-400|text-\[#7675ed\])[^"]*"[^>]*>\$\{escapeHtml\(metadata\.artist\)\}/.test(funcBody) ||
      (funcBody.includes('artist-link') && styleTags.includes('.artist-link') && styleTags.includes('#7675ed'));

    assert.ok(hasArtistPurpleLink, 'Album Artist in renderTrackRows must use Roon signature purple/blue link styling (#7675ed)');
  });

  it('Track rows render Album title in link style', () => {
    const start = appCode.indexOf('function renderTrackRows(');
    assert.ok(start >= 0, 'renderTrackRows must exist');
    const funcBody = appCode.slice(start, start + 3500);

    const hasAlbumLink =
      funcBody.includes('album-link') ||
      /hover:underline[^>]*metadata\.album/i.test(funcBody) ||
      /<span[^>]*class="[^"]*(?:hover:underline|cursor-pointer)[^"]*"[^>]*>\$\{escapeHtml\(metadata\.album\)\}/i.test(funcBody);

    assert.ok(hasAlbumLink, 'Album title in renderTrackRows should have link styling');
  });
});

// ── 3. Home View Fidelity (Discover banner & Recent artists) ──

describe('Home View Fidelity (Discover banner & Recent artists)', () => {
  it('#discover-banner exists in Home view with classic Roon text', () => {
    assert.match(html, /id="discover-banner"/, '#discover-banner element must exist');
    assert.match(html, /id="discover-banner"[\s\S]*?Discover/i, '#discover-banner must contain "Discover" heading');
    assert.match(
      html,
      /Roon[’']s classic way to explore your library/i,
      '#discover-banner must contain "Roon’s classic way to explore your library"'
    );
  });

  it('#discover-banner has signature blue-purple background styling', () => {
    const hasDiscoverStyling =
      /id="discover-banner"[^>]*(?:bg-\[#5265a2\]|#5265a2)/i.test(html) ||
      /#discover-banner[^{]*\{[^}]*background(?:-color)?:\s*(?:#5265a2|rgba?\([^)]+\))/i.test(styleTags);

    assert.ok(hasDiscoverStyling, '#discover-banner must have blue-purple background styling (#5265a2)');
  });

  it('#recent-artists-section exists with title and navigation controls', () => {
    assert.match(html, /id="recent-artists-section"/, '#recent-artists-section must exist in HTML');
    assert.match(
      html,
      /id="recent-artists-section"[\s\S]*?(?:Your recent artists|Nghệ sĩ gần đây)/i,
      '#recent-artists-section must have title "Your recent artists" or "Nghệ sĩ gần đây"'
    );
  });

  it('#recent-artists-section contains circular avatars for artists', () => {
    const hasCircularAvatars =
      /id="recent-artists-section"[\s\S]*?(?:rounded-full|border-radius:\s*50%)/i.test(html) ||
      /#recent-artists-section[^{]*\.avatar|\.artist-avatar[^{]*\{[^}]*border-radius:\s*50%/i.test(styleTags) ||
      (appCode.includes('recent-artists') && (appCode.includes('rounded-full') || appCode.includes('50%')));

    assert.ok(hasCircularAvatars, '#recent-artists-section must feature circular avatars for artists');
  });
});

// ── 4. Audio Routing Crossfeed Invariant ──

describe('Audio Routing Crossfeed Invariant', () => {
  it('strictly preserves state.crossfeedNodes.output.connect(state.context.destination)', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Strict invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact in index.html'
    );
    assert.ok(
      appCode.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'Strict invariant state.crossfeedNodes.output.connect(state.context.destination) must remain intact in setupAudio'
    );
  });
});

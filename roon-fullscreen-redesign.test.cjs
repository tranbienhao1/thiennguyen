const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

test('Roon Fullscreen Now Playing Redesign — Markup & Layout Structure', () => {
  // Container & Backdrop
  assert.ok(indexHtml.includes('id="roon-fullscreen-view"'), 'Container #roon-fullscreen-view exists');
  assert.ok(indexHtml.includes('id="fullscreen-bg-cover"'), 'Ambient cover blur backdrop exists');
  assert.ok(indexHtml.includes('id="fullscreen-ambient-glow"'), 'Ambient glow gradient layer exists');

  // Top Bar Controls
  assert.ok(indexHtml.includes('id="fullscreen-exit-btn"'), 'Close button (✕) exists');
  assert.ok(indexHtml.includes('id="fullscreen-settings-btn"'), 'Settings gear button (⚙) exists');

  // Center Stage (Album Art & Audio Spec)
  assert.ok(indexHtml.includes('id="fullscreen-cover-img"'), 'Album art image exists');
  assert.ok(indexHtml.includes('id="fullscreen-cover-empty"'), 'Fallback empty art exists');
  assert.ok(indexHtml.includes('id="fullscreen-format-detail"'), 'Audio format specification text (FLAC 44.1kHz 16bit 2ch) exists');

  // Bottom Dock Metadata & More
  assert.ok(indexHtml.includes('id="fullscreen-title"'), 'Track title element exists');
  assert.ok(indexHtml.includes('id="fullscreen-favorite-btn"'), 'Heart favorite toggle button exists');
  assert.ok(indexHtml.includes('id="fullscreen-album"'), 'Album name element exists');
  assert.ok(indexHtml.includes('id="fullscreen-performer"'), 'Performer credit line exists');
  assert.ok(indexHtml.includes('id="fullscreen-more-btn"'), 'More options (⋮) button exists');

  // Playback Controls
  assert.ok(indexHtml.includes('id="fullscreen-shuffle-btn"'), 'Shuffle button exists');
  assert.ok(indexHtml.includes('id="fullscreen-prev-btn"'), 'Previous track button exists');
  assert.ok(indexHtml.includes('id="fullscreen-play-btn"'), 'Play/pause button exists');
  assert.ok(indexHtml.includes('id="fullscreen-next-btn"'), 'Next track button exists');
  assert.ok(indexHtml.includes('id="fullscreen-queue-btn"'), 'Queue list icon button exists');

  // Waveform & Seekbar
  assert.ok(indexHtml.includes('id="fullscreen-waveform"'), 'Fullscreen waveform canvas exists');
  assert.ok(indexHtml.includes('id="fullscreen-time-cur"'), 'Current time indicator exists');
  assert.ok(indexHtml.includes('id="fullscreen-time-dur"'), 'Duration indicator exists');

  // Bottom Output & Volume Dock
  assert.ok(indexHtml.includes('id="fullscreen-collapse-btn"'), 'Collapse chevron down button exists');
  assert.ok(indexHtml.includes('id="fullscreen-zone-btn"'), 'Output zone selector button exists');
  assert.ok(indexHtml.includes('id="fullscreen-zone-name"'), 'Output zone name exists');
  assert.ok(indexHtml.includes('id="fullscreen-volume-btn"'), 'Volume button exists');
  assert.ok(indexHtml.includes('id="fullscreen-volume-readout"'), 'Volume percentage readout exists');
});

test('Roon Fullscreen Now Playing Redesign — Script Logic & Styling', () => {
  // Waveform red playhead styling matching the design
  assert.ok(indexHtml.includes("colorPlayhead: '#e11d48'"), 'Waveform canvas renders red/crimson playhead matching Roon design');

  // Event handlers
  assert.ok(indexHtml.includes('fsCollapseBtn.addEventListener'), 'Collapse button has click listener');
  assert.ok(indexHtml.includes('fsFavBtn.addEventListener'), 'Favorite button has click listener');
  assert.ok(indexHtml.includes('fsShuffleBtn.addEventListener'), 'Shuffle button has click listener');
  assert.ok(indexHtml.includes('fsQueueBtn.addEventListener'), 'Queue button has click listener');
  assert.ok(indexHtml.includes('fsZoneBtn.addEventListener'), 'Zone button has click listener');
  assert.ok(indexHtml.includes('fsVolBtn.addEventListener'), 'Volume button has click listener');

  // Audio Invariant
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'Web Audio destination routing is strictly preserved'
  );
});

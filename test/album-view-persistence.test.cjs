const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Album View Persistence: renderTracks preserves album scope and never bounces back to collection grid', () => {
  // 1. Check openAlbum and openArtist store currentCollectionEntry and do not call setLibraryView
  assert.ok(indexHtml.includes('state.currentCollectionEntry = entry;'), 'openAlbum and card click must store currentCollectionEntry');
  assert.ok(!indexHtml.includes("setLibraryView('albums');\n      const grid = $('collection-grid');"), 'openAlbum must not reset trackScope via setLibraryView');

  // 2. Check renderCollectionCards calculates showRows taking trackScope into account
  assert.match(
    indexHtml,
    /showRows = [^;]*Boolean\(state\.trackScope\)/,
    'renderCollectionCards must treat active trackScope as showRows'
  );

  // 3. Check renderTracks handles trackScope actively
  assert.ok(
    indexHtml.includes('if (state.activeView === \'history\' || Boolean(state.trackScope)) result.showRows = true;'),
    'renderTracks must keep result.showRows true when trackScope is active'
  );

  // 4. Check list-title and page-title preservation
  assert.ok(
    indexHtml.includes('if (state.trackScope && state.currentCollectionEntry)'),
    'renderTracks must preserve album title and hero when trackScope is active'
  );

  // 5. Back navigation cleanly resets scope
  assert.ok(
    indexHtml.includes('state.currentCollectionEntry = null;'),
    'Back buttons must reset currentCollectionEntry'
  );

  // 6. CRITICAL AUDIO INVARIANT
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});

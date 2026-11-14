const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, 'index.html');
const libPath = path.join(__dirname, 'library-utils.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const library = require(libPath);

test('Pha D — Offline Playback Resilience & Smart Autoplay Protection Suite', async (t) => {
  const localTrack1 = { id: 'local-1', name: 'Song 1', source: 'local' };
  const cloudTrack2 = { id: 'cloud-2', name: 'Song 2', source: 'google' }; // not cached
  const localTrack3 = { id: 'local-3', name: 'Song 3', file: {} }; // has file
  const cloudTrack4 = { id: 'cloud-4', name: 'Song 4', source: 'onedrive', firstSliceCached: true }; // cached slice
  const cloudTrack5 = { id: 'cloud-5', name: 'Song 5', source: 'google' }; // not cached

  const libraryPool = [localTrack1, cloudTrack2, localTrack3, cloudTrack4, cloudTrack5];

  await t.test('getOfflineTrackList filters accurately to playable tracks only', () => {
    assert.equal(typeof library.getOfflineTrackList, 'function', 'getOfflineTrackList must be exported');
    const offlineList = library.getOfflineTrackList(libraryPool);
    assert.equal(offlineList.length, 3, 'Should contain exactly 3 offline-capable tracks');
    assert.deepEqual(offlineList.map(t => t.id), ['local-1', 'local-3', 'cloud-4']);
    assert.deepEqual(library.getOfflineTrackList([]), []);
    assert.deepEqual(library.getOfflineTrackList(null), []);
  });

  await t.test('shouldPreloadTrack prevents useless offline background network requests', () => {
    assert.equal(typeof library.shouldPreloadTrack, 'function', 'shouldPreloadTrack must be exported');
    assert.equal(library.shouldPreloadTrack(localTrack1, { isOffline: true }), true);
    assert.equal(library.shouldPreloadTrack(cloudTrack2, { isOffline: true }), false, 'Uncached cloud track must not preload offline');
    assert.equal(library.shouldPreloadTrack(cloudTrack4, { isOffline: true }), true, 'Cached slice track can preload offline');
    assert.equal(library.shouldPreloadTrack(cloudTrack2, { isOffline: false }), true, 'Cloud track can preload when online');
    assert.equal(library.shouldPreloadTrack(null), false);
  });

  await t.test('getNextPlayableTrack advances sequentially when online', () => {
    assert.equal(typeof library.getNextPlayableTrack, 'function', 'getNextPlayableTrack must be exported');

    // From local-1 (0) to cloud-2 (1)
    const res1 = library.getNextPlayableTrack(libraryPool, 0, 1, { isOffline: false });
    assert.equal(res1.track.id, 'cloud-2');
    assert.equal(res1.index, 1);
    assert.equal(res1.wasFiltered, false);

    // End of list (repeat = 0)
    const resEnd = library.getNextPlayableTrack(libraryPool, 4, 1, { isOffline: false, repeat: 0 });
    assert.equal(resEnd.track, null);
    assert.equal(resEnd.index, -1);

    // End of list with repeat = 1 (wrap to start)
    const resWrap = library.getNextPlayableTrack(libraryPool, 4, 1, { isOffline: false, repeat: 1 });
    assert.equal(resWrap.track.id, 'local-1');
    assert.equal(resWrap.index, 0);

    // Backward step
    const resBack = library.getNextPlayableTrack(libraryPool, 2, -1, { isOffline: false });
    assert.equal(resBack.track.id, 'cloud-2');
    assert.equal(resBack.index, 1);
  });

  await t.test('getNextPlayableTrack skips unplayable tracks seamlessly when offline', () => {
    // Current is local-1 (idx 0). Next in list is cloud-2 (uncached).
    // In offline mode, it must jump straight over cloud-2 to local-3 (idx 2)!
    const resSkip = library.getNextPlayableTrack(libraryPool, 0, 1, { isOffline: true });
    assert.equal(resSkip.track.id, 'local-3');
    assert.equal(resSkip.index, 2);
    assert.equal(resSkip.wasFiltered, true);

    // From local-3 (idx 2), next offline track is cloud-4 (idx 3)
    const resNextOffline = library.getNextPlayableTrack(libraryPool, 2, 1, { isOffline: true });
    assert.equal(resNextOffline.track.id, 'cloud-4');
    assert.equal(resNextOffline.index, 3);

    // From cloud-4 (idx 3), next track in library is cloud-5 (uncached).
    // With repeat = 1, it wraps around to local-1 (idx 0)
    const resWrapOffline = library.getNextPlayableTrack(libraryPool, 3, 1, { isOffline: true, repeat: 1 });
    assert.equal(resWrapOffline.track.id, 'local-1');
    assert.equal(resWrapOffline.index, 0);
    assert.equal(resWrapOffline.wasFiltered, true);

    // If current was an uncached cloud track (e.g. playing when network dropped),
    // next step should find the next available offline track
    const resFromUncached = library.getNextPlayableTrack(libraryPool, 1, 1, { isOffline: true });
    assert.equal(resFromUncached.track.id, 'local-3');
    assert.equal(resFromUncached.index, 2);

    // All-cloud uncached pool returns null in offline mode
    const allOnlinePool = [cloudTrack2, cloudTrack5];
    const resEmpty = library.getNextPlayableTrack(allOnlinePool, 0, 1, { isOffline: true });
    assert.equal(resEmpty.track, null);
    assert.equal(resEmpty.index, -1);
    assert.equal(resEmpty.wasFiltered, true);
  });

  await t.test('selectRoonRadioTrack honors isOffline flag', () => {
    // Pool where only local-3 and cloud-4 are offline
    const pool = [localTrack1, cloudTrack2, localTrack3];
    // Asking for radio recommendation with isOffline = true when current is local-1
    const radio = library.selectRoonRadioTrack(localTrack1, pool, { isOffline: true });
    assert.ok(radio && radio.track, 'Should find an offline candidate');
    assert.equal(radio.track.id, 'local-3', 'Must only pick offline-ready candidate');

    // If only uncached cloud candidates remain, should return null rather than unplayable track
    const onlyCloudPool = [localTrack1, cloudTrack2];
    const radioCloud = library.selectRoonRadioTrack(localTrack1, onlyCloudPool, { isOffline: true });
    assert.equal(radioCloud, null, 'Must return null when no candidates can play offline');
  });

  await t.test('index.html DOM & Script wiring for offline resilience', () => {
    assert.ok(html.includes('getNextPlayableTrack'), 'playNext and queueIndex should use getNextPlayableTrack');
    assert.ok(html.includes('canPlayOffline'), 'preloadNext should check canPlayOffline before preloading');
    assert.ok(html.includes("el.style.top = hasBanner ? '3.75rem' : ''"), 'Toast must dynamically offset when offline banner is displayed');
  });

  await t.test('Web Audio Graph Routing Invariant is preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'The sacred Web Audio Graph routing invariant must never be modified'
    );
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, 'index.html');
const libPath = path.join(__dirname, 'library-utils.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const library = require(libPath);

test('Pha C — Queue Drag & Drop Reordering, Mini Player HUD & Top-Center Toast Suite', async (t) => {
  await t.test('reorderQueueByIds pure function behaves deterministically', () => {
    assert.equal(typeof library.reorderQueueByIds, 'function', 'reorderQueueByIds must be exported');

    const initial = ['track-1', 'track-2', 'track-3', 'track-4', 'track-5'];

    // Move track-1 before track-4 -> ['track-2', 'track-3', 'track-1', 'track-4', 'track-5']
    const moveBefore = library.reorderQueueByIds(initial, 'track-1', 'track-4', 'before');
    assert.deepEqual(moveBefore, ['track-2', 'track-3', 'track-1', 'track-4', 'track-5']);

    // Move track-1 after track-4 -> ['track-2', 'track-3', 'track-4', 'track-1', 'track-5']
    const moveAfter = library.reorderQueueByIds(initial, 'track-1', 'track-4', 'after');
    assert.deepEqual(moveAfter, ['track-2', 'track-3', 'track-4', 'track-1', 'track-5']);

    // Move track-5 before track-2 -> ['track-1', 'track-5', 'track-2', 'track-3', 'track-4']
    const moveUp = library.reorderQueueByIds(initial, 'track-5', 'track-2', 'before');
    assert.deepEqual(moveUp, ['track-1', 'track-5', 'track-2', 'track-3', 'track-4']);

    // Move track-5 after track-2 -> ['track-1', 'track-2', 'track-5', 'track-3', 'track-4']
    const moveUpAfter = library.reorderQueueByIds(initial, 'track-5', 'track-2', 'after');
    assert.deepEqual(moveUpAfter, ['track-1', 'track-2', 'track-5', 'track-3', 'track-4']);

    // No-op cases: invalid or missing ID returns identical elements
    const invalidId = library.reorderQueueByIds(initial, 'track-999', 'track-2');
    assert.deepEqual(invalidId, initial);

    const sameId = library.reorderQueueByIds(initial, 'track-2', 'track-2');
    assert.deepEqual(sameId, initial);

    // Non-array input
    assert.deepEqual(library.reorderQueueByIds(null, 'a', 'b'), []);
  });

  await t.test('HTML markup contains draggable queue rows and visual grip handle', () => {
    assert.ok(html.includes('draggable="true"'), 'Queue rows must declare draggable="true"');
    assert.ok(html.includes('queue-drag-handle'), 'Queue rows must have a queue-drag-handle class');
    assert.ok(html.includes('⠿'), 'Queue rows must display audiophile drag grip symbol ⠿');
    assert.ok(html.includes('data-queue-row='), 'data-queue-row attribute must exist for row targeting');
  });

  await t.test('Drag and Drop events are bound with visual drop indicators', () => {
    assert.ok(html.includes("addEventListener('dragstart'"), 'dragstart event listener must be registered');
    assert.ok(html.includes("addEventListener('dragover'"), 'dragover event listener must be registered');
    assert.ok(html.includes("addEventListener('dragleave'"), 'dragleave event listener must be registered');
    assert.ok(html.includes("addEventListener('drop'"), 'drop event listener must be registered');
    assert.ok(html.includes("addEventListener('dragend'"), 'dragend event listener must be registered');

    // Visual drop line classes
    assert.ok(html.includes('queue-drag-over-top'), 'CSS must define top drop indicator');
    assert.ok(html.includes('queue-drag-over-bottom'), 'CSS must define bottom drop indicator');
  });

  await t.test('Mini Player HUD canvas constraints & reset mechanism', () => {
    assert.ok(html.includes('#mini-player-hud canvas { width:72px !important; height:26px !important; max-width:72px !important; }'),
      'CSS must enforce explicit width and height on #mini-player-hud canvas');
    assert.ok(html.includes("hudContainer.addEventListener('dblclick'"),
      'Mini Player HUD must have a double-click event listener to reset position');
  });

  await t.test('Toast notification is elevated to Top-Center HUD avoiding layout overlap', () => {
    assert.ok(html.includes('id="toast" class="pointer-events-none fixed top-6 sm:top-8 left-1/2 z-[120]'),
      'Toast must be located at top-6 sm:top-8 to never collide with waveform, lyrics or bottom dock');
  });

  await t.test('Web Audio Graph Routing Invariant is preserved', () => {
    assert.ok(
      html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'The sacred Audio Graph routing invariant must never be altered'
    );
  });
});

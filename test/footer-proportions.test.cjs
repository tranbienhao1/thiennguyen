const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Footer Player Dock Layout & Proportions (Tỷ lệ chuẩn mực Roon Audiophile)', async (t) => {
  await t.test('1. Three-column balanced structure: Left 26%, Center flex-1 (max 620px), Right 26%', () => {
    assert.ok(indexHtml.includes('footer-left-col'), 'Left column must have class footer-left-col');
    assert.ok(indexHtml.includes('footer-center-controls'), 'Center column must have class footer-center-controls');
    assert.ok(indexHtml.includes('footer-right-tools'), 'Right column must have class footer-right-tools');

    // Check CSS proportional definitions
    assert.match(indexHtml, /\.footer-left-col\s*\{[^}]*width:\s*26%/i, 'Left column must be allocated 26% width');
    assert.match(indexHtml, /\.footer-right-tools\s*\{[^}]*width:\s*26%/i, 'Right column must be allocated 26% width');
    assert.match(indexHtml, /\.footer-center-controls\s*\{[^}]*max-width:\s*640px/i, 'Center column must be max 640px and centered');
  });

  await t.test('2. Center controls & seekbar are cleanly aligned with no overlapping telemetry', () => {
    const centerMatch = indexHtml.match(/<div class="footer-center-controls[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(centerMatch, 'Center controls container must exist');
    const centerHtml = centerMatch[0];

    // Transport buttons exist
    assert.ok(centerHtml.includes('id="play-button"'), 'Center must contain play button');
    assert.ok(centerHtml.includes('id="previous-button"'), 'Center must contain prev button');
    assert.ok(centerHtml.includes('id="next-button"'), 'Center must contain next button');
    assert.ok(centerHtml.includes('id="shuffle-button"'), 'Center must contain shuffle button');
    assert.ok(centerHtml.includes('id="repeat-button"'), 'Center must contain repeat button');

    // Seekbar elements exist in center
    assert.ok(centerHtml.includes('id="current-time"'), 'Center must contain current time readout');
    assert.ok(centerHtml.includes('id="seek"'), 'Center must contain seek slider');
    assert.ok(centerHtml.includes('id="duration"'), 'Center must contain duration readout');

    // No telemetry badges or visualizers contaminating center controls
    assert.ok(!centerHtml.includes('id="visualizer"'), 'Center MUST NOT contain visualizer canvas');
    assert.ok(!centerHtml.includes('id="level-readout"'), 'Center MUST NOT contain level-readout');
    assert.ok(!centerHtml.includes('id="quality-badge"'), 'Center MUST NOT contain quality-badge');
    assert.ok(!centerHtml.includes('id="eq-button"'), 'Center MUST NOT contain eq-button');
  });

  await t.test('3. Right column tools are right-aligned and capped to prevent overcrowding center', () => {
    const rightMatch = indexHtml.match(/<div class="footer-right-tools[\s\S]*?<\/div>/);
    assert.ok(rightMatch, 'Right column container must exist');
    const rightHtml = rightMatch[0];

    assert.ok(rightHtml.includes('id="quality-badge"'), 'Right must contain quality badge');
    assert.ok(rightHtml.includes('id="eq-button"'), 'Right must contain EQ button');
    assert.ok(rightHtml.includes('id="queue-button"'), 'Right must contain queue button');
    assert.ok(rightHtml.includes('id="volume"'), 'Right must contain volume slider');
    assert.ok(rightHtml.includes('justify-end'), 'Right column must be right-aligned with justify-end');
  });

  await t.test('4. Web Audio Graph Invariant Check', () => {
    assert.ok(
      indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
      'CRITICAL AUDIO INVARIANT: state.crossfeedNodes.output must connect directly to state.context.destination'
    );
  });
});

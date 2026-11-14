const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('Footer Telemetry Relocation: #footer-telemetry-strip exists and is separate from player controls', () => {
  // 1. #footer-telemetry-strip exists
  assert.ok(indexHtml.includes('id="footer-telemetry-strip"'), '#footer-telemetry-strip must exist');

  // 2. All 5 telemetry elements exist inside index.html and have required attributes
  assert.ok(indexHtml.includes('id="visualizer"'), '#visualizer must exist');
  assert.match(indexHtml, /<canvas id="visualizer"[^>]*cursor-pointer/, '#visualizer canvas must have cursor-pointer');
  assert.match(indexHtml, /<canvas id="visualizer"[^>]*title="[^"]*Spectrum FFT/, '#visualizer canvas must have title tooltip');
  assert.ok(indexHtml.includes('id="level-readout"'), '#level-readout must exist');
  assert.ok(indexHtml.includes('id="footer-dr-badge"'), '#footer-dr-badge must exist');
  assert.ok(indexHtml.includes('id="footer-phase-badge"'), '#footer-phase-badge must exist');
  assert.ok(indexHtml.includes('id="footer-tp-badge"'), '#footer-tp-badge must exist');

  // 3. Center controls are clean and isolated in .footer-center-controls
  assert.ok(indexHtml.includes('class="footer-center-controls'), '.footer-center-controls must exist');
  const centerMatch = indexHtml.match(/<div class="footer-center-controls[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(centerMatch, 'Center controls block must be extractable');
  const centerHtml = centerMatch[0];
  assert.ok(centerHtml.includes('id="play-button"'), 'Center must contain #play-button');
  assert.ok(centerHtml.includes('id="previous-button"'), 'Center must contain #previous-button');
  assert.ok(centerHtml.includes('id="next-button"'), 'Center must contain #next-button');
  assert.ok(centerHtml.includes('id="shuffle-button"'), 'Center must contain #shuffle-button');
  assert.ok(centerHtml.includes('id="repeat-button"'), 'Center must contain #repeat-button');
  assert.ok(!centerHtml.includes('id="visualizer"'), 'Center MUST NOT contain #visualizer');
  assert.ok(!centerHtml.includes('id="level-readout"'), 'Center MUST NOT contain #level-readout');
  assert.ok(!centerHtml.includes('id="footer-dr-badge"'), 'Center MUST NOT contain #footer-dr-badge');

  // 4. Toggle & Close controls
  assert.ok(indexHtml.includes('id="footer-telemetry-close"'), 'Close button must exist for telemetry strip');
  assert.ok(indexHtml.includes('nocturne-hide-telemetry-strip'), 'Script must persist strip state in localStorage');

  // 5. CSS ensures idle footer hides telemetry strip
  assert.ok(indexHtml.includes('footer.player-idle #footer-telemetry-strip{display:none!important}'), 'Idle footer must hide telemetry strip');

  // 6. CRITICAL AUDIO INVARIANT
  assert.ok(
    indexHtml.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});

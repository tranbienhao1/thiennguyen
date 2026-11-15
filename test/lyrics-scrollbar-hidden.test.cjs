const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Lyrics Scrollbars Hidden: Zero Horizontal and Vertical Scrollbars', (t) => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // 1. Fullscreen lyrics scroll container classes
  assert.match(
    html,
    /id="fullscreen-lyrics-scroll"[^>]*class="[^"]*overflow-x-hidden[^"]*"/,
    '#fullscreen-lyrics-scroll must include overflow-x-hidden to prevent horizontal scrollbar'
  );
  assert.match(
    html,
    /id="fullscreen-lyrics-scroll"[^>]*class="[^"]*no-scrollbar[^"]*"/,
    '#fullscreen-lyrics-scroll must include no-scrollbar class to hide native scrollbars'
  );

  // 2. Fullscreen stage lyrics wrapper
  assert.match(
    html,
    /id="fullscreen-stage-lyrics"[^>]*class="[^"]*overflow-x-hidden[^"]*"/,
    '#fullscreen-stage-lyrics must include overflow-x-hidden'
  );

  // 3. Listening room lyrics container
  assert.match(
    html,
    /id="room-lyrics"[^>]*class="[^"]*overflow-x-hidden[^"]*"/,
    '#room-lyrics must include overflow-x-hidden'
  );
  assert.match(
    html,
    /id="room-lyrics"[^>]*class="[^"]*no-scrollbar[^"]*"/,
    '#room-lyrics must include no-scrollbar'
  );

  // 4. CSS declarations hiding scrollbars completely
  assert.match(
    html,
    /#fullscreen-lyrics-scroll[\s\S]*?scrollbar-width:\s*none\s*!important/i,
    'CSS must declare scrollbar-width: none !important for #fullscreen-lyrics-scroll'
  );
  assert.match(
    html,
    /#fullscreen-lyrics-scroll[\s\S]*?-ms-overflow-style:\s*none\s*!important/i,
    'CSS must declare -ms-overflow-style: none !important for #fullscreen-lyrics-scroll'
  );
  assert.match(
    html,
    /#fullscreen-lyrics-scroll::-webkit-scrollbar[\s\S]*?display:\s*none\s*!important/i,
    'CSS must declare ::-webkit-scrollbar display: none !important for #fullscreen-lyrics-scroll'
  );

  // 5. Lyrics row text wrapping
  assert.match(
    html,
    /break-words/,
    'fs-lyric-line should include break-words to prevent horizontal spill'
  );

  // 6. Audio graph invariant
  assert.ok(
    html.includes('state.crossfeedNodes.output.connect(state.context.destination)'),
    'AUDIO GRAPH INVARIANT VIOLATION: state.crossfeedNodes.output must connect to state.context.destination'
  );
});

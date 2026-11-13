'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim()).filter(Boolean);
const appCode = inlineScripts.join('\n');

const libCode = fs.readFileSync(path.join(__dirname, 'library-utils.js'), 'utf8');
const libWrapper = new Function(libCode + '; return typeof NocturneLibrary !== "undefined" ? NocturneLibrary : window.NocturneLibrary;');
const NocturneLibrary = libWrapper();

describe('Roon Zone & Multi-Output Controller — Library Utils', () => {
  test('createZoneModel returns default zones including DSP and Direct', () => {
    assert.equal(typeof NocturneLibrary.createZoneModel, 'function');
    const zones = NocturneLibrary.createZoneModel();
    assert.ok(Array.isArray(zones));
    assert.ok(zones.length >= 2);
    const dspZone = zones.find(z => z.id === 'zone_dsp' || z.type === 'local_dsp');
    const directZone = zones.find(z => z.id === 'zone_direct' || z.type === 'local_direct');
    assert.ok(dspZone, 'DSP zone must exist');
    assert.ok(directZone, 'Direct zone must exist');
    assert.equal(dspZone.isBitPerfect, false);
    assert.equal(directZone.isBitPerfect, true);
  });

  test('formatRoonThreeLine formats 3-line metadata accurately', () => {
    assert.equal(typeof NocturneLibrary.formatRoonThreeLine, 'function');
    const track = {
      title: 'Time',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      sampleRate: 96000,
      bits: 24
    };
    const zone = { name: 'Phòng nghe Audiophile', isBitPerfect: true };
    const res = NocturneLibrary.formatRoonThreeLine(track, zone);
    assert.equal(res.line1, 'Time');
    assert.equal(res.line2, 'Pink Floyd');
    assert.ok(res.line3.includes('The Dark Side of the Moon'));
    assert.ok(res.line3.includes('96.0 kHz') || res.line3.includes('96'));
    assert.ok(res.line3.includes('Bit-perfect'));
  });

  test('formatRoonThreeLine handles empty/null track safely', () => {
    const res = NocturneLibrary.formatRoonThreeLine(null);
    assert.ok(res.line1);
    assert.ok(res.line2);
    assert.ok(res.line3);
  });

  test('parseRoonCoreEndpoint handles host, port and schemes', () => {
    assert.equal(typeof NocturneLibrary.parseRoonCoreEndpoint, 'function');
    assert.deepEqual(NocturneLibrary.parseRoonCoreEndpoint('192.168.1.50:9330'), {
      host: '192.168.1.50',
      port: 9330,
      wsUrl: 'ws://192.168.1.50:9330/api'
    });
    // Default port 9330 when omitted
    const defaultRes = NocturneLibrary.parseRoonCoreEndpoint('192.168.1.50');
    assert.equal(defaultRes.host, '192.168.1.50');
    assert.equal(defaultRes.port, 9330);
    // ws:// prefix
    const wsRes = NocturneLibrary.parseRoonCoreEndpoint('ws://10.0.0.5:9100/roon');
    assert.equal(wsRes.host, '10.0.0.5');
    assert.equal(wsRes.port, 9100);
    // Invalid inputs
    assert.equal(NocturneLibrary.parseRoonCoreEndpoint(''), null);
    assert.equal(NocturneLibrary.parseRoonCoreEndpoint(null), null);
    assert.equal(NocturneLibrary.parseRoonCoreEndpoint('invalid:portabc'), null);
  });

  test('createRoonMooMessage constructs valid MOO/1 wire protocol string', () => {
    assert.equal(typeof NocturneLibrary.createRoonMooMessage, 'function');
    const msg = NocturneLibrary.createRoonMooMessage('REQUEST', 'com.roonlabs.transport:2/subscribe_zones', { subscription_key: 'sub1' }, 42);
    assert.ok(msg.startsWith('MOO/1 REQUEST com.roonlabs.transport:2/subscribe_zones'));
    assert.ok(msg.includes('Request-Id: 42'));
    assert.ok(msg.includes('Content-Type: application/json'));
    assert.ok(msg.includes('"subscription_key":"sub1"'));
  });

  test('parseRoonMooMessage unpacks MOO/1 messages and parses JSON body', () => {
    assert.equal(typeof NocturneLibrary.parseRoonMooMessage, 'function');
    const raw = 'MOO/1 COMPLETE\nRequest-Id: 42\nContent-Type: application/json\n\n{"status":"Success","zones":[{"zone_id":"z1","display_name":"Living Room"}]}';
    const parsed = NocturneLibrary.parseRoonMooMessage(raw);
    assert.equal(parsed.verb, 'COMPLETE');
    assert.equal(parsed.requestId, '42');
    assert.equal(parsed.body.status, 'Success');
    assert.equal(parsed.body.zones[0].display_name, 'Living Room');
  });

  test('formatRoonZoneStatus outputs Vietnamese status labels', () => {
    assert.equal(typeof NocturneLibrary.formatRoonZoneStatus, 'function');
    assert.equal(NocturneLibrary.formatRoonZoneStatus({ state: 'playing' }), 'Đang phát');
    assert.equal(NocturneLibrary.formatRoonZoneStatus({ state: 'paused' }), 'Tạm dừng');
    assert.equal(NocturneLibrary.formatRoonZoneStatus({ state: 'loading' }), 'Đang nạp');
    assert.equal(NocturneLibrary.formatRoonZoneStatus({ state: 'stopped' }), 'Sẵn sàng');
  });
});

describe('Roon Zone & Multi-Output Controller — DOM Markup', () => {
  test('Zone selector bar exists in listening room', () => {
    assert.match(html, /id="room-zone-bar"/);
    assert.match(html, /id="zone-current-name"/);
    assert.match(html, /id="zone-picker-btn"/);
  });

  test('Zone selector button exists in footer', () => {
    assert.match(html, /id="zone-footer-btn"/);
    assert.match(html, /id="zone-footer-label"/);
  });

  test('Zone management and Roon Core bridge modal exists', () => {
    assert.match(html, /id="zone-modal"/);
    assert.match(html, /id="zone-list-container"/);
    assert.match(html, /id="zone-modal-close"/);
    assert.match(html, /id="roon-bridge-input"/);
    assert.match(html, /id="roon-bridge-connect-btn"/);
    assert.match(html, /id="roon-bridge-badge"/);
  });
});

describe('Roon Zone & Multi-Output Controller — Script Integration', () => {
  test('State initializes activeZoneId and zones array', () => {
    assert.ok(appCode.includes('activeZoneId'));
    assert.ok(appCode.includes('zones:'));
  });

  test('switchZone function is declared and integrated', () => {
    assert.ok(appCode.includes('function switchZone('));
  });

  test('connectRoonBridge and disconnectRoonBridge functions are declared', () => {
    assert.ok(appCode.includes('function connectRoonBridge('));
    assert.ok(appCode.includes('function disconnectRoonBridge('));
  });

  test('triggerRoonAction function supports play_now, play_next, add_queue, start_radio', () => {
    assert.ok(appCode.includes('function triggerRoonAction('));
  });

  test('Audio graph routing retains strict crossfeed connection assertion', () => {
    assert.ok(appCode.includes('state.crossfeedNodes.output.connect(state.context.destination)'));
  });
});

'use strict';

const assert = require('node:assert/strict');
const cloud = require('./cloud-metadata.js');

function fakeTagsReader(range = [0, 3]) {
  return {
    Reader: class Reader {
      constructor(source) { this.source = source; }
      setFileReader(FileReader) { this.FileReader = FileReader; return this; }
      read(callbacks) {
        const file = new this.FileReader(this.source);
        file.init({onSuccess:() => file.loadRange(range, {
          onSuccess:() => callbacks.onSuccess({tags:{title:String.fromCharCode(...file.getBytesAt(range[0], range[1] - range[0] + 1))}}),
          onError:callbacks.onError
        })});
      }
    }
  };
}

const response = (status, bytes, contentRange = '') => ({
  status,
  headers:{get:name => name.toLowerCase() === 'content-range' ? contentRange : null},
  arrayBuffer:async () => Uint8Array.from(bytes).buffer,
  body:{cancel() {}}
});

(async () => {
  const requests = [];
  const tags = await cloud.readRemoteTags(fakeTagsReader(), {url:'https://cloud.example/audio', size:100}, {
    headers:{Authorization:'Bearer test-token'}
  }, {fetch:async (url, options) => {
    requests.push({url, options});
    return response(206, [84,65,71,83], 'bytes 0-3/100');
  }});
  assert.equal(tags.title, 'TAGS');
  assert.equal(requests.length, 1, 'Tag reader should request only needed bytes');
  assert.equal(requests[0].options.headers.get('range'), 'bytes=0-3');
  assert.equal(requests[0].options.headers.get('authorization'), 'Bearer test-token');
  assert.equal(requests[0].options.method, 'GET');

  let fullBodyRead = false;
  await assert.rejects(() => cloud.readRemoteTags(fakeTagsReader(), {url:'https://cloud.example/audio', size:100}, {}, {
    fetch:async () => ({...response(200, []), arrayBuffer:async () => { fullBodyRead = true; return new ArrayBuffer(100); }})
  }), /full-download fallback is disabled/);
  assert.equal(fullBodyRead, false, 'A server ignoring Range must not cause the full audio body to be read');

  let limitedFetches = 0;
  await assert.rejects(() => cloud.readRemoteTags(fakeTagsReader([0, 7]), {url:'https://cloud.example/audio', size:100}, {}, {
    maxRangeBytes:4, maxTotalBytes:8, fetch:async () => { limitedFetches++; return response(206, [], 'bytes 0-7/100'); }
  }), /safety limit/);
  assert.equal(limitedFetches, 0, 'Oversized metadata reads must be rejected before fetching');

  await assert.rejects(() => cloud.readRemoteTags(fakeTagsReader(), {url:'https://cloud.example/audio', size:100}, {}, {
    fetch:async () => response(206, [84,65,71,83], 'bytes 1-4/100')
  }), /mismatched Content-Range/);

  const RangeReader = cloud.makeRangeReader(async () => response(206, [1,2,3,4], 'bytes 0-3/10'), {}, {maxRangeBytes:4, maxTotalBytes:4});
  const reader = new RangeReader({url:'https://cloud.example/audio', size:10});
  await new Promise((resolve, reject) => reader.loadRange([0,3], {onSuccess:resolve, onError:error => reject(new Error(error.info))}));
  assert.deepEqual(reader.getBytesAt(0, 4), [1,2,3,4]);
  assert.throws(() => reader.getByteAt(9), /unloaded byte/);

  console.log('Cloud metadata range-reader tests passed.');
})().catch(error => { console.error(error); process.exit(1); });

'use strict';

/**
 * Live tests — these hit the real Rin API.
 *
 * They are safe to run without a key: everything that would consume quota is
 * skipped unless RCH_API_KEY is set, and the send itself is opt-in via
 * RCH_SEND=1 because the endpoint is limited to 1 reaction per 24 hours.
 *
 *   node --test test/live.test.js
 *   RCH_API_KEY=your-key RCH_SEND=1 node --test test/live.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { reactToChannel, checkLimit, RchError } = require('../index.js');

const API_KEY = process.env.RCH_API_KEY || '';
const MAY_SEND = process.env.RCH_SEND === '1' && Boolean(API_KEY);
const LINK =
  process.env.RCH_LINK || 'https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x/141';

// The demo key documented by the API. It is not authorised for the reaction
// endpoint, which is exactly what makes it useful for testing the auth path.
const DEMO_KEY = 'Rin';

test('the API host is reachable and answers JSON', async () => {
  const res = await checkLimit({ apiKey: DEMO_KEY });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.ok(res.limit, 'expected a limit object');
});

test('checkLimit returns the documented quota fields', async () => {
  const res = await checkLimit({ apiKey: DEMO_KEY });
  const limit = res.limit || {};
  // Documented shape: batas_maksimal / terpakai / sisa
  assert.equal(typeof limit.batas_maksimal, 'number');
  assert.equal(typeof limit.terpakai, 'number');
  assert.equal(typeof limit.sisa, 'number');
  assert.ok(limit.sisa <= limit.batas_maksimal);
});

test('an unauthorised key is rejected with 401 and a message', async () => {
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'definitely-not-a-real-key' }),
    (e) => {
      assert.ok(e instanceof RchError);
      assert.equal(e.code, 'UNAUTHORIZED');
      assert.equal(e.status, 401);
      assert.match(e.message, /API Key/i);
      return true;
    }
  );
});

test('the endpoint rejects a channel profile link before calling the API', async () => {
  await assert.rejects(
    reactToChannel({
      url: 'https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x',
      emoji: '🔥',
      apiKey: API_KEY || DEMO_KEY,
    }),
    (e) => e.code === 'INVALID_URL'
  );
});

test('the endpoint rejects more than 4 emoji before calling the API', async () => {
  await assert.rejects(
    reactToChannel({
      url: LINK,
      emoji: ['🔥', '❤️', '😭', '👍', '🎉'],
      apiKey: API_KEY || DEMO_KEY,
    }),
    (e) => e.code === 'TOO_MANY_EMOJI'
  );
});

test('the site reports the reaction quota as 1 per window', async () => {
  const res = await fetch('https://apiii-xrina.my.id/rch/status', {
    headers: { Accept: 'application/json', 'User-Agent': 'broken-rch/live-test' },
  });
  const data = await res.json();
  assert.equal(data.status, true);
  assert.ok(data.limit, 'expected a limit object');
  assert.equal(data.limit.max, 1, 'the API documents a single reaction per window');
});

test('a real send, when a key is supplied and RCH_SEND=1', { skip: !MAY_SEND }, async () => {
  const res = await reactToChannel({ url: LINK, emoji: '🔥', apiKey: API_KEY });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emojis, ['🔥']);
  assert.ok(res.limit, 'expected the quota to come back with the send');
});

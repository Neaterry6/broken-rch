'use strict';

/**
 * Offline tests. Every network call is stubbed, so these run with no API key
 * and no internet. The live suite lives in live.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reactToChannel,
  checkLimit,
  parseChannelLink,
  splitEmoji,
  RchError,
  MAX_EMOJI,
} = require('../index.js');

const LINK = 'https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x/141';

/** Build a stub fetch that records the URL it was called with. */
function stub(body, init) {
  const opts = init || {};
  const calls = [];
  const fn = async (url, req) => {
    calls.push({ url: String(url), req: req || {} });
    if (opts.throws) throw opts.throws;
    const status = opts.status === undefined ? 200 : opts.status;
    const text =
      typeof body === 'string' ? body : JSON.stringify(body === undefined ? {} : body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    };
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------- parseChannelLink

test('parseChannelLink extracts channel and message ids', () => {
  const p = parseChannelLink(LINK);
  assert.equal(p.channelId, '0029Vb6EHtR5Ui2gHMW9zX2x');
  assert.equal(p.messageId, '141');
  assert.equal(p.url, LINK);
});

test('parseChannelLink tolerates www, http and a trailing slash', () => {
  assert.equal(parseChannelLink('http://www.whatsapp.com/channel/abc/7').messageId, '7');
  assert.equal(parseChannelLink(LINK + '/').messageId, '141');
});

test('parseChannelLink rejects a channel profile link (no message number)', () => {
  assert.throws(() => parseChannelLink('https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x'), (e) => {
    assert.ok(e instanceof RchError);
    assert.equal(e.code, 'INVALID_URL');
    return true;
  });
});

test('parseChannelLink rejects empty and non-whatsapp links', () => {
  for (const bad of ['', '   ', 'https://example.com/channel/a/1', 'not a url']) {
    assert.throws(() => parseChannelLink(bad), (e) => e.code === 'INVALID_URL');
  }
});

// --------------------------------------------------------------------- splitEmoji

test('splitEmoji handles arrays, commas and bare strings', () => {
  assert.deepEqual(splitEmoji(['🔥', '❤️']), ['🔥', '❤️']);
  assert.deepEqual(splitEmoji('🔥,❤️'), ['🔥', '❤️']);
  assert.deepEqual(splitEmoji('🔥 ❤️'), ['🔥', '❤️']);
  assert.deepEqual(splitEmoji(''), []);
  assert.deepEqual(splitEmoji(undefined), []);
});

test('splitEmoji is grapheme-aware so a variation selector is not its own emoji', () => {
  // ❤️ is U+2764 U+FE0F. A naive code-point split would report two.
  assert.equal(splitEmoji('❤️').length, 1);
  assert.equal(splitEmoji('👍🏽').length, 1, 'skin tone modifier should not split');
});

// --------------------------------------------------------------- reactToChannel

test('reactToChannel sends url, reaction and apikey and returns a result', async () => {
  const f = stub({ status: true, message: 'Berhasil mengirim react ke pesan channel' });
  const res = await reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'key-1', fetchImpl: f });

  assert.equal(res.ok, true);
  assert.equal(res.channelId, '0029Vb6EHtR5Ui2gHMW9zX2x');
  assert.equal(res.messageId, '141');
  assert.deepEqual(res.emojis, ['🔥']);
  assert.match(res.message, /Berhasil/);

  const called = new URL(f.calls[0].url);
  assert.equal(called.pathname, '/tools/rch');
  assert.equal(called.searchParams.get('reaction'), '🔥');
  assert.equal(called.searchParams.get('apikey'), 'key-1');
  assert.equal(called.searchParams.get('url'), LINK);
});

test('reactToChannel joins multiple emoji with commas and caps at MAX_EMOJI', async () => {
  const f = stub({ status: true });
  await reactToChannel({ url: LINK, emoji: ['🔥', '❤️', '😭'], apiKey: 'k', fetchImpl: f });
  const called = new URL(f.calls[0].url);
  assert.equal(called.searchParams.get('reaction'), '🔥,❤️,😭');

  await assert.rejects(
    reactToChannel({
      url: LINK,
      emoji: ['1', '2', '3', '4', '5'],
      apiKey: 'k',
      fetchImpl: stub({ status: true }),
    }),
    (e) => {
      assert.equal(e.code, 'TOO_MANY_EMOJI');
      assert.match(e.message, new RegExp(String(MAX_EMOJI)));
      return true;
    }
  );
});

test('reactToChannel requires an apiKey and at least one emoji', async () => {
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '🔥', fetchImpl: stub({}) }),
    (e) => e.code === 'NO_API_KEY'
  );
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '', apiKey: 'k', fetchImpl: stub({}) }),
    (e) => e.code === 'NO_EMOJI'
  );
});

test('reactToChannel maps 401 to UNAUTHORIZED and keeps the parsed result', async () => {
  const f = stub(
    { status: false, message: 'Unauthorized: Invalid or missing API Key.' },
    { status: 401 }
  );
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'bad', fetchImpl: f }),
    (e) => {
      assert.equal(e.code, 'UNAUTHORIZED');
      assert.equal(e.status, 401);
      assert.match(e.message, /Unauthorized/);
      // the caller still gets the result even though it threw
      assert.equal(e.result.ok, false);
      assert.equal(e.result.messageId, '141');
      return true;
    }
  );
});

test('reactToChannel maps 429 and 5xx to their own codes', async () => {
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'k', fetchImpl: stub({ message: 'slow down' }, { status: 429 }) }),
    (e) => e.code === 'RATE_LIMITED'
  );
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'k', fetchImpl: stub({ message: 'boom' }, { status: 503 }) }),
    (e) => e.code === 'SERVER_ERROR'
  );
});

test('throwOnError:false returns the failure instead of throwing', async () => {
  const f = stub({ status: false, message: 'Limit habis.' }, { status: 429 });
  const res = await reactToChannel({
    url: LINK,
    emoji: '🔥',
    apiKey: 'k',
    fetchImpl: f,
    throwOnError: false,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 429);
  assert.equal(res.message, 'Limit habis.');
});

test('reactToChannel surfaces the quota the API returns', async () => {
  const f = stub({
    status: true,
    limit: { max: 1, used: 1, remaining: 0, resetAt: 1792000000000 },
  });
  const res = await reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'k', fetchImpl: f });
  assert.equal(res.limit.remaining, 0);
  assert.equal(res.limit.max, 1);
});

test('reactToChannel survives a non-JSON body (an HTML error page)', async () => {
  const f = stub('<html>Just a moment...</html>', { status: 403 });
  await assert.rejects(
    reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'k', fetchImpl: f }),
    (e) => {
      assert.equal(e.code, 'UNAUTHORIZED');
      assert.equal(e.response, null);
      return true;
    }
  );
});

test('reactToChannel reports a timeout as TIMEOUT, not a network error', async () => {
  const abortErr = new Error('aborted');
  abortErr.name = 'AbortError';
  await assert.rejects(
    reactToChannel({
      url: LINK,
      emoji: '🔥',
      apiKey: 'k',
      timeoutMs: 5,
      fetchImpl: stub({}, { throws: abortErr }),
    }),
    (e) => e.code === 'TIMEOUT'
  );
});

test('reactToChannel reports a real connection failure as NETWORK', async () => {
  await assert.rejects(
    reactToChannel({
      url: LINK,
      emoji: '🔥',
      apiKey: 'k',
      fetchImpl: stub({}, { throws: new Error('getaddrinfo ENOTFOUND') }),
    }),
    (e) => {
      assert.equal(e.code, 'NETWORK');
      assert.match(e.message, /ENOTFOUND/);
      return true;
    }
  );
});

test('reactToChannel sends an Accept header and a User-Agent', async () => {
  const f = stub({ status: true });
  await reactToChannel({ url: LINK, emoji: '🔥', apiKey: 'k', fetchImpl: f });
  assert.equal(f.calls[0].req.method, 'GET');
  assert.equal(f.calls[0].req.headers.Accept, 'application/json');
  assert.match(f.calls[0].req.headers['User-Agent'], /^broken-rch\//);
});

test('baseUrl is honoured and its trailing slash is trimmed', async () => {
  const f = stub({ status: true });
  await reactToChannel({
    url: LINK,
    emoji: '🔥',
    apiKey: 'k',
    baseUrl: 'https://example.test/',
    fetchImpl: f,
  });
  assert.match(f.calls[0].url, /^https:\/\/example\.test\/tools\/rch\?/);
});

test('an emoji with a comma in the input still round-trips', async () => {
  const f = stub({ status: true });
  await reactToChannel({ url: LINK, emoji: ['🔥,❤️'], apiKey: 'k', fetchImpl: f });
  const called = new URL(f.calls[0].url);
  assert.equal(called.searchParams.get('reaction'), '🔥,❤️');
});

// ------------------------------------------------------------------ checkLimit

test('checkLimit reads the quota and passes ip when given', async () => {
  const f = stub({
    status: true,
    data: { apikey: 'Rin', tipe_limit: 'per jam', batas_maksimal: 7, sisa: 7 },
  });
  const res = await checkLimit({ apiKey: 'Rin', ip: '1.2.3.4', fetchImpl: f });

  assert.equal(res.ok, true);
  assert.equal(res.limit.sisa, 7);

  const called = new URL(f.calls[0].url);
  assert.equal(called.pathname, '/system/cek-limit');
  assert.equal(called.searchParams.get('apikey'), 'Rin');
  assert.equal(called.searchParams.get('ip'), '1.2.3.4');
});

test('checkLimit omits ip when it is not supplied', async () => {
  const f = stub({ status: true, data: {} });
  await checkLimit({ apiKey: 'Rin', fetchImpl: f });
  assert.equal(new URL(f.calls[0].url).searchParams.has('ip'), false);
});

test('checkLimit requires an apiKey', async () => {
  await assert.rejects(checkLimit({ fetchImpl: stub({}) }), (e) => e.code === 'NO_API_KEY');
});

// -------------------------------------------------------------------- surface

test('the public surface is complete', () => {
  const mod = require('../index.js');
  for (const key of [
    'reactToChannel',
    'checkLimit',
    'parseChannelLink',
    'splitEmoji',
    'RchError',
    'MAX_EMOJI',
    'DEFAULT_BASE_URL',
    'DEFAULT_TIMEOUT_MS',
    'CHANNEL_LINK_RE',
  ]) {
    assert.ok(key in mod, 'missing export: ' + key);
  }
  assert.equal(mod.MAX_EMOJI, 4);
  assert.equal(mod.DEFAULT_BASE_URL, 'https://apiii-xrina.my.id');
});

test('the ESM build exposes the same names', async () => {
  const esm = await import('../index.mjs');
  assert.equal(typeof esm.reactToChannel, 'function');
  assert.equal(typeof esm.checkLimit, 'function');
  assert.equal(typeof esm.parseChannelLink, 'function');
  assert.equal(esm.MAX_EMOJI, 4);
  assert.equal(typeof esm.default.reactToChannel, 'function');
});

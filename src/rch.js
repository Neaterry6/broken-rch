'use strict';

/**
 * broken-rch — react to WhatsApp Channel messages via the Rin API.
 *
 * Two endpoints are wrapped:
 *   GET /tools/rch          send a reaction
 *   GET /system/cek-limit   read the remaining quota
 *
 * Zero runtime dependencies: Node 18+ already ships fetch, AbortController
 * and URLSearchParams.
 *
 * IMPORTANT — the API's own limits, not this library's:
 *   - At most 4 emoji per call.
 *   - The reaction endpoint is rate limited per device (the site shows
 *     1 reaction per 24 hours). The limit is enforced server-side and is
 *     returned in the response, so this client surfaces it rather than
 *     working around it.
 */

const DEFAULT_BASE_URL = 'https://apiii-xrina.my.id';
const MAX_EMOJI = 4;
const DEFAULT_TIMEOUT_MS = 30000;
const USER_AGENT = 'broken-rch/1.0.0';

/**
 * A channel *message* link, not a channel profile link. The trailing number
 * is the message id — the API rejects a link without it.
 *   https://whatsapp.com/channel/<channelId>/<messageId>
 */
const CHANNEL_LINK_RE =
  /^https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/(\d+)(?:[/?#].*)?$/i;

class RchError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'RchError';
    const o = options || {};
    this.code = o.code || 'RCH_ERROR';
    this.status = o.status === undefined ? null : o.status;
    this.response = o.response === undefined ? null : o.response;
    /** Present on API errors so the caller still gets the parsed result. */
    this.result = o.result === undefined ? null : o.result;
  }
}

/**
 * Normalise the emoji input into an array.
 * Accepts an array, a comma-separated string, or a bare string of emoji.
 * Grapheme-aware, so "🔥❤️" is two emoji rather than three code points.
 */
function splitEmoji(input) {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim()).filter(Boolean);
  }
  const raw = String(input === undefined || input === null ? '' : input).trim();
  if (!raw) return [];
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(raw), (s) => s.segment).filter(
      (v) => v.trim() !== ''
    );
  }
  return Array.from(raw).filter((v) => v.trim() !== '');
}

/**
 * Validate a channel message link and pull out its parts.
 * Throws RchError with code INVALID_URL when it is not a message link.
 */
function parseChannelLink(link) {
  const value = String(link === undefined || link === null ? '' : link).trim();
  if (!value) {
    throw new RchError('A channel message link is required.', {
      code: 'INVALID_URL',
    });
  }
  const match = CHANNEL_LINK_RE.exec(value);
  if (!match) {
    throw new RchError(
      'Not a WhatsApp Channel message link. It must look like ' +
        'https://whatsapp.com/channel/<channelId>/<messageId> — the trailing ' +
        'number is required, so a channel profile link will not work.',
      { code: 'INVALID_URL' }
    );
  }
  return {
    url: value,
    channelId: match[1],
    messageId: match[2],
  };
}

async function requestJson(url, opts) {
  const options = opts || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new RchError(
      'No fetch implementation available. Use Node 18+ or pass options.fetchImpl.',
      { code: 'NO_FETCH' }
    );
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const hasAbort = typeof AbortController === 'function';
  const controller = hasAbort ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let res;
  try {
    res = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: Object.assign(
        { Accept: 'application/json', 'User-Agent': USER_AGENT },
        options.headers || {}
      ),
      body: options.body,
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new RchError('Request timed out after ' + timeoutMs + 'ms.', {
        code: 'TIMEOUT',
      });
    }
    throw new RchError(
      'Could not reach the API: ' + ((err && err.message) || 'unknown error'),
      { code: 'NETWORK' }
    );
  }
  if (timer) clearTimeout(timer);

  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    text = '';
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null; // HTML error page or empty body
    }
  }

  return { res, data, text };
}

function resolveConfig(options) {
  const o = options || {};
  const apiKey = o.apiKey || o.apikey;
  return {
    baseUrl: String(o.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs: o.timeoutMs || DEFAULT_TIMEOUT_MS,
    fetchImpl: o.fetchImpl,
    apiKey,
    throwOnError: o.throwOnError !== false,
  };
}

/**
 * Send an emoji reaction to a WhatsApp Channel message.
 *
 * @param {object} options
 * @param {string} options.url        Channel *message* link (trailing number required).
 * @param {string|string[]} options.emoji  Up to 4 emoji. Array, "🔥,❤️" or "🔥❤️".
 * @param {string} options.apiKey     Rin API key. Required by the API.
 * @param {string} [options.baseUrl]  Override the API host.
 * @param {number} [options.timeoutMs=30000]
 * @param {boolean} [options.throwOnError=true]  Set false to get the result
 *        object back instead of a thrown RchError.
 * @param {Function} [options.fetchImpl]  Inject a fetch (handy for tests).
 * @returns {Promise<object>} normalised result
 */
async function reactToChannel(options) {
  const o = options || {};
  const cfg = resolveConfig(o);

  const target = parseChannelLink(o.url);
  const emojis = splitEmoji(o.emoji !== undefined ? o.emoji : o.reaction);

  if (!emojis.length) {
    throw new RchError('At least one emoji is required.', { code: 'NO_EMOJI' });
  }
  if (emojis.length > MAX_EMOJI) {
    throw new RchError(
      'At most ' + MAX_EMOJI + ' emoji per call; got ' + emojis.length + '.',
      { code: 'TOO_MANY_EMOJI' }
    );
  }
  if (!cfg.apiKey) {
    throw new RchError(
      'An apiKey is required. Register on the Rin API site to get one.',
      { code: 'NO_API_KEY' }
    );
  }

  const query = new URLSearchParams();
  query.set('url', target.url);
  query.set('reaction', emojis.join(','));
  query.set('apikey', cfg.apiKey);

  const endpoint = cfg.baseUrl + '/tools/rch?' + query.toString();
  const { res, data, text } = await requestJson(endpoint, {
    timeoutMs: cfg.timeoutMs,
    fetchImpl: cfg.fetchImpl,
  });

  const ok = Boolean(res.ok && data && data.status);
  const message =
    (data && data.message) ||
    (ok ? 'Reaction sent.' : 'Request failed with HTTP ' + res.status + '.');

  const result = {
    ok,
    status: res.status,
    message,
    url: target.url,
    channelId: target.channelId,
    messageId: target.messageId,
    emojis,
    limit: (data && data.limit) || null,
    response: data,
  };

  if (!ok && cfg.throwOnError) {
    let code = 'API_ERROR';
    if (res.status === 401 || res.status === 403) code = 'UNAUTHORIZED';
    else if (res.status === 429) code = 'RATE_LIMITED';
    else if (res.status >= 500) code = 'SERVER_ERROR';
    throw new RchError(message, {
      code,
      status: res.status,
      response: data,
      result,
    });
  }

  return result;
}

/**
 * Read the remaining quota for an API key.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.ip]  Only needed when calling a device-scoped key
 *        from a script rather than a browser.
 * @returns {Promise<object>} { ok, status, message, limit, response }
 */
async function checkLimit(options) {
  const o = options || {};
  const cfg = resolveConfig(o);

  if (!cfg.apiKey) {
    throw new RchError('An apiKey is required.', { code: 'NO_API_KEY' });
  }

  const query = new URLSearchParams();
  query.set('apikey', cfg.apiKey);
  if (o.ip) query.set('ip', String(o.ip));

  const endpoint = cfg.baseUrl + '/system/cek-limit?' + query.toString();
  const { res, data, text } = await requestJson(endpoint, {
    timeoutMs: cfg.timeoutMs,
    fetchImpl: cfg.fetchImpl,
  });

  const ok = Boolean(res.ok && data && data.status);
  const message =
    (data && data.message) ||
    (ok ? 'Limit read.' : 'Request failed with HTTP ' + res.status + '.');

  const result = {
    ok,
    status: res.status,
    message,
    limit: (data && data.data) || null,
    response: data,
  };

  if (!ok && cfg.throwOnError) {
    throw new RchError(message, {
      code: res.status === 401 || res.status === 403 ? 'UNAUTHORIZED' : 'API_ERROR',
      status: res.status,
      response: data,
      result,
    });
  }

  return result;
}

module.exports = {
  reactToChannel,
  checkLimit,
  parseChannelLink,
  splitEmoji,
  RchError,
  MAX_EMOJI,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  CHANNEL_LINK_RE,
};

# broken-rch

React to **WhatsApp Channel** messages with emoji, via the [Rin API](https://apiii-xrina.my.id).

Zero dependencies. Typed. Dual ESM + CJS. 31 tests.

```bash
npm i broken-rch
```

## Quick start

```js
const { reactToChannel } = require('broken-rch');

const res = await reactToChannel({
  url: 'https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x/141',
  emoji: '🔥',
  apiKey: process.env.RIN_API_KEY,
});

console.log(res.ok, res.message);
```

ESM works the same way:

```js
import { reactToChannel } from 'broken-rch';
```

## Read this before you plan around it

The API enforces two limits. Neither is this library's, and neither can be
configured away:

| Limit | Value |
|---|---|
| Emoji per call | **4** |
| Reactions per device | **1 per 24 hours** |

The per-device limit is applied server-side and the send route sits behind a
Cloudflare Turnstile check. A single client cannot send a burst of reactions —
that is the point of the design. If you need volume, you need separate devices,
each clearing its own check.

This library surfaces the remaining quota on every response so you can react to
it instead of guessing:

```js
const res = await reactToChannel({ url, emoji: '🔥', apiKey });
if (res.limit?.remaining === 0) {
  console.log('next one at', new Date(res.limit.resetAt).toISOString());
}
```

## The link must be a message link

A channel **profile** link will be rejected. The trailing number is the message
id and it is required:

```
https://whatsapp.com/channel/<channelId>/<messageId>
                                       ^^^^^^^^^ this
```

`parseChannelLink` validates it for you and throws `INVALID_URL` with a readable
message if it is wrong.

## API

### `reactToChannel(options)`

| Option | Type | Notes |
|---|---|---|
| `url` | `string` | Channel **message** link. Required. |
| `emoji` | `string \| string[]` | Up to 4. `'🔥'`, `'🔥,❤️'`, `'🔥❤️'` or `['🔥','❤️']`. |
| `apiKey` | `string` | Rin API key. Required. `apikey` also works. |
| `baseUrl` | `string` | Defaults to `https://apiii-xrina.my.id`. |
| `timeoutMs` | `number` | Defaults to `30000`. |
| `throwOnError` | `boolean` | Defaults to `true`. Set `false` to get the result instead of throwing. |
| `fetchImpl` | `function` | Inject a fetch. Useful for tests. |

Resolves to:

```js
{
  ok: true,
  status: 200,
  message: 'Berhasil mengirim react ke pesan channel',
  url: 'https://whatsapp.com/channel/.../141',
  channelId: '0029Vb6EHtR5Ui2gHMW9zX2x',
  messageId: '141',
  emojis: ['🔥'],
  limit: { max: 1, used: 1, remaining: 0, resetAt: 1792000000000 },
  response: { /* the raw API body */ }
}
```

### `checkLimit(options)`

Reads the remaining quota without spending it.

```js
const { limit } = await checkLimit({ apiKey: 'Rin' });
// { apikey: 'Rin', tipe_limit: 'per jam', batas_maksimal: 7, terpakai: 0, sisa: 7 }
```

Pass `ip` only when calling a device-scoped key from a script rather than a
browser.

### `parseChannelLink(link)`

```js
parseChannelLink('https://whatsapp.com/channel/0029Vb6EHtR5Ui2gHMW9zX2x/141');
// { url, channelId: '0029Vb6EHtR5Ui2gHMW9zX2x', messageId: '141' }
```

### `splitEmoji(input)`

Grapheme-aware, so `'❤️'` is one emoji and not two code points, and `'👍🏽'`
does not split on the skin-tone modifier.

## Errors

Everything throws `RchError` with a `code`, and API errors also carry the parsed
`result` so you never lose the response:

```js
const { RchError } = require('broken-rch');

try {
  await reactToChannel({ url, emoji: '🔥', apiKey });
} catch (err) {
  if (err instanceof RchError) {
    switch (err.code) {
      case 'UNAUTHORIZED':  // bad or missing key
      case 'RATE_LIMITED':  // quota spent
      case 'INVALID_URL':   // not a message link
      case 'TOO_MANY_EMOJI':
      case 'TIMEOUT':
      case 'NETWORK':
        break;
    }
    console.log(err.result); // the full result, even on failure
  }
}
```

| Code | Meaning |
|---|---|
| `INVALID_URL` | Not a channel message link. |
| `NO_EMOJI` / `TOO_MANY_EMOJI` | Emoji missing, or more than 4. |
| `NO_API_KEY` | No key supplied. |
| `UNAUTHORIZED` | 401/403 — the API rejected the key. |
| `RATE_LIMITED` | 429 — quota spent. |
| `SERVER_ERROR` | 5xx from the API. |
| `TIMEOUT` | Exceeded `timeoutMs`. |
| `NETWORK` | Could not reach the host. |
| `NO_FETCH` | No fetch available (needs Node 18+). |

## Getting an API key

Register on the [Rin API site](https://apiii-xrina.my.id) and use the key on the
reaction page. The demo key `Rin` works for `checkLimit` but is **not**
authorised for the reaction endpoint.

## Tests

```bash
npm test                              # 24 offline tests, no network
node --test test/live.test.js         # 7 live tests, no key needed
RCH_API_KEY=key RCH_SEND=1 node --test test/live.test.js   # also sends one
```

The offline suite stubs every request, so it runs anywhere. The live suite hits
the real API and skips the send unless you explicitly opt in with `RCH_SEND=1`,
because the send spends the 24-hour quota.

## Notes

- The endpoint is a **third-party service**. Availability and terms are theirs,
  not this package's.
- Sending reactions to channels you do not own is your call and your risk. Use
  it on your own channels.
- Node 18+ required. No dependencies, so nothing to audit or keep updated.

## License

MIT

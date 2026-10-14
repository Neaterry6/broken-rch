/**
 * broken-rch — react to WhatsApp Channel messages via the Rin API.
 */

/** The API's hard cap. Enforced server-side too. */
export declare const MAX_EMOJI: 4;
export declare const DEFAULT_BASE_URL: string;
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const CHANNEL_LINK_RE: RegExp;

export type RchErrorCode =
  | 'RCH_ERROR'
  | 'INVALID_URL'
  | 'NO_EMOJI'
  | 'TOO_MANY_EMOJI'
  | 'NO_API_KEY'
  | 'NO_FETCH'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'API_ERROR';

export declare class RchError extends Error {
  name: 'RchError';
  code: RchErrorCode;
  status: number | null;
  response: unknown;
  /** Present on API errors, so the caller still gets the parsed result. */
  result: RchResult | LimitResult | null;
  constructor(
    message: string,
    options?: {
      code?: RchErrorCode;
      status?: number | null;
      response?: unknown;
      result?: RchResult | LimitResult | null;
    }
  );
}

export interface ParsedChannelLink {
  url: string;
  channelId: string;
  messageId: string;
}

export interface QuotaLimit {
  /** Total allowance. */
  max?: number;
  used?: number;
  remaining?: number;
  /** Epoch ms when the allowance resets, or null when unused. */
  resetAt?: number | null;
  now?: number;
  [key: string]: unknown;
}

export interface RchResult {
  ok: boolean;
  status: number;
  message: string;
  url: string;
  channelId: string;
  messageId: string;
  emojis: string[];
  limit: QuotaLimit | null;
  response: unknown;
}

export interface LimitResult {
  ok: boolean;
  status: number;
  message: string;
  limit: unknown;
  response: unknown;
}

export interface BaseOptions {
  apiKey?: string;
  /** Alias of apiKey. */
  apikey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Set false to receive the result instead of a thrown RchError. */
  throwOnError?: boolean;
  /** Inject a fetch implementation (useful for tests). */
  fetchImpl?: typeof fetch;
}

export interface ReactOptions extends BaseOptions {
  /** Channel *message* link — the trailing number is required. */
  url: string;
  /** Up to 4 emoji: an array, "🔥,❤️", or "🔥❤️". */
  emoji?: string | string[];
  /** Alias of emoji. */
  reaction?: string | string[];
}

export interface LimitOptions extends BaseOptions {
  /** Only needed for a device-scoped key called from a script. */
  ip?: string;
}

/** Send an emoji reaction to a WhatsApp Channel message. */
export declare function reactToChannel(
  options: ReactOptions
): Promise<RchResult>;

/** Read the remaining quota for an API key. */
export declare function checkLimit(options: LimitOptions): Promise<LimitResult>;

/** Validate a channel message link and extract its parts. */
export declare function parseChannelLink(link: string): ParsedChannelLink;

/** Normalise emoji input into an array (grapheme-aware). */
export declare function splitEmoji(input?: string | string[]): string[];

declare const _default: {
  reactToChannel: typeof reactToChannel;
  checkLimit: typeof checkLimit;
  parseChannelLink: typeof parseChannelLink;
  splitEmoji: typeof splitEmoji;
  RchError: typeof RchError;
  MAX_EMOJI: typeof MAX_EMOJI;
  DEFAULT_BASE_URL: typeof DEFAULT_BASE_URL;
  DEFAULT_TIMEOUT_MS: typeof DEFAULT_TIMEOUT_MS;
  CHANNEL_LINK_RE: typeof CHANNEL_LINK_RE;
};
export default _default;

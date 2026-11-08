// -----------------------------------------------------------------------------
// HTTP client of the official real-time API of the Administration des
// transports publics (ATP, Luxembourg), the one behind mobiliteit.lu: a HAFAS
// ReST server (https://cdt.hafas.de/opendata/apiserver/, schema rest-2.52.xsd,
// data under CC BY 4.0). Every request carries a personal key (`accessId`),
// asked by e-mail to opendata-api@atp.etat.lu.
//
// Services the server offers (listed on its root page, both used here or
// documented):
//   departureBoard          the next departures of one stop, in real time —
//                           the only service the integration calls;
//   location.nearbystops    the stops around a coordinate (not used: the stop
//                           names come from the open GTFS, see stops.js).
// Neither location.name nor himsearch is published (404).
//
// A key has a quota (500 requests an hour and 5 000 a day by default, as
// reported by the community documentation): quota.js keeps the integration
// under it. Errors answer `{ errorCode, errorText }`:
//   API_AUTH  (401)   the key is refused (its errorText repeats the key:
//                     always redact);
//   API_QUOTA (400)   the quota of the key is spent;
//   API_PARAM (400)   a parameter is missing ("Missing value for required
//                     param accessId" without a key);
//   SVC_LOC   (400)   unknown stop;
//   SVC_NO_RESULT     no departure (not an error for a board: empty).
// The key is never written in a log or an error message.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const BASE_URL = process.env.MOBILITEIT_API_URL || 'https://cdt.hafas.de/opendata/apiserver';
const TIMEOUT_MS = 20000;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-mobiliteit-lu/${version} (+https://github.com/William-De71/gladys-mobiliteit-lu)`;
// The board covers this many minutes ahead, and holds at most this many
// departures (a main station gives several hundred in two hours).
const BOARD_DURATION = 90;
const BOARD_MAX_JOURNEYS = 150;
const API_LANGUAGES = ['fr', 'de', 'en'];
const EMPTY_CODES = new Set(['SVC_NO_RESULT', 'SVC_NO_MATCH']);

class HafasError extends Error {
  /**
   * @param {string} kind - `auth`, `quota`, `no_key`, `unknown_stop`,
   * `busy`, `unreachable` or `invalid`.
   * @param {string} message - The detail (never the key).
   * @param {object} [extra] - `{ status, code }`.
   */
  constructor(kind, message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'HafasError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * @description The kind of an error answer.
 * @param {string} code - The `errorCode` ("API_AUTH").
 * @param {number} status - The HTTP status.
 * @param {string} text - The `errorText`.
 * @returns {string} HafasError kind.
 */
function kindOf(code, status, text) {
  if (code === 'API_AUTH' || status === 401 || status === 403) {
    return 'auth';
  }
  if (code === 'API_QUOTA' || /quota/i.test(text) || status === 429) {
    return 'quota';
  }
  if (code === 'API_PARAM' && /accessId/i.test(text)) {
    return 'no_key';
  }
  if (code === 'SVC_LOC' || code === 'SVC_LOC_DEP') {
    return 'unknown_stop';
  }
  if (status === 503 || status === 504) {
    return 'busy';
  }
  return status >= 500 ? 'unreachable' : 'invalid';
}

/**
 * @description Read an error answer, JSON or XML (the server answers XML
 * when it could not read `format`).
 * @param {string} body - The body.
 * @returns {{ code: string, text: string }} The code and text, '' when none.
 */
function readErrorBody(body) {
  try {
    const json = JSON.parse(body);
    return { code: String(json?.errorCode ?? ''), text: String(json?.errorText ?? '') };
  } catch {
    const code = /errorCode="([^"]*)"/.exec(body)?.[1] ?? '';
    const text = /errorText="([^"]*)"/.exec(body)?.[1] ?? '';
    return { code, text };
  }
}

/**
 * @description Hide a key in a text.
 * @param {string} text - The text.
 * @param {string} key - The key.
 * @returns {string} The text, the key replaced by "***".
 */
function redact(text, key) {
  return key ? String(text).split(key).join('***') : String(text);
}

/**
 * @description A client of the departure board.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - The fetch function (tests).
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {string} [options.baseUrl] - The API root (tests).
 * @returns {object} `{ departureBoard, requests }`.
 */
function createHafasClient({
  fetch: fetchFn = globalThis.fetch,
  now = () => Date.now(),
  baseUrl = BASE_URL,
} = {}) {
  // Requests made, for the diagnostic.
  const requests = { total: 0, failed: 0, last: null, lastError: null };

  /**
   * @description The next departures of one stop.
   * @param {object} options - Options.
   * @param {string} options.key - The access key.
   * @param {string} options.stopId - The HAFAS id ("200405060").
   * @param {string} [options.language] - Language of the texts (messages).
   * @returns {Promise<object>} The board: `{ Departure: [], Message: [] }`,
   * empty when nothing leaves.
   */
  async function departureBoard({ key, stopId, language = 'fr' }) {
    if (!key) {
      throw new HafasError('no_key', 'no access key');
    }
    const query = new URLSearchParams({
      accessId: key,
      id: String(stopId),
      format: 'json',
      lang: API_LANGUAGES.includes(language) ? language : 'fr',
      duration: String(BOARD_DURATION),
      maxJourneys: String(BOARD_MAX_JOURNEYS),
    });
    requests.total += 1;
    requests.last = now();
    let response;
    try {
      response = await fetchFn(`${baseUrl}/departureBoard?${query}`, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      requests.failed += 1;
      const error = new HafasError('unreachable', redact(err.cause?.code ?? err.message, key));
      requests.lastError = `unreachable: ${error.message}`;
      throw error;
    }
    const body = await response.text().catch(() => '');
    const failure = (kind, message, extra) => {
      requests.failed += 1;
      const error = new HafasError(kind, redact(message, key), extra);
      requests.lastError = `${kind}: ${error.message}`;
      return error;
    };
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const { code, text } = readErrorBody(body);
    if (code && EMPTY_CODES.has(code)) {
      return { Departure: [], Message: [] };
    }
    if (!response.ok || code) {
      const detail = [`HTTP ${response.status}`, code, text.slice(0, 160)]
        .filter(Boolean)
        .join(' ');
      throw failure(kindOf(code, response.status, text), detail, {
        status: response.status,
        code: code || null,
      });
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw failure('invalid', 'departureBoard: not a JSON object');
    }
    return json;
  }

  return { requests, departureBoard };
}

export {
  BASE_URL,
  USER_AGENT,
  BOARD_DURATION,
  BOARD_MAX_JOURNEYS,
  HafasError,
  kindOf,
  readErrorBody,
  redact,
  createHafasClient,
};

// -----------------------------------------------------------------------------
// The stops of Luxembourg, kept in /data.
//
// The departure board knows a stop by its HAFAS id ("200405060": nine digits,
// the `extId` of the API). The open GTFS of the Administration des transports
// publics (data.public.lu, CC BY 4.0) lists every stop with the same number,
// zero-padded to twelve digits ("000200405060"): its stops.txt gives the name
// of each id, read again every seven days. Searching and resolving a stop by
// its name is thus local: it never spends a request of the API key.
//
//   - dataset: https://data.public.lu/fr/datasets/horaires-et-arrets-des-transport-publics-gtfs/
//     (a new zip each week; the newest resource is taken);
//   - a stop is typed by its name ("Luxembourg, Gare Centrale", "Hamilius"),
//     by words of it when one stop only holds them all ("gare centrale tram"),
//     or by its id ("200405060"), given by the "Find a stop" button.
//
// Names are compared folded: no case, no accent, no punctuation.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { zipEntries, readEntry, eachRow } from './zip.js';

const DATASET_URL =
  process.env.MOBILITEIT_GTFS_DATASET_URL ||
  'https://data.public.lu/api/1/datasets/horaires-et-arrets-des-transport-publics-gtfs/';
const STOPS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 60000;
// The zip is about 16 MB: anything far beyond is not the timetable.
const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-mobiliteit-lu/${version} (+https://github.com/William-De71/gladys-mobiliteit-lu)`;

class StopsError extends Error {
  /**
   * @param {string} kind - `unreachable` or `invalid`.
   * @param {string} message - The detail.
   */
  constructor(kind, message) {
    super(message);
    this.name = 'StopsError';
    this.kind = kind;
  }
}

/**
 * @description Fold a text for comparisons.
 * @param {unknown} value - The text.
 * @returns {string} Lower case, no accent, words separated by one space.
 * @example
 * fold('Luxembourg, Gare Centrale (Tram)'); // -> 'luxembourg gare centrale tram'
 */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @description A slug for an external id.
 * @param {unknown} value - The text.
 * @param {number} [max] - The longest slug.
 * @returns {string} "kirchberg-p-r".
 */
function slug(value, max = 40) {
  return fold(value).replace(/ /g, '-').slice(0, max).replace(/-+$/, '');
}

/**
 * @description The HAFAS id of a GTFS stop id: its digits without the zeros
 * of the padding.
 * @param {unknown} stopId - "000200405060".
 * @returns {string} "200405060", '' when not a number.
 */
function extIdOf(stopId) {
  const digits = String(stopId ?? '').trim();
  return /^\d{1,15}$/.test(digits) ? String(Number(digits)) : '';
}

/**
 * @description Whether a typed text is a stop id.
 * @param {string} typed - The text.
 * @returns {boolean} True for 6 to 12 digits.
 */
const isStopId = (typed) => /^\d{6,12}$/.test(String(typed ?? '').trim());

/**
 * @description The stops of a stops.txt.
 * @param {Buffer} csv - Its bytes.
 * @returns {Array<[string, string]>} `[extId, name]`, sorted by name, one per id.
 */
function parseStops(csv) {
  const byId = new Map();
  eachRow(csv, (row, column) => {
    const id = extIdOf(row[column('stop_id')]);
    const name = String(row[column('stop_name')] ?? '').trim();
    const type = String(row[column('location_type')] ?? '').trim();
    // Entrances and generic nodes are not departure boards.
    if (id && name && (type === '' || type === '0' || type === '1') && !byId.has(id)) {
      byId.set(id, name);
    }
  });
  return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
}

/**
 * @description The newest zip of the dataset.
 * @param {object} dataset - The answer of the data.public.lu API.
 * @returns {{ url: string, at: string }|null} Its URL and date.
 */
function newestZip(dataset) {
  const resources = Array.isArray(dataset?.resources) ? dataset.resources : [];
  const zips = resources
    .filter(
      (resource) =>
        typeof resource?.url === 'string' &&
        /^https:\/\//.test(resource.url) &&
        (String(resource.format ?? '').toLowerCase() === 'zip' || /\.zip$/i.test(resource.url)),
    )
    .map((resource) => ({
      url: resource.url,
      at: String(resource.last_modified ?? resource.created_at ?? ''),
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
  return zips[0] ?? null;
}

/**
 * @description Find a stop among the known ones.
 * @param {Array<[string, string]>} stops - The stops.
 * @param {string} typed - Its id, its name, or words of its name.
 * @returns {{ id: string, name: string }|null} The stop, null when unknown or
 * when the words fit several stops.
 */
function findStop(stops, typed) {
  const text = String(typed ?? '').trim();
  if (!text) {
    return null;
  }
  if (isStopId(text)) {
    const id = String(Number(text));
    const known = stops.find(([extId]) => extId === id);
    // An id the list does not know (a new stop) is still asked to the API.
    return { id, name: known?.[1] ?? id };
  }
  const wanted = fold(text);
  const exact = stops.filter(([, name]) => fold(name) === wanted);
  if (exact.length >= 1) {
    return { id: exact[0][0], name: exact[0][1] };
  }
  // "Hamilius" for "Hamilius (Bus)": the name without its mode in brackets,
  // when one stop only fits.
  const bare = stops.filter(([, name]) => fold(name.replace(/\s*\([^)]*\)\s*$/, '')) === wanted);
  if (bare.length === 1) {
    return { id: bare[0][0], name: bare[0][1] };
  }
  const words = wanted.split(' ').filter(Boolean);
  const holding = stops.filter(([, name]) => {
    const folded = ` ${fold(name)} `;
    return words.every((word) => folded.includes(` ${word}`));
  });
  return holding.length === 1 ? { id: holding[0][0], name: holding[0][1] } : null;
}

/**
 * @description Search stops by name, for the "Find a stop" button.
 * @param {Array<[string, string]>} stops - The stops.
 * @param {string} query - Words of the name.
 * @param {number} [max] - The longest list.
 * @returns {{ found: Array<{ id: string, name: string }>, total: number }}
 * The best matches first (the name starting with the words), and their count.
 */
function searchStops(stops, query, max = 12) {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) {
    return { found: [], total: 0 };
  }
  const wanted = words.join(' ');
  const matches = stops
    .filter(([, name]) => {
      const folded = ` ${fold(name)} `;
      return words.every((word) => folded.includes(` ${word}`));
    })
    .map(([id, name]) => {
      const folded = fold(name);
      let score = 2;
      if (folded === wanted) {
        score = 0;
      } else if (folded.startsWith(wanted) || folded.includes(` ${wanted}`)) {
        score = 1;
      }
      return { id, name, score };
    })
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'fr'));
  return {
    found: matches.slice(0, max).map(({ id, name }) => ({ id, name })),
    total: matches.length,
  };
}

/**
 * @description The stops, read from the open GTFS and kept in the store.
 * @param {object} options - Options.
 * @param {object} options.store - The store (`data.stops`, `save()`).
 * @param {Function} [options.fetch] - The fetch function (tests).
 * @param {Function} options.now - `() => number` in ms.
 * @param {object} [options.logger] - Logger.
 * @param {string} [options.datasetUrl] - The dataset API URL (tests).
 * @returns {object} `{ list, refresh, resolve, search, peekName }`.
 */
function createStops({
  store,
  fetch: fetchFn = globalThis.fetch,
  now,
  logger,
  datasetUrl = DATASET_URL,
}) {
  let pending = null;

  /**
   * @description Fetch a URL.
   * @param {string} url - The URL.
   * @param {string} accept - The Accept header.
   * @returns {Promise<Response>} The answer, checked.
   */
  async function get(url, accept) {
    let response;
    try {
      response = await fetchFn(url, {
        headers: { accept, 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new StopsError('unreachable', err.cause?.code ?? err.message);
    }
    if (!response.ok) {
      throw new StopsError(
        response.status >= 500 ? 'unreachable' : 'invalid',
        `HTTP ${response.status}`,
      );
    }
    return response;
  }

  /**
   * @description Read the stops of the newest GTFS.
   * @returns {Promise<Array<[string, string]>>} The stops.
   */
  async function download() {
    let dataset;
    try {
      dataset = await (await get(datasetUrl, 'application/json')).json();
    } catch (err) {
      throw err instanceof StopsError ? err : new StopsError('invalid', err.message);
    }
    const zip = newestZip(dataset);
    if (!zip) {
      throw new StopsError('invalid', 'no GTFS zip in the dataset');
    }
    const response = await get(zip.url, 'application/zip');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ZIP_BYTES) {
      throw new StopsError('invalid', `GTFS zip of ${bytes.length} bytes`);
    }
    let list;
    try {
      list = parseStops(await readEntry(bytes, zipEntries(bytes), 'stops.txt'));
    } catch (err) {
      throw new StopsError('invalid', `GTFS: ${err.message}`);
    }
    if (list.length === 0) {
      throw new StopsError('invalid', 'GTFS without stops');
    }
    logger?.info(`${list.length} stops read from ${zip.url}`);
    return { list, source: zip.url };
  }

  /**
   * @description The stops, read again when older than seven days (or when
   * forced). A failed reading keeps the stops already known.
   * @param {boolean} [force] - Read again now.
   * @returns {Promise<Array<[string, string]>>} The stops.
   */
  async function list(force = false) {
    const kept = store.data.stops;
    const fresh = Array.isArray(kept.list) && now() - (kept.readAt ?? 0) < STOPS_MAX_AGE_MS;
    if (fresh && !force) {
      return kept.list;
    }
    if (!pending) {
      pending = download()
        .then(async ({ list: read, source }) => {
          store.data.stops = { list: read, readAt: now(), source };
          await store.save();
          return read;
        })
        .finally(() => {
          pending = null;
        });
    }
    try {
      return await pending;
    } catch (err) {
      if (Array.isArray(kept.list) && kept.list.length > 0 && !force) {
        logger?.warn(`Stops not read again (${err.kind ?? 'error'}): ${err.message}`);
        return kept.list;
      }
      throw err;
    }
  }

  return {
    list,
    /**
     * @description Resolve a typed stop. An id is accepted even when the list
     * cannot be read.
     * @param {string} typed - Its id or name.
     * @returns {Promise<{ id: string, name: string }|null>} The stop.
     */
    resolve: async (typed) => {
      if (isStopId(typed)) {
        const known = Array.isArray(store.data.stops.list) ? store.data.stops.list : [];
        if (known.length === 0) {
          try {
            return findStop(await list(), typed);
          } catch {
            return findStop([], typed);
          }
        }
        return findStop(known, typed);
      }
      return findStop(await list(), typed);
    },
    search: async (query, max) => searchStops(await list(), query, max),
    /**
     * @description The name of a stop id, without reading anything.
     * @param {string} id - "200405060".
     * @returns {string|null} Its name.
     */
    peekName: (id) =>
      (store.data.stops.list ?? []).find(([extId]) => extId === String(id))?.[1] ?? null,
  };
}

export {
  DATASET_URL,
  STOPS_MAX_AGE_MS,
  StopsError,
  fold,
  slug,
  extIdOf,
  isStopId,
  parseStops,
  newestZip,
  findStop,
  searchStops,
  createStops,
};

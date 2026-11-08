// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data/mobiliteit-lu.json
// (the only writable place of the container):
//   - `stops`     the stops of the open GTFS (`[id, name]`, read again
//                 weekly), so a restart reads nothing but the departures;
//   - `seen`      what the scene triggers already know, per stop: the
//                 reminders fired, the cancellations and delays reported,
//                 the traffic messages seen. A restart never fires the same
//                 event twice;
//   - `quota`     the requests made with the key in the last 24 hours, by
//                 minute, and the end of a pause after an API_QUOTA answer.
// The passages themselves are not kept: they are read again at start.
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_PATH = '/data/mobiliteit-lu.json';
const EMPTY = () => ({
  stops: { list: null, readAt: 0, source: null },
  seen: { reminders: {}, cancelled: {}, delayed: {}, messages: {} },
  quota: { minutes: {}, blockedUntil: 0 },
});

/**
 * @description The store.
 * @param {object} [options] - `{ path, logger }`.
 * @returns {object} `{ data, load, save }`.
 */
function createStore({ path = DEFAULT_PATH, logger } = {}) {
  const store = {
    data: EMPTY(),
    /**
     * @description Read the file; an absent or broken file is an empty store.
     * @returns {Promise<void>}
     */
    async load() {
      try {
        const raw = JSON.parse(await readFile(path, 'utf8'));
        const base = EMPTY();
        const value = raw && typeof raw === 'object' ? raw : {};
        const part = (name) => (value[name] && typeof value[name] === 'object' ? value[name] : {});
        store.data = {
          stops: { ...base.stops, ...part('stops') },
          seen: { ...base.seen, ...part('seen') },
          quota: { ...base.quota, ...part('quota') },
        };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger?.warn(`Unable to read ${path}: ${err.message}`);
        }
        store.data = EMPTY();
      }
    },
    /**
     * @description Write the file (atomically: a temporary file, then a rename).
     * @returns {Promise<void>}
     */
    async save() {
      try {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        await writeFile(temporary, JSON.stringify(store.data));
        await rename(temporary, path);
      } catch (err) {
        logger?.warn(`Unable to write ${path}: ${err.message}`);
      }
    },
  };
  return store;
}

export { DEFAULT_PATH, createStore };

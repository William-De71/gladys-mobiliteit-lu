import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fold,
  slug,
  extIdOf,
  isStopId,
  parseStops,
  newestZip,
  findStop,
  searchStops,
  createStops,
  STOPS_MAX_AGE_MS,
} from '../src/stops.js';
import { zipEntries, readEntry } from '../src/zip.js';
import { createStore } from '../src/store.js';
import {
  STOPS_TXT,
  GTFS_ZIP,
  DATASET,
  ZIP_URL,
  DATASET_URL,
  NOW,
  fakeAtp,
  makeZip,
  storePath,
  silent,
} from './helpers/fixtures.js';

const STOPS = parseStops(Buffer.from(STOPS_TXT));

test('the stops of the GTFS: HAFAS ids without the padding, sorted by name', async () => {
  assert.equal(STOPS.length, 13);
  assert.ok(STOPS.some(([id, name]) => id === '200405060' && name === 'Luxembourg, Gare Centrale'));
  const names = STOPS.map(([, name]) => name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'fr')),
  );
  // Read through the zip, stored or deflated.
  const deflated = await readEntry(GTFS_ZIP, zipEntries(GTFS_ZIP), 'stops.txt');
  assert.equal(deflated.toString('utf8'), STOPS_TXT);
  const stored = makeZip({ 'gtfs/stops.txt': STOPS_TXT }, { store: true });
  assert.equal((await readEntry(stored, zipEntries(stored), 'stops.txt')).toString(), STOPS_TXT);
  assert.equal(await readEntry(stored, zipEntries(stored), 'routes.txt'), null);
  assert.throws(() => zipEntries(Buffer.from('not a zip at all, really not')), /not a zip/);
  assert.equal(extIdOf('000200405060'), '200405060');
  assert.equal(extIdOf('A=1@O=x'), '');
  assert.ok(isStopId('200405060'));
  assert.ok(!isStopId('Hamilius'));
});

test('find a stop: its number, its name, the name without its mode, unique words', () => {
  assert.deepEqual(findStop(STOPS, '200405060'), {
    id: '200405060',
    name: 'Luxembourg, Gare Centrale',
  });
  // A number the list does not know is still asked to the API.
  assert.deepEqual(findStop(STOPS, '000999999999'), { id: '999999999', name: '999999999' });
  assert.equal(findStop(STOPS, 'luxembourg gare centrale').id, '200405060');
  assert.equal(findStop(STOPS, 'Hamilius').id, '200405020');
  assert.equal(findStop(STOPS, 'philharmonie tram').id, '200417031');
  assert.equal(findStop(STOPS, 'gare centrale'), null, 'three stops hold these words');
  assert.equal(findStop(STOPS, 'Paris'), null);
  assert.equal(findStop(STOPS, ''), null);
});

test('search stops: the closest names first, bounded, with their count', () => {
  const { found, total } = searchStops(STOPS, 'gare centrale');
  assert.equal(total, 3);
  assert.deepEqual(
    found.map((stop) => stop.name),
    [
      'Luxembourg, Gare Centrale',
      'Luxembourg, Gare Centrale (Tram)',
      'Luxembourg, Gare Centrale routière',
    ],
  );
  assert.equal(searchStops(STOPS, 'gare', 2).found.length, 2);
  assert.deepEqual(searchStops(STOPS, '  '), { found: [], total: 0 });
  assert.equal(fold('Esch-sur-Alzette, Gare routière'), 'esch sur alzette gare routiere');
  assert.equal(slug('Kirchberg, P+R Kiem'), 'kirchberg-p-r-kiem');
});

test('the newest zip of the dataset', () => {
  assert.equal(newestZip(DATASET).url, ZIP_URL);
  assert.equal(newestZip({ resources: [{ url: 'http://insecure/x.zip' }] }), null);
  assert.equal(newestZip(null), null);
});

test('the stop list: read once, kept a week, kept when the dataset fails', async () => {
  const clock = { now: NOW };
  const api = fakeAtp();
  const store = createStore({ path: storePath(), logger: silent });
  const stops = createStops({
    store,
    fetch: api,
    now: () => clock.now,
    logger: silent,
    datasetUrl: DATASET_URL,
  });
  assert.equal((await stops.list()).length, 13);
  await stops.list();
  assert.equal(api.calls.length, 2, 'the dataset and the zip, once');
  assert.equal(stops.peekName('200405020'), 'Hamilius (Bus)');
  clock.now += STOPS_MAX_AGE_MS + 1;
  api.state.failDataset = 502;
  assert.equal((await stops.list()).length, 13, 'kept when the dataset fails');
  await assert.rejects(stops.list(true), { kind: 'unreachable' });
  api.state.failDataset = null;
  assert.equal((await stops.search('hamilius')).total, 2);
  assert.equal((await stops.resolve('Hamilius')).id, '200405020');
});

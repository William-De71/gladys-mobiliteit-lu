import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeConfig,
  readLanguage,
  readInterval,
  parseAddedStops,
  DEFAULT_INTERVAL,
  MAX_ADDED_STOPS,
} from '../src/config.js';

test('key, stops, interval and language from the raw config', () => {
  const config = normalizeConfig({
    access_id: ' 0f1e2d3c-key ',
    stop_1: ' Hamilius ',
    stop_1_line: '16',
    stop_1_direction: 'Kirchberg',
    stop_2: '',
    stop_3: '200405060',
    interval: '300',
    language: 'de',
  });
  assert.deepEqual(config, {
    key: '0f1e2d3c-key',
    stops: [
      { slot: 1, stop: 'Hamilius', line: '16', direction: 'Kirchberg' },
      { slot: 3, stop: '200405060', line: '', direction: '' },
    ],
    addedStops: [],
    interval: 300,
    language: 'de',
  });
  assert.deepEqual(normalizeConfig(null), {
    key: '',
    stops: [],
    addedStops: [],
    interval: DEFAULT_INTERVAL,
    language: 'auto',
  });
});

test('bounds: the intervals offered (30 s spends too much of the quota), the stored language', () => {
  assert.equal(readInterval(30), DEFAULT_INTERVAL);
  assert.equal(readInterval(45), DEFAULT_INTERVAL);
  assert.equal(readInterval(600), 600);
  assert.equal(readLanguage({ last_language: 'es' }, 'fr'), 'es');
  assert.equal(readLanguage({ last_language: 'español' }, 'fr'), 'fr');
  assert.equal(readLanguage(undefined, 'en'), 'en');
});

test('the stops added with the buttons follow the three of the form', () => {
  const added = [
    { stop: '200405060', line: 'T1', direction: '' },
    { stop: ' Hamilius ', line: '', direction: 'Kirchberg' },
    { stop: '', line: '16' },
    'Hamilius',
  ];
  const config = normalizeConfig({ stop_2: 'Esch-sur-Alzette, Gare', added_stops: added });
  assert.deepEqual(config.stops, [
    { slot: 2, stop: 'Esch-sur-Alzette, Gare', line: '', direction: '' },
    { slot: null, added: 1, stop: '200405060', line: 'T1', direction: '' },
    { slot: null, added: 2, stop: 'Hamilius', line: '', direction: 'Kirchberg' },
  ]);
  assert.equal(config.addedStops.length, 2);
  // Stored as JSON text by an older core: read the same.
  assert.deepEqual(parseAddedStops(JSON.stringify(added)), config.addedStops);
  assert.deepEqual(parseAddedStops('not json'), []);
  assert.deepEqual(parseAddedStops(undefined), []);
  const many = Array.from({ length: 20 }, (_, n) => ({ stop: `S${n}` }));
  assert.equal(parseAddedStops(many).length, MAX_ADDED_STOPS);
});

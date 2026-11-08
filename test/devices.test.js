// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): a device is only polled with
// should_poll AND poll_frequency, every feature needs min / max / read_only /
// has_feedback, a wrong category / type pair shows no icon nor label, and a
// single invalid field rejects the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  stopKey,
  followedName,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
} from '../src/device.js';
import { parsePassages, boardMessages } from '../src/departures.js';
import { LANGUAGES } from '../src/i18n.js';
import { fakeGladys, NOW, TZ, BOARDS, HAMILIUS, GARE, departure } from './helpers/fixtures.js';

/**
 * @description A followed stop.
 * @param {object} stop - `{ id, name }`.
 * @param {string} line - The typed line.
 * @param {string} direction - The typed direction.
 * @returns {object} The followed stop.
 */
function followed(stop, line, direction) {
  const entry = { stop, line, direction, key: stopKey(stop, line, direction) };
  return { ...entry, name: followedName(entry) };
}

const HAM_16 = followed({ id: HAMILIUS, name: 'Hamilius (Bus)' }, 'Bus 16', 'Kirchberg');
const GARE_ALL = followed({ id: GARE, name: 'Luxembourg, Gare Centrale' }, '', '');
const snapshotOf = (board, entry) => {
  const passages = parsePassages(board, entry);
  return { passages, messages: boardMessages(board, passages) };
};
const devices = (language) => [
  buildStopDevice(fakeGladys, HAM_16, language),
  buildStopDevice(fakeGladys, GARE_ALL, language),
];

test('devices are never polled by Gladys: the integration has its own timer', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max']) {
          assert.equal(typeof feature[key], 'number', `${feature.external_id}.${key}`);
        }
        assert.ok(feature.min <= feature.max, feature.external_id);
        assert.equal(feature.read_only, true, feature.external_id);
        assert.equal(feature.has_feedback, false, feature.external_id);
        assert.ok(feature.name.length > 0 && feature.name.length <= 255);
      }
      const names = new Set(device.features.map((feature) => feature.name));
      assert.equal(names.size, device.features.length, 'every feature has its own name');
    }
  }
});

test('category / type / unit pairs known to the Gladys front, from the SDK constants', () => {
  const [device] = devices('en');
  const pairs = device.features.map((feature) => [feature.category, feature.type, feature.unit]);
  assert.deepEqual(pairs, [
    [DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, undefined],
    [
      DEVICE_FEATURE_CATEGORIES.DURATION,
      DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      DEVICE_FEATURE_UNITS.MINUTES,
    ],
    [
      DEVICE_FEATURE_CATEGORIES.DURATION,
      DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      DEVICE_FEATURE_UNITS.MINUTES,
    ],
    [
      DEVICE_FEATURE_CATEGORIES.DURATION,
      DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      DEVICE_FEATURE_UNITS.MINUTES,
    ],
    [DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, undefined],
  ]);
});

test('ids from the number of the stop, the line and the direction; read back', () => {
  const [ham, gare] = devices('fr');
  assert.equal(ham.external_id, `ext:mobiliteit-lu:stop:${HAMILIUS}_16_kirchberg`);
  assert.equal(ham.name, 'Mobiliteit.lu Hamilius (Bus) (Bus 16 → Kirchberg)');
  assert.deepEqual(ham.params, [
    { name: 'MOBILITEIT_STOP', value: HAMILIUS },
    { name: 'MOBILITEIT_LINE', value: 'Bus 16' },
    { name: 'MOBILITEIT_DIRECTION', value: 'Kirchberg' },
  ]);
  assert.equal(gare.external_id, `ext:mobiliteit-lu:stop:${GARE}`);
  // The same line typed another way is the same device.
  assert.equal(stopKey({ id: HAMILIUS }, 'ligne 16', 'KIRCHBERG'), HAM_16.key);
  assert.equal(stopKey({ id: GARE }, 'RE 11', ''), `${GARE}_re-11`);
  assert.deepEqual(parseExternalId(`ext:mobiliteit-lu:stop:${HAMILIUS}_16_kirchberg:wait`), {
    type: 'stop',
    key: `${HAMILIUS}_16_kirchberg`,
  });
  assert.equal(parseExternalId('something'), null);
});

test('stop states: the next passage, the two waits, the delay, the messages', () => {
  const states = buildStopStates(fakeGladys, HAM_16, snapshotOf(BOARDS[HAMILIUS], HAM_16), {
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  const byKey = Object.fromEntries(
    states.map((state) => [
      state.device_feature_external_id.split(':').pop(),
      state.text ?? state.state,
    ]),
  );
  assert.deepEqual(byKey, {
    next: '16 → Kirchberg, Gare routière · 3 min (+2 min late)',
    wait: 3,
    following: 18,
    delay: 2,
    messages: 1,
  });
  // Night: no passage, the waits and the delay are left untouched.
  const night = buildStopStates(
    fakeGladys,
    HAM_16,
    { passages: [], messages: [] },
    { language: 'fr', now: NOW, timeZone: TZ },
  );
  assert.deepEqual(
    night.map((state) => state.text ?? state.state),
    ['Aucun passage annoncé', 0],
  );
  // The timetable only: no delay published; an early bus counts 0.
  const board = { Departure: [departure({ rtTime: null }), departure({ time: '18:50:00' })] };
  const scheduled = buildStopStates(fakeGladys, GARE_ALL, snapshotOf(board, GARE_ALL), {
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  assert.equal(scheduled[0].text, '16 → Kirchberg, Gare routière · 10 min (timetable)');
  assert.ok(!scheduled.some((state) => state.device_feature_external_id.endsWith(':delay')));
  const early = { Departure: [departure({ time: '18:40:00', rtTime: '18:38:00' })] };
  const earlyStates = buildStopStates(fakeGladys, GARE_ALL, snapshotOf(early, GARE_ALL), {
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  assert.equal(
    earlyStates.find((state) => state.device_feature_external_id.endsWith(':delay')).state,
    0,
  );
});

test('the discovery batch and the states pass the checks of the fake host API', async (t) => {
  const gladys = createFakeGladys({ config: {} });
  t.after(() => gladys.fake.shutdown());
  await gladys.connect();
  const batch = devices('de').map((device) => ({
    ...device,
    external_id: device.external_id.replace('ext:mobiliteit-lu', 'ext:test-integration'),
    features: device.features.map((feature) => ({
      ...feature,
      external_id: feature.external_id.replace('ext:mobiliteit-lu', 'ext:test-integration'),
    })),
  }));
  await gladys.publishDiscoveredDevices(batch);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  const ids = { ...fakeGladys };
  ids.externalIds = (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  });
  const states = buildStopStates(ids, HAM_16, snapshotOf(BOARDS[HAMILIUS], HAM_16), {
    language: 'de',
    now: NOW,
    timeZone: TZ,
  });
  const answer = await gladys.publishChangedStates(states);
  assert.equal(answer.success, true);
  assert.equal(answer.count, states.length);
  assert.equal(
    gladys.fake.lastState(`ext:test-integration:stop:${HAM_16.key}:next`),
    '16 → Kirchberg, Gare routière · 3 Min. (+2 Min. Verspätung)',
  );
});

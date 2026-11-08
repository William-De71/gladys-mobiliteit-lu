// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a
// fake ATP (test/helpers/fixtures.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, SCENE_ACTIONS, ACTIONS, IDLE_INTERVAL_MS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import { HOUR_MS } from '../src/quota.js';
import {
  fakeAtp,
  storePath,
  silent,
  departure,
  NOW,
  TZ,
  KEY,
  HAMILIUS,
  GARE,
  DATASET_URL,
} from './helpers/fixtures.js';

const CONFIG = {
  access_id: KEY,
  stop_1: 'Hamilius',
  stop_1_line: 'Bus 16',
  stop_1_direction: 'Kirchberg',
  stop_2: 'Luxembourg, Gare Centrale',
  stop_3: 'Nulle part',
  interval: '60',
  language: 'fr',
};
const PREFIX = 'ext:test-integration';
const HAM_16 = `${PREFIX}:stop:${HAMILIUS}_16_kirchberg`;
const GARE_ALL = `${PREFIX}:stop:${GARE}`;
const MINUTE = 60 * 1000;

/**
 * @description The integration, connected to a fake Gladys and a fake ATP.
 * @param {object} [options] - `{ config, path, logger, api }`.
 * @returns {Promise<object>} `{ gladys, app, api, clock, path }`.
 */
async function startApp({ config = CONFIG, path = storePath(), logger = silent, api } = {}) {
  const clock = { now: NOW };
  const atp = api ?? fakeAtp();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: atp,
    datasetUrl: DATASET_URL,
    storePath: path,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  return { gladys, app, api: atp, clock, path };
}

const created = async (gladys, externalId) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  assert.ok(device, `${externalId} is offered`);
  await gladys.fake.deviceCreated(device);
  return device;
};
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const boardIds = (api) => api.boardCalls().map((call) => call.query.id);
const message = async (gladys, key, fields) => (await gladys.fake.action(key, fields)).data.message;
const widget = async (gladys, key, options) => {
  const answer = await gladys.fake.widgetGet(key, options);
  assert.equal(answer.success, true);
  return answer.data.content;
};

test('two stops become two devices; an unknown name is reported; one request per stop', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.external_id, device.name]),
    [
      [HAM_16, 'Mobiliteit.lu Hamilius (Bus) (Bus 16 → Kirchberg)'],
      [GARE_ALL, 'Mobiliteit.lu Luxembourg, Gare Centrale'],
    ],
  );
  // The stop list (dataset, newest zip), then one board per stop.
  assert.deepEqual(
    api.calls.map((call) => call.path),
    [
      '/api/1/datasets/horaires-et-arrets-des-transport-publics-gtfs/',
      '/resources/horaires-et-arrets-des-transport-publics-gtfs/20261105-053451/gtfs-20261104-20261212.zip',
      '/opendata/apiserver/departureBoard',
      '/opendata/apiserver/departureBoard',
    ],
  );
  const [first] = api.boardCalls();
  assert.deepEqual(first.query, {
    accessId: KEY,
    id: HAMILIUS,
    format: 'json',
    lang: 'fr',
    duration: '90',
    maxJourneys: '150',
  });
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.equal(
    status.message.fr,
    'Connecté à Mobiliteit.lu : 2 arrêt(s), lus toutes les 60 s (2 requêtes sur 24 h). Inconnu ou ambigu : Nulle part.',
  );
  // The first readings are a baseline: nothing fires.
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('created devices get their states, sent again after the creation', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, HAM_16);
  // 18:30: the 16 of 18:31, expected at 18:33.
  assert.equal(gladys.fake.lastState(`${HAM_16}:wait`), 3);
  assert.equal(gladys.fake.lastState(`${HAM_16}:following`), 18);
  assert.equal(gladys.fake.lastState(`${HAM_16}:delay`), 2);
  assert.equal(
    gladys.fake.lastState(`${HAM_16}:next`),
    '16 → Kirchberg, Gare routière · 3 min (+2 min de retard)',
  );
  assert.equal(gladys.fake.lastState(`${HAM_16}:messages`), 1);
  // Later: a board with only the timetable; the delay is left untouched.
  clock.now += 2 * MINUTE;
  api.state.boards[HAMILIUS].Departure = [departure({ time: '18:45:00', rtTime: null })];
  await app.readStops();
  assert.equal(gladys.fake.lastState(`${HAM_16}:wait`), 13);
  assert.equal(gladys.fake.lastState(`${HAM_16}:delay`), 2);
  assert.equal(
    gladys.fake.lastState(`${HAM_16}:next`),
    '16 → Kirchberg, Gare routière · 13 min (théorique)',
  );
  assert.equal(gladys.fake.lastState(`${HAM_16}:messages`), 0);
  assert.equal(gladys.fake.lastState(`${GARE_ALL}:next`), undefined);
});

test('without a key: the status says how to get one, nothing is asked', async (t) => {
  const { gladys, api, app } = await startApp({ config: { ...CONFIG, access_id: '' } });
  t.after(() => gladys.fake.shutdown());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /opendata-api@atp\.etat\.lu/);
  assert.deepEqual(boardIds(api), []);
  const answer = await message(gladys, ACTIONS.TEST_CONNECTION);
  assert.match(answer.en, /access key/);
  const content = await widget(gladys, WIDGETS.DEPARTURES, { language: 'en' });
  assert.match(content.components[0].text, /access key/);
  await app.readStops({ force: true });
  assert.deepEqual(boardIds(api), []);
});

test('a refused key: disconnected, not asked again until the configuration changes', async (t) => {
  const api = fakeAtp();
  api.state.error = 'auth';
  const { gladys, app, clock } = await startApp({ api });
  t.after(() => gladys.fake.shutdown());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'The API refuses the access key: check it on the Configuration screen.',
  );
  // The second stop is not asked: the key would be refused again.
  assert.deepEqual(boardIds(api), [HAMILIUS]);
  clock.now += 30 * MINUTE;
  await app.readStops();
  assert.deepEqual(boardIds(api), [HAMILIUS]);
  api.state.error = null;
  await gladys.fake.configUpdated({ ...CONFIG, access_id: 'another-key' });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(api.boardCalls().at(-1).query.accessId, 'another-key');
});

test('API_QUOTA: nothing is asked before the next full hour', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  api.state.error = 'quota';
  clock.now += 2 * MINUTE;
  await app.readStops();
  const asked = boardIds(api).length;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /quota de la clé d’accès est épuisé/);
  assert.match(gladys.fake.connectionStatus.message.fr, /19:00/);
  api.state.error = null;
  clock.now += 10 * MINUTE;
  await app.readStops();
  assert.equal(boardIds(api).length, asked, 'still paused at 18:42');
  clock.now = Math.ceil(NOW / HOUR_MS) * HOUR_MS + MINUTE;
  await app.readStops();
  assert.ok(boardIds(api).length > asked, 'read again after 19:00');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the budget of the key: the readings stop under the hourly quota', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  // 449 requests made in the last hour (two at the start included).
  for (let index = 0; index < 447; index += 1) {
    app.quota.record();
  }
  clock.now += 2 * MINUTE;
  await app.readStops();
  // One more request reaches 450: the second stop waits.
  assert.equal(boardIds(api).length, 3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /paused its readings/);
});

test('the interval grows with the stops, and at night', async (t) => {
  const { gladys, app, api, clock } = await startApp({
    config: { access_id: KEY, stop_1: HAMILIUS, interval: '60' },
  });
  t.after(() => gladys.fake.shutdown());
  assert.equal(app.effectiveInterval(), 60);
  // Nothing in the next 45 minutes: the stop is read every 10 minutes.
  api.state.boards[HAMILIUS].Departure = [departure({ time: '19:50:00' })];
  clock.now += 2 * MINUTE;
  await app.readStops();
  const asked = boardIds(api).length;
  clock.now += 2 * MINUTE;
  await app.readStops();
  assert.equal(boardIds(api).length, asked);
  clock.now += IDLE_INTERVAL_MS;
  await app.readStops();
  assert.equal(boardIds(api).length, asked + 1);
  // Ten stops: a day of readings must fit the planned budget.
  await gladys.fake.configUpdated({
    access_id: KEY,
    stop_1: HAMILIUS,
    stop_2: GARE,
    stop_3: '200417031',
    interval: '60',
  });
  assert.equal(app.effectiveInterval(), 72);
});

test('departure soon, delayed, cancelled and new messages fire once', async (t) => {
  const { gladys, app, api, clock } = await startApp({
    config: { access_id: KEY, stop_1: 'Hamilius', stop_1_line: '16', language: 'en' },
  });
  t.after(() => gladys.fake.shutdown());
  const device = `${PREFIX}:stop:${HAMILIUS}_16`;
  const works = {
    id: 'HIM_1',
    act: true,
    head: 'Diversion rue de Strasbourg',
    text: 'Line 16 is diverted.',
    sDate: '2026-11-07',
    sTime: '18:00:00',
    eDate: '2026-11-08',
    eTime: '05:00:00',
  };
  clock.now += MINUTE;
  api.state.boards[HAMILIUS].Departure = [
    departure({ time: '18:43:00', rtTime: '18:49:00', ref: 'trip-a', messages: [works] }),
    departure({ time: '18:50:00', cancelled: true, rtTime: null, ref: 'trip-b' }),
  ];
  await app.readStops({ force: true });
  assert.deepEqual(
    eventsOf(gladys, TRIGGERS.DEPARTURE_DELAYED).map((event) => [
      event.data.minutes,
      event.data.delay_minutes,
      event.data.scheduled_time,
      event.data.time,
    ]),
    [['5', 6, '18:43', '18:49']],
  );
  const cancelled = eventsOf(gladys, TRIGGERS.DEPARTURE_CANCELLED);
  assert.deepEqual(
    cancelled.map((event) => [event.data.line, event.data.time, event.data.stop]),
    [['16', '18:50', device]],
  );
  assert.equal(
    cancelled[0].data.summary,
    'The 18:50 16 towards Kirchberg, Gare routière at Hamilius (Bus) is cancelled.',
  );
  const messages = eventsOf(gladys, TRIGGERS.TRAFFIC_MESSAGE);
  assert.deepEqual(
    messages.map((event) => [event.data.title, event.data.lines, event.data.start]),
    [['Diversion rue de Strasbourg', '16', '07/11 18:00']],
  );
  // 18:44:10, without a reading: the 5-minute mark of the 18:49 bus.
  clock.now = Date.parse('2026-11-07T17:44:10Z');
  await app.checkReminders();
  assert.deepEqual(
    eventsOf(gladys, TRIGGERS.DEPARTURE_SOON).map((event) => [event.data.minutes, event.data.time]),
    [['5', '18:49']],
  );
  await app.checkReminders();
  await app.readStops({ force: true });
  assert.equal(eventsOf(gladys, TRIGGERS.DEPARTURE_SOON).length, 1);
  assert.equal(eventsOf(gladys, TRIGGERS.DEPARTURE_DELAYED).length, 1);
  assert.equal(eventsOf(gladys, TRIGGERS.DEPARTURE_CANCELLED).length, 1);
  assert.equal(eventsOf(gladys, TRIGGERS.TRAFFIC_MESSAGE).length, 1);
});

test('a restart remembers what fired', async (t) => {
  const path = storePath();
  const first = await startApp({ path });
  await first.gladys.fake.shutdown();
  const { gladys } = await startApp({ path });
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('widgets: departures and traffic messages, valid for the core', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const asked = boardIds(api).length;
  const board = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'fr',
    settings: { stop: HAM_16 },
  });
  assert.deepEqual(validateWidgetContent(board), []);
  assert.equal(board.components[0].text, 'Hamilius (Bus) (Bus 16 → Kirchberg)');
  assert.match(board.components[1].text, /^Mobiliteit\.lu \(ATP\) · mis à jour à 18:30$/);
  assert.equal(boardIds(api).length, asked, 'a fresh reading is reused');
  const several = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'en',
    settings: { stops: [HAM_16, GARE_ALL] },
  });
  assert.deepEqual(validateWidgetContent(several), []);
  const typed = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'en',
    settings: { stop_name: 'Hamilius', line: '18' },
  });
  assert.deepEqual(validateWidgetContent(typed), []);
  assert.equal(boardIds(api).length, asked + 1, 'a typed stop is one more request');
  const messages = await widget(gladys, WIDGETS.MESSAGES, { language: 'fr' });
  assert.deepEqual(validateWidgetContent(messages), []);
  const list = messages.components.find((component) => component.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Ascenseur hors service', 'Travaux avenue de la Liberté'],
  );
});

test('scene action: the next departures of a stop', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const answer = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_NEXT_DEPARTURES, {
    stop: HAM_16,
  });
  assert.equal(answer.success, true);
  assert.deepEqual(answer.data.outputs, {
    stop_name: 'Hamilius (Bus) (Bus 16 → Kirchberg)',
    found: true,
    line: '16',
    destination: 'Kirchberg, Gare routière',
    minutes: 3,
    time: '18:33',
    realtime: true,
    delay_minutes: 2,
    following_minutes: 18,
    summary:
      'Prochain passage à Hamilius (Bus) : 16 vers Kirchberg, Gare routière dans 3 min. Le suivant dans 18 min.',
  });
});

test('find, add, list and remove stops; the search spends no request of the key', async (t) => {
  const { gladys, api } = await startApp({ config: { access_id: KEY, stop_1: 'Hamilius' } });
  t.after(() => gladys.fake.shutdown());
  const asked = boardIds(api).length;
  const found = await message(gladys, ACTIONS.SEARCH_STOP, { query: 'gare centrale' });
  assert.match(found.fr, /• Luxembourg, Gare Centrale \[200405060\]/);
  assert.match(found.fr, /• Luxembourg, Gare Centrale \(Tram\) \[200405059\]/);
  assert.equal(boardIds(api).length, asked);
  const none = await message(gladys, ACTIONS.SEARCH_STOP, { query: 'Paris' });
  assert.equal(none.en, 'No stop matches "Paris".');
  const added = await message(gladys, ACTIONS.ADD_STOP, { stop: GARE, line: 'T1' });
  assert.match(added.en, /^Stop added: Luxembourg, Gare Centrale \(T1\)\. 2 stop\(s\) followed/);
  assert.deepEqual(gladys.fake.config.added_stops, [{ stop: GARE, line: 'T1', direction: '' }]);
  assert.ok(
    gladys.fake.discoveredDevices.some((d) => d.external_id === `${PREFIX}:stop:${GARE}_t1`),
  );
  const again = await message(gladys, ACTIONS.ADD_STOP, { stop: GARE, line: 'T1' });
  assert.match(again.en, /already followed/);
  const list = await message(gladys, ACTIONS.LIST_STOPS);
  assert.equal(
    list.en,
    '2 stop(s) followed:\n1. Hamilius (Bus) (form, stop 1)\n2. Luxembourg, Gare Centrale (T1)',
  );
  const inForm = await message(gladys, ACTIONS.REMOVE_STOP, { stop: '1' });
  assert.match(inForm.en, /stop 1 of the form/);
  const removed = await message(gladys, ACTIONS.REMOVE_STOP, { stop: '2' });
  assert.match(removed.en, /^Stop removed: Luxembourg, Gare Centrale \(T1\)/);
  assert.deepEqual(gladys.fake.config.added_stops, []);
});

test('test the connection: stops, departures, quota', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const answer = await message(gladys, ACTIONS.TEST_CONNECTION);
  assert.match(answer.fr, /^Liste des arrêts de l’ATP lue : 13 arrêts · /);
  assert.match(answer.fr, /Hamilius \(Bus\) \(Bus 16 → Kirchberg\) : 4 passage\(s\), prochain 16/);
  assert.match(answer.fr, /inconnu ou ambigu : Nulle part/);
  assert.match(answer.fr, /quota : 4 requêtes la dernière heure, 4 sur 24 h$/);
});

test('the key never appears in the logs, the diagnostic or an error', async (t) => {
  const lines = [];
  const logger = {
    info: (...args) => lines.push(args.join(' ')),
    warn: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.map(String).join(' ')),
    debug() {},
  };
  const api = fakeAtp();
  api.state.failBoard = 'network';
  const { gladys } = await startApp({ logger, api });
  t.after(() => gladys.fake.shutdown());
  api.state.failBoard = null;
  api.state.error = 'auth';
  await message(gladys, ACTIONS.TEST_CONNECTION);
  const answer = await message(gladys, ACTIONS.DIAGNOSTIC);
  assert.match(answer.en, /Mobiliteit\.lu diagnostic/);
  assert.ok(lines.some((line) => line.includes('Mobiliteit.lu diagnostic 1/')));
  assert.ok(lines.some((line) => line.includes(`set (${KEY.length} characters)`)));
  for (const line of lines) {
    assert.ok(!line.includes(KEY), line);
  }
});

test('the stop list cannot be read: a stop typed by its number still works', async (t) => {
  const api = fakeAtp();
  api.state.failDataset = 502;
  const { gladys } = await startApp({
    api,
    config: { access_id: KEY, stop_1: HAMILIUS, stop_2: 'Hamilius' },
  });
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Mobiliteit.lu 200405020'],
  );
  assert.deepEqual(boardIds(api), [HAMILIUS]);
});

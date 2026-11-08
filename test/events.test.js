// Scene triggers fire once per transition, with flat payloads within the
// limits of the core; scene actions return their declared outputs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  detectReminders,
  detectCancellations,
  detectDelays,
  detectMessages,
  reminderData,
  cancelledData,
  delayedData,
  messageData,
  nextDeparturesOutputs,
  pick,
  tolerance,
  TRIGGERS,
  REMINDER_MINUTES,
  NEXT_DEPARTURES_OUTPUTS,
} from '../src/events.js';
import { parsePassages, boardMessages } from '../src/departures.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, TZ, BOARDS, HAMILIUS, departure } from './helpers/fixtures.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const FOLLOWED = {
  name: 'Hamilius (Bus) (16)',
  deviceId: `ext:mobiliteit-lu:stop:${HAMILIUS}_16`,
  stop: { id: HAMILIUS, name: 'Hamilius (Bus)' },
};
const MINUTE = 60 * 1000;
const at = (time, rtTime = time, extra = {}) =>
  parsePassages({ Departure: [departure({ time, rtTime, ...extra })] });

/**
 * @description Assert that event data is flat and within the limits of the core.
 * @param {object} data - The data.
 * @param {string} key - The trigger key.
 */
function assertPayload(data, key) {
  const trigger = manifest.scene_triggers.find((entry) => entry.key === key);
  assert.ok(trigger, key);
  assert.ok(Object.keys(data).length <= 30);
  for (const [name, value] of Object.entries(data)) {
    assert.ok(
      value === null || ['string', 'number', 'boolean'].includes(typeof value),
      `${key}.${name}`,
    );
    if (typeof value === 'string') {
      assert.ok(value.length <= 1000, `${key}.${name}`);
    }
  }
  // Every variable is in the data, and every field filters a key of it.
  for (const variable of trigger.variables) {
    assert.ok(variable.key in data, `${key}: variable ${variable.key}`);
  }
  for (const field of trigger.fields) {
    assert.ok(field.key in data, `${key}: field ${field.key}`);
  }
}

test('reminders: once per passage and mark, never on the first reading', () => {
  // 18:34:40: 4 min 40 s after 18:30.
  const passages = at('18:34:40');
  const first = detectReminders({ passages, fired: undefined, now: NOW });
  assert.deepEqual(first.due, []);
  assert.equal(first.fired.length, 1);
  const memory = detectReminders({ passages, fired: [], now: NOW });
  assert.deepEqual(
    memory.due.map((entry) => entry.mark),
    [5],
  );
  assert.deepEqual(detectReminders({ passages, fired: memory.fired, now: NOW + 10000 }).due, []);
  // The same trip announced later (a delay) is the same passage: no new 5.
  const later = at('18:34:40', '18:35:20');
  assert.deepEqual(detectReminders({ passages: later, fired: memory.fired, now: NOW }).due, []);
  const forgotten = detectReminders({ passages: [], fired: memory.fired, now: NOW + 20 * MINUTE });
  assert.deepEqual(forgotten.fired, []);
  assert.deepEqual(REMINDER_MINUTES.map(tolerance), [1, 1, 1.5, 3, 3, 3]);
});

test('cancellations: once per trip, within the hour, never on the first reading', () => {
  const passages = parsePassages({
    Departure: [
      departure({ time: '18:45:00', rtTime: null, cancelled: true, ref: 'a' }),
      departure({ time: '19:45:00', rtTime: null, cancelled: true, ref: 'b' }),
      departure({ time: '18:50:00', ref: 'c' }),
    ],
  });
  assert.deepEqual(detectCancellations({ passages, known: undefined, now: NOW }).due, []);
  const first = detectCancellations({ passages, known: [], now: NOW });
  assert.deepEqual(
    first.due.map((passage) => passage.trip),
    ['a'],
  );
  assert.deepEqual(detectCancellations({ passages, known: first.known, now: NOW }).due, []);
  for (const language of LANGUAGES) {
    assertPayload(
      cancelledData(FOLLOWED, first.due[0], { language, timeZone: TZ }),
      TRIGGERS.DEPARTURE_CANCELLED,
    );
  }
  assert.equal(
    cancelledData(FOLLOWED, first.due[0], { language: 'fr', timeZone: TZ }).summary,
    'Le 16 de 18:45 vers Kirchberg, Gare routière à Hamilius (Bus) est supprimé.',
  );
});

test('delays: the highest mark reached, once per trip and mark, within the hour', () => {
  const late = at('18:40:00', '18:46:00', { ref: 'late' });
  assert.deepEqual(detectDelays({ passages: late, known: undefined, now: NOW }).due, []);
  const first = detectDelays({ passages: late, known: [], now: NOW });
  assert.deepEqual(
    first.due.map(({ passage, mark }) => [passage.trip, mark]),
    [['late', 5]],
  );
  assert.deepEqual(detectDelays({ passages: late, known: first.known, now: NOW }).due, []);
  // Later 11 minutes late: the 10-minute mark, once.
  const worse = at('18:40:00', '18:51:00', { ref: 'late' });
  const second = detectDelays({ passages: worse, known: first.known, now: NOW });
  assert.deepEqual(
    second.due.map(({ mark }) => mark),
    [10],
  );
  // The timetable only, on time, or beyond the hour: nothing.
  for (const passages of [
    at('18:40:00', null),
    at('18:40:00', '18:41:00'),
    at('19:45:00', '19:55:00'),
  ]) {
    assert.deepEqual(detectDelays({ passages, known: [], now: NOW }).due, []);
  }
  for (const language of LANGUAGES) {
    const data = delayedData(FOLLOWED, late[0], 5, { language, timeZone: TZ });
    assertPayload(data, TRIGGERS.DEPARTURE_DELAYED);
    assert.deepEqual(
      [data.minutes, data.delay_minutes, data.scheduled_time, data.time],
      ['5', 6, '18:40', '18:46'],
    );
  }
  assert.equal(
    delayedData(FOLLOWED, late[0], 5, { language: 'en', timeZone: TZ }).summary,
    'The 18:40 16 towards Kirchberg, Gare routière at Hamilius (Bus) is 6 min late: expected at 18:46.',
  );
});

test('traffic messages: the new ones, never on the first reading, remembered a week', () => {
  const board = BOARDS[HAMILIUS];
  const messages = boardMessages(board, parsePassages(board));
  assert.deepEqual(detectMessages({ messages, seen: undefined, now: NOW }).due, []);
  const first = detectMessages({ messages, seen: {}, now: NOW });
  assert.deepEqual(
    first.due.map((message) => message.id),
    ['HIM_FREETEXT_118734'],
  );
  assert.deepEqual(detectMessages({ messages, seen: first.seen, now: NOW }).due, []);
  // Gone for a moment, then back: not fired again within the week.
  const gone = detectMessages({ messages: [], seen: first.seen, now: NOW + MINUTE });
  assert.deepEqual(detectMessages({ messages, seen: gone.seen, now: NOW + 2 * MINUTE }).due, []);
  for (const language of LANGUAGES) {
    assertPayload(
      messageData(FOLLOWED, first.due[0], { language, timeZone: TZ }),
      TRIGGERS.TRAFFIC_MESSAGE,
    );
  }
  const data = messageData(FOLLOWED, first.due[0], { language: 'fr', timeZone: TZ });
  assert.deepEqual(
    [data.lines, data.start, data.end, data.summary],
    [
      '16, 18',
      '03/11 05:00',
      '20/11 23:59',
      'Info trafic à Hamilius (Bus) (16, 18) : Travaux avenue de la Liberté',
    ],
  );
});

test('departure soon: a flat payload, its summary in every language', () => {
  const [passage] = at('18:35:00', '18:38:00');
  for (const language of LANGUAGES) {
    const data = reminderData(FOLLOWED, passage, 5, { language, timeZone: TZ });
    assertPayload(data, TRIGGERS.DEPARTURE_SOON);
    assert.deepEqual([data.minutes, data.time, data.delay_minutes], ['5', '18:38', 3]);
  }
  assert.equal(
    reminderData(FOLLOWED, passage, 5, { language: 'fr', timeZone: TZ }).summary,
    '16 vers Kirchberg, Gare routière passe à Hamilius (Bus) dans 5 min (18:38, 3 min de retard).',
  );
});

test('scene action outputs: declared keys only, flat values', () => {
  const declared = manifest.scene_actions
    .find((action) => action.key === 'get_next_departures')
    .outputs.map((output) => output.key);
  assert.deepEqual(NEXT_DEPARTURES_OUTPUTS, declared);
  const passages = parsePassages({
    Departure: [
      departure({ time: '18:36:00', rtTime: '18:38:00', ref: 'a' }),
      departure({ time: '18:51:00', rtTime: null, ref: 'b' }),
    ],
  });
  const next = pick(
    nextDeparturesOutputs({ followed: FOLLOWED, passages, now: NOW, language: 'en', timeZone: TZ }),
    NEXT_DEPARTURES_OUTPUTS,
  );
  assert.deepEqual(
    [
      next.found,
      next.line,
      next.minutes,
      next.time,
      next.realtime,
      next.delay_minutes,
      next.following_minutes,
    ],
    [true, '16', 8, '18:38', true, 2, 21],
  );
  assert.equal(
    next.summary,
    'Next passage at Hamilius (Bus): 16 towards Kirchberg, Gare routière in 8 min. The following one in 21 min.',
  );
  const none = nextDeparturesOutputs({
    followed: FOLLOWED,
    passages: [],
    now: NOW,
    language: 'en',
    timeZone: TZ,
  });
  assert.deepEqual([none.found, none.minutes, none.time, none.realtime], [false, -1, '', false]);
  assert.equal(none.summary, 'No passage announced at Hamilius (Bus).');
  for (const value of Object.values(next)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
});

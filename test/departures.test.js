import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  asList,
  boardInstant,
  directionTerms,
  typedLine,
  modeOf,
  messageOf,
  parsePassages,
  boardMessages,
  minutesLeft,
  upcomingPassages,
  cancelledPassages,
  routeOf,
} from '../src/departures.js';
import { NOW, BOARDS, HAMILIUS, GARE, departure } from './helpers/fixtures.js';

test('dates and times of the board: Luxembourg wall clock, its offset when given', () => {
  assert.equal(boardInstant('2026-11-07', '18:42:00', 60), Date.parse('2026-11-07T17:42:00Z'));
  assert.equal(boardInstant('2026-11-07', '18:42'), Date.parse('2026-11-07T17:42:00Z'));
  // Summer time, without `tz`: Europe/Luxembourg.
  assert.equal(boardInstant('2026-07-01', '08:00:00'), Date.parse('2026-07-01T06:00:00Z'));
  assert.equal(boardInstant('2026-07-01', '08:00:00', 120), Date.parse('2026-07-01T06:00:00Z'));
  assert.equal(boardInstant('', '08:00'), null);
  assert.equal(boardInstant('2026-07-01', '8h'), null);
});

test('a departure: its line, destination, real-time estimate and delay', () => {
  const [first] = parsePassages(BOARDS[HAMILIUS]);
  assert.deepEqual(
    {
      line: first.line,
      mode: first.mode,
      destination: first.destination,
      scheduled: new Date(first.scheduled).toISOString(),
      at: new Date(first.at).toISOString(),
      realtime: first.realtime,
      delay: first.delay,
      cancelled: first.cancelled,
      trip: first.trip,
    },
    {
      line: '16',
      mode: 'bus',
      destination: 'Kirchberg, Gare routière',
      scheduled: '2026-11-07T17:31:00.000Z',
      at: '2026-11-07T17:33:00.000Z',
      realtime: true,
      delay: 2,
      cancelled: false,
      trip: '1|80161|0|82|7112026',
    },
  );
  // The timetable only: no delay, the scheduled time. Early: a negative delay.
  const [planned, early] = parsePassages({
    Departure: [
      departure({ rtTime: null }),
      departure({ time: '18:50:00', rtTime: '18:48:00', ref: 'x' }),
    ],
  });
  assert.deepEqual([planned.realtime, planned.delay], [false, 0]);
  assert.equal(planned.at, planned.scheduled);
  assert.equal(early.delay, -2);
});

test('the modes and labels of the lines: bus, Luxtram, trains', () => {
  const passages = parsePassages(BOARDS[GARE]);
  assert.deepEqual(
    passages.map((passage) => [passage.line, passage.mode, passage.cancelled, passage.track]),
    [
      ['T1', 'tram', false, ''],
      ['RE 11', 'train', false, '3'],
      ['RB 60', 'train', true, '7'],
      ['T1', 'tram', false, ''],
      ['RE 11', 'train', false, '3'],
    ],
  );
  assert.equal(modeOf({ catOut: 'Tram' }), 'tram');
  assert.equal(modeOf({ catOutL: 'Regional-Express' }), 'train');
  assert.equal(modeOf({}), 'bus');
});

test('the filters: a line typed any way, a mode alone, words of the destination', () => {
  const ham = BOARDS[HAMILIUS];
  const lines = (filter) => [...new Set(parsePassages(ham, filter).map((p) => p.line))];
  assert.deepEqual(lines({ line: '16' }), ['16']);
  assert.deepEqual(lines({ line: 'Bus 16' }), ['16']);
  assert.deepEqual(lines({ line: 'ligne 302' }), ['302']);
  assert.deepEqual(lines({ line: '1' }), []);
  assert.equal(parsePassages(ham, { line: '16', direction: 'Kirchberg' }).length, 4);
  assert.equal(parsePassages(ham, { line: '16', direction: 'centrale | strassen' }).length, 2);
  const gare = BOARDS[GARE];
  assert.equal(parsePassages(gare, { line: 'tram' }).length, 2);
  assert.equal(parsePassages(gare, { line: 'T1' }).length, 2);
  assert.equal(parsePassages(gare, { line: 'RE 11' }).length, 2);
  assert.equal(parsePassages(gare, { line: 'train' }).length, 3);
  assert.equal(typedLine('Tram T1'), 't1');
  assert.deepEqual(directionTerms('Kirchberg | Findel'), ['kirchberg', 'findel']);
});

test('a list of one may come as an object; an empty board', () => {
  assert.deepEqual(asList(undefined), []);
  assert.deepEqual(asList({ a: 1 }), [{ a: 1 }]);
  const single = { Departure: departure() };
  assert.equal(parsePassages(single).length, 1);
  assert.deepEqual(parsePassages({}), []);
  assert.deepEqual(parsePassages(null), []);
});

test('traffic messages: of the trips and of the board, once each, with their lines', () => {
  const ham = BOARDS[HAMILIUS];
  const passages = parsePassages(ham);
  const [works] = boardMessages(ham, passages);
  assert.deepEqual(works.lines, ['16', '18']);
  assert.equal(works.title, 'Travaux avenue de la Liberté');
  assert.match(works.text, /^Déviation des lignes 16 et 18\. En raison de travaux/);
  assert.equal(works.start, Date.parse('2026-11-03T04:00:00Z'));
  assert.equal(works.end, Date.parse('2026-11-20T22:59:00Z'));
  // Only the messages of the departures kept: none for the 302.
  assert.deepEqual(boardMessages(ham, parsePassages(ham, { line: '302' })), []);
  const gare = BOARDS[GARE];
  assert.deepEqual(
    boardMessages(gare, parsePassages(gare)).map((message) => [message.title, message.lines]),
    [['Ascenseur hors service', []]],
  );
  // Inactive or empty messages are left out; a message without a title takes
  // the first sentence of its text.
  assert.equal(messageOf({ id: '1', act: false, head: 'Old' }), null);
  assert.equal(messageOf({ id: '2' }), null);
  assert.equal(messageOf({ id: '3', text: 'Bus dévié. Arrêt reporté.' }).title, 'Bus dévié.');
});

test('waits, upcoming and cancelled passages, routes', () => {
  const passages = parsePassages(BOARDS[HAMILIUS]);
  const upcoming = upcomingPassages(passages, NOW);
  assert.equal(upcoming.length, 9);
  assert.equal(minutesLeft(upcoming[0], NOW), 3);
  assert.deepEqual(
    cancelledPassages(passages, NOW).map((passage) => passage.line),
    ['30'],
  );
  assert.equal(routeOf(upcoming[0]), '16|kirchberg gare routiere');
});

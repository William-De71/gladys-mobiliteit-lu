// The widget contents pass the validator of the SDK (what the core would
// drop or truncate), in every language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildDeparturesWidget,
  buildMessagesWidget,
  messageContent,
  readCount,
  routeValue,
  shortDate,
  dateText,
  BOARD_COUNT,
} from '../src/widgets.js';
import { parsePassages, boardMessages } from '../src/departures.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, TZ, BOARDS, HAMILIUS, GARE, departure } from './helpers/fixtures.js';

const HAM = parsePassages(BOARDS[HAMILIUS]);
const GARE_PASSAGES = parsePassages(BOARDS[GARE]);
const MINUTE = 60 * 1000;

/**
 * @description Assert that the core would keep the content whole.
 * @param {object} content - The content.
 * @param {string} label - For the message.
 */
function assertValid(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], label);
}

test('departures widget: one compact row per route, soonest first, in every language', () => {
  for (const language of LANGUAGES) {
    const content = buildDeparturesWidget({
      title: 'Hamilius (Bus)',
      passages: HAM,
      readAt: NOW,
      count: 6,
      language,
      now: NOW,
      timeZone: TZ,
    });
    assertValid(content, language);
  }
  const content = buildDeparturesWidget({
    title: 'Hamilius (Bus)',
    passages: HAM,
    readAt: NOW,
    count: 6,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  const [heading, caption, status] = content.components;
  assert.equal(heading.text, 'Hamilius (Bus)');
  assert.equal(caption.text, 'Mobiliteit.lu (ATP) · mis à jour à 18:30');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    // The last passages of a long row are dropped; a route with only a
    // cancelled trip (the 30) has no row: its cancellation fires a scene.
    [
      ['16 → Kirchberg, Gare routière', '3 · 18 · 21 min', 'success'],
      ['18 → Kirchberg, Gare routière', '4 min', 'success'],
      ['16 → Luxembourg, Gare Centrale', '6 · 36 min', 'success'],
      ['302 → Kirchberg, Gare routière', '14 min', 'success'],
      ['18 → Luxembourg, Gare Centrale', '22 min', 'success'],
    ],
  );
});

test('departures widget: trains and trams, a cancelled train colours its row', () => {
  const content = buildDeparturesWidget({
    title: 'Luxembourg, Gare Centrale',
    passages: GARE_PASSAGES,
    readAt: NOW,
    count: 6,
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'gare');
  const rows = content.components[2].items.map((item) => [item.label, item.value, item.color]);
  assert.deepEqual(rows, [
    ['T1 → Kirchberg, Luxexpo', '7 · 16 min', 'success'],
    ['RE 11 → Troisvierges, Gare', '9 · 35 min', 'success'],
  ]);
});

test('departures widget: times beyond an hour, nothing announced', () => {
  const far = parsePassages({ Departure: [departure({ time: '19:45:00', rtTime: null })] });
  const content = buildDeparturesWidget({
    title: 'Hamilius (Bus)',
    passages: far,
    readAt: NOW,
    count: 6,
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'far');
  assert.equal(content.components[2].items[0].value, '19:45');
  const empty = buildDeparturesWidget({
    title: 'Hamilius (Bus)',
    passages: [],
    readAt: NOW,
    count: 6,
    language: 'de',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(empty, 'empty');
  assert.equal(
    empty.components[1].text,
    'Keine Abfahrt angekündigt. Mobiliteit.lu (ATP) · aktualisiert um 18:30.',
  );
  assert.equal(routeValue([], { language: 'en', now: NOW, timeZone: TZ }), '');
});

test('departures widget: several stops in one list, a row per stop then its routes', () => {
  const content = buildDeparturesWidget({
    boards: [
      { title: 'Hamilius (Bus) (16)', label: 'Hamilius (Bus)', passages: HAM, readAt: NOW },
      {
        title: 'Luxembourg, Gare Centrale',
        passages: GARE_PASSAGES,
        readAt: NOW - MINUTE,
      },
    ],
    count: 6,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'several');
  const [heading, caption, status] = content.components;
  assert.equal(heading.text, 'Hamilius (Bus) · Luxembourg, Gare Centr…');
  assert.equal(caption.text, 'Mobiliteit.lu (ATP)');
  assert.deepEqual(
    status.items.filter((item) => item.icon === 'map-pin').map((item) => item.value),
    ['lu à 18:30', 'lu à 18:29'],
  );
});

test('messages widget: one card per message, its stops, lines and period', () => {
  const boards = [
    { name: 'Hamilius (Bus)', messages: boardMessages(BOARDS[HAMILIUS], HAM), readAt: NOW },
    {
      name: 'Luxembourg, Gare Centrale',
      messages: boardMessages(BOARDS[GARE], GARE_PASSAGES),
      readAt: NOW,
    },
  ];
  for (const language of LANGUAGES) {
    assertValid(buildMessagesWidget({ boards, language, now: NOW, timeZone: TZ }), language);
  }
  const content = buildMessagesWidget({ boards, language: 'fr', now: NOW, timeZone: TZ });
  const list = content.components[1];
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge?.text]),
    [
      [
        'Ascenseur hors service',
        'Luxembourg, Gare Centrale · 06/11 06:00 → 10/11 20:00',
        undefined,
      ],
      ['Travaux avenue de la Liberté', 'Hamilius (Bus) · 03/11 05:00 → 20/11 23:59', '16 · 18'],
    ],
  );
  assert.equal(content.components[2].text, 'Mobiliteit.lu (ATP) · mis à jour à 18:30');
  const none = buildMessagesWidget({
    boards: [{ name: 'Hamilius (Bus)', messages: [], readAt: NOW }],
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(none, 'none');
  assert.equal(
    none.components[1].text,
    'No traffic message for the followed stops. Mobiliteit.lu (ATP) · updated at 18:30.',
  );
});

test('messages and settings', () => {
  assertValid(messageContent('Hello'), 'message');
  assert.equal(readCount(undefined, BOARD_COUNT), BOARD_COUNT.default);
  assert.equal(readCount('99', BOARD_COUNT), BOARD_COUNT.max);
  assert.equal(readCount(0, BOARD_COUNT), BOARD_COUNT.min);
  assert.equal(shortDate(Date.parse('2026-12-31T22:59:00Z'), TZ), '31/12');
  assert.equal(shortDate(null, TZ), '');
  assert.equal(dateText(Date.parse('2026-11-07T15:48:00Z'), NOW, TZ), '16:48');
  assert.equal(dateText(Date.parse('2026-11-06T20:31:00Z'), NOW, TZ), '06/11 21:31');
  assert.equal(dateText(null, NOW, TZ), '');
});

// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// "Mobiliteit.lu <stop> (<line> → <direction>)": one per followed stop.
// Read-only features:
//   - `next`        text: the next passage, "16 → Kirchberg · 3 min (+2 min late)";
//   - `wait`        duration (minutes): the wait of the next passage;
//   - `following`   duration (minutes): the wait of the one after;
//   - `delay`       duration (minutes): the delay of the next passage, when
//                   it is followed in real time (an early one counts 0);
//   - `messages`    counter: the traffic messages about the departures of
//                   the stop (as filtered by line and direction).
//
// External ids: the HAFAS id of the stop, then the typed line and direction
// as slugs (`ext:mobiliteit-lu:stop:200405060_16_kirchberg`).
// `should_poll` stays false: the integration reads on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { t, passageText } from './i18n.js';
import { slug } from './stops.js';
import { typedLine, minutesLeft, upcomingPassages } from './departures.js';

const DEVICE_TYPES = { STOP: 'stop' };
const FEATURE_KEYS = {
  NEXT: 'next',
  WAIT: 'wait',
  FOLLOWING: 'following',
  DELAY: 'delay',
  MESSAGES: 'messages',
};
const MAX_WAIT = 180;
const MAX_DELAY = 120;
const MAX_COUNT = 20;
const TEXT_MAX = 250;

/**
 * @description The identifier of a followed stop.
 * @param {{ id: string }} stop - The resolved stop.
 * @param {string} line - The line typed, '' when none.
 * @param {string} direction - The direction typed, '' when none.
 * @returns {string} "200405060_16_kirchberg".
 * @example
 * stopKey({ id: '200405060' }, 'Bus 16', ''); // '200405060_16'
 */
function stopKey(stop, line, direction) {
  const parts = [String(stop.id)];
  const lineSlug = line ? slug(typedLine(line), 16) : '';
  if (lineSlug) {
    parts.push(lineSlug);
  }
  const words = slug(direction, 24);
  if (words) {
    parts.push(words);
  }
  return parts.join('_');
}

/**
 * @description The name of a followed stop: "Hamilius (16 → Kirchberg)".
 * @param {object} followed - `{ stop, line, direction }`.
 * @returns {string} The name.
 */
function followedName({ stop, line, direction }) {
  const detail = [line, direction && `→ ${direction}`].filter(Boolean).join(' ');
  return detail ? `${stop.name} (${detail})` : stop.name;
}

/**
 * @description The external ids of a followed stop.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} key - The stop key.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const idsOf = (gladys, key) => gladys.externalIds(DEVICE_TYPES.STOP, String(key).toLowerCase());

/**
 * @description What a device external id stands for.
 * @param {unknown} externalId - A device (or feature) external id.
 * @returns {{ type: string, key: string }|null} The type and key.
 * @example
 * parseExternalId('ext:mobiliteit-lu:stop:200405060_16'); // { type: 'stop', key: '200405060_16' }
 */
function parseExternalId(externalId) {
  // A feature id ends with ":<feature key>": the device key stops before it.
  const match = /:(stop):([a-z0-9_-]+)(?::[a-z_]+)?$/.exec(String(externalId ?? ''));
  return match ? { type: match[1], key: match[2] } : null;
}

/**
 * @description A read-only feature.
 * @param {object} feature - Its fields.
 * @returns {object} The feature.
 */
const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});

const textShape = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  keep_history: false,
  min: 0,
  max: 0,
};
const minutesShape = {
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.MINUTES,
  keep_history: false,
  min: 0,
  max: MAX_WAIT,
};
const delayShape = {
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.MINUTES,
  keep_history: true,
  min: 0,
  max: MAX_DELAY,
};
const counterShape = {
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  min: 0,
  max: MAX_COUNT,
};

/**
 * @description Build the device of a followed stop.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} followed - The followed stop (`key`, `name`, `stop`, `line`).
 * @param {string} [language] - Language of the names.
 * @returns {object} The discovered device.
 */
function buildStopDevice(gladys, followed, language = 'en') {
  const ids = idsOf(gladys, followed.key);
  const params = [{ name: 'MOBILITEIT_STOP', value: followed.stop.id }];
  if (followed.line) {
    params.push({ name: 'MOBILITEIT_LINE', value: followed.line });
  }
  if (followed.direction) {
    params.push({ name: 'MOBILITEIT_DIRECTION', value: followed.direction });
  }
  return {
    name: t('stopDeviceName', language, { stop: followed.name }),
    external_id: ids.device,
    model: 'Mobiliteit.lu',
    should_poll: false,
    params,
    features: [
      sensor({
        name: t('featureNext', language),
        external_id: ids.feature(FEATURE_KEYS.NEXT),
        ...textShape,
      }),
      sensor({
        name: t('featureWait', language),
        external_id: ids.feature(FEATURE_KEYS.WAIT),
        ...minutesShape,
      }),
      sensor({
        name: t('featureFollowing', language),
        external_id: ids.feature(FEATURE_KEYS.FOLLOWING),
        ...minutesShape,
      }),
      sensor({
        name: t('featureDelay', language),
        external_id: ids.feature(FEATURE_KEYS.DELAY),
        ...delayShape,
      }),
      sensor({
        name: t('featureMessages', language),
        external_id: ids.feature(FEATURE_KEYS.MESSAGES),
        ...counterShape,
      }),
    ],
  };
}

/**
 * @description The states of a followed stop. Without a passage (the night),
 * the waits are left untouched: a 0 would fake a bus now; the delay too
 * when the next passage is the timetable only.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} followed - The followed stop.
 * @param {object} snapshot - Its last reading: `{ passages, messages }`.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object[]} The states.
 */
function buildStopStates(gladys, followed, snapshot, { language, now, timeZone }) {
  const ids = idsOf(gladys, followed.key);
  const upcoming = upcomingPassages(snapshot.passages, now);
  const states = [
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.NEXT),
      text: (upcoming[0]
        ? passageText(upcoming[0], { language, now, timeZone })
        : t('noPassage', language)
      ).slice(0, TEXT_MAX),
    },
  ];
  [FEATURE_KEYS.WAIT, FEATURE_KEYS.FOLLOWING].forEach((key, index) => {
    if (upcoming[index]) {
      states.push({
        device_feature_external_id: ids.feature(key),
        state: Math.min(MAX_WAIT, minutesLeft(upcoming[index], now)),
      });
    }
  });
  if (upcoming[0]?.realtime) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_KEYS.DELAY),
      state: Math.min(MAX_DELAY, Math.max(0, upcoming[0].delay)),
    });
  }
  states.push({
    device_feature_external_id: ids.feature(FEATURE_KEYS.MESSAGES),
    state: Math.min(MAX_COUNT, (snapshot.messages ?? []).length),
  });
  return states;
}

export {
  DEVICE_TYPES,
  FEATURE_KEYS,
  MAX_WAIT,
  MAX_DELAY,
  MAX_COUNT,
  stopKey,
  followedName,
  idsOf,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
};

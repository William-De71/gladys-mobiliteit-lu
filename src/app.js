// -----------------------------------------------------------------------------
// The Mobiliteit.lu integration: every handler, registered on a Gladys client.
//
// Brings the buses, trams and trains of Luxembourg into Gladys through the
// official real-time API of the Administration des transports publics (the
// one behind mobiliteit.lu, a personal key):
//   - devices (device.js): one per followed stop — the three of the form and
//     the ones added with the "Add a stop" button, filtered by line and
//     direction — with the next passage, the waits, the delay and the count
//     of traffic messages;
//   - scene triggers (events.js): departure soon, departure cancelled,
//     departure delayed, new traffic message;
//   - scene action: read the next passages of a stop;
//   - dashboard widgets (widgets.js): departures, traffic messages.
//
// The API has no push: each followed stop is read (one request per stop id,
// one after the other) on the integration's own timer, never on a Gladys
// poll: every `interval` (1 to 10 min, 2 min by default), made longer when
// the stops would spend the quota of the key (quota.js), every 10 min while
// no stop announces anything in the next 45 minutes (at night). The names of
// the stops come from the open GTFS of the ATP, kept in /data (stops.js).
// Transport: cloud only.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK (test/app.test.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
  MAX_ADDED_STOPS,
} from './config.js';
import { createHafasClient } from './hafas-api.js';
import { createStops, fold } from './stops.js';
import { createStore, DEFAULT_PATH } from './store.js';
import { createQuota, minimumInterval } from './quota.js';
import { parsePassages, boardMessages, upcomingPassages, routeOf } from './departures.js';
import {
  DEVICE_TYPES,
  stopKey,
  followedName,
  idsOf,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
} from './device.js';
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
  TRIGGERS,
  NEXT_DEPARTURES_OUTPUTS,
} from './events.js';
import {
  WIDGETS,
  BOARD_COUNT,
  messageContent,
  readCount,
  buildDeparturesWidget,
  buildMessagesWidget,
} from './widgets.js';
import { defaultTimeZone, formatTime, MINUTE_MS } from './time.js';
import { t, all, passageWhen, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  SEARCH_STOP: 'search_stop',
  ADD_STOP: 'add_stop',
  REMOVE_STOP: 'remove_stop',
  LIST_STOPS: 'list_stops',
  DIAGNOSTIC: 'diagnostic',
};
const SCENE_ACTIONS = {
  GET_NEXT_DEPARTURES: 'get_next_departures',
};
// While no stop announces anything in QUIET_HORIZON_MS (the night), the stops
// are read this often.
const IDLE_INTERVAL_MS = 10 * MINUTE_MS;
const QUIET_HORIZON_MS = 45 * MINUTE_MS;
const REMINDER_TICK_MS = 30 * 1000;
const TIMER_TICK_MS = 30 * 1000;
// A widget or a scene action reuses a reading this fresh: each new reading
// spends a request of the key.
const SNAPSHOT_MAX_AGE_MS = 2 * MINUTE_MS;
const BOARD_MAX_AGE_MS = 2 * MINUTE_MS;
// Names that could not be resolved for a network reason are tried again.
const RESOLVE_RETRY_MS = 15 * MINUTE_MS;
const DIAGNOSTIC_CHUNK = 3000;
const ACTION_TEXT_MAX = 1500;
const API_LANGUAGES = ['fr', 'de', 'en'];
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * @description Cut a text of several lines at a line break, under a bound.
 * @param {string} text - The text.
 * @param {number} max - The bound.
 * @returns {string} The whole lines that fit, then "…".
 */
function clipLines(text, max) {
  if (text.length <= max) {
    return text;
  }
  const cut = text.lastIndexOf('\n', max - 2);
  return `${text.slice(0, cut > 0 ? cut : max - 2)}\n…`;
}

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {string} [options.datasetUrl] - The GTFS dataset API URL (tests).
 * @param {string} [options.storePath] - The file kept in /data.
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of the times (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timers (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    datasetUrl,
    storePath = DEFAULT_PATH,
    now = () => Date.now(),
    timeZone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  let config = normalizeConfig();
  // The raw values last read, internal keys included: the base of setConfig.
  let rawConfig = {};
  // The stops added with the buttons, one change at a time.
  let writingStops = Promise.resolve();
  // Language of the last widget request: the fallback of the texts Gladys does
  // not ask for in a language, when the `language` setting is `auto`. French
  // until a widget is shown: the language of the stop names.
  let language = 'fr';
  let createdDevices = new Set();
  // The followed stops, resolved, and what the stop list does not know.
  let stops = [];
  // config.stops[i] -> its followed stop (null when unknown), for
  // "List the stops".
  let entries = [];
  let notFound = [];
  // stop key -> { passages, messages, readAt } of its last reading; the last
  // error of the reading of the stops.
  const snapshots = new Map();
  let stopsError = null;
  let stopsReadAt = 0;
  // typed stop -> { passages, messages, readAt }, for the widgets of other stops.
  const boards = new Map();
  let resolveError = null;
  let lastStatus = null;
  let lastDiscovery = null;
  let stopTimer = null;
  let reminderTimer = null;
  let resolveTimer = null;
  let readingStops = null;
  let stopped = false;

  const api = createHafasClient({
    now,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
  const store = createStore({ path: storePath, logger });
  const quota = createQuota({ store, now });
  const stopList = createStops({
    store,
    now,
    logger,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(datasetUrl ? { datasetUrl } : {}),
  });

  /**
   * @description Remember the language of a request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (typeof next !== 'string' || !/^[a-z]{2}$/.test(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  /**
   * @description Language asked to the API (the traffic messages).
   * @returns {string} fr, de or en.
   */
  const apiLanguage = () => (API_LANGUAGES.includes(textLanguage()) ? textLanguage() : 'en');

  /**
   * @description The message of an error, for a user.
   * @param {Error} err - The error.
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    const key = {
      busy: 'errorBusy',
      auth: 'errorAuth',
      quota: 'errorQuota',
      budget: 'errorQuota',
      no_key: 'errorNoKey',
      unknown_stop: 'errorUnknownStop',
    }[err?.kind];
    if (err?.name === 'StopsError') {
      return t('errorStops', lang);
    }
    return t(key ?? 'errorUnreachable', lang);
  }

  /**
   * @description The ids of the followed stops, each read once per round.
   * @returns {string[]} The ids.
   */
  const stopIds = () => [...new Set(stops.map((followed) => followed.stop.id))];

  /**
   * @description The reading interval actually used: the one chosen, made
   * longer when the stops would spend the quota of the key.
   * @returns {number} Seconds.
   */
  const effectiveInterval = () => Math.max(config.interval, minimumInterval(stopIds().length));

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const signature = JSON.stringify([connected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status from the last readings.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!config.key) {
      await reportStatus(false, all('statusNoKey'));
      return;
    }
    if (stopsError?.kind === 'auth') {
      await reportStatus(false, all('statusAuth'));
      return;
    }
    const blocked = quota.blockedUntil();
    if (blocked) {
      await reportStatus(false, all('statusQuota', { time: formatTime(blocked, timeZone) }));
      return;
    }
    if (stopsError?.kind === 'budget') {
      await reportStatus(true, all('statusBudget', quota.usage()));
      return;
    }
    if (resolveError || (stops.length && stopsError)) {
      const err = stopsError ?? resolveError;
      await reportStatus(
        false,
        all('statusUnreachable', {
          detail: String(err?.message ?? '').slice(0, 80),
          minutes: Math.round(effectiveInterval() / 60) || 1,
        }),
      );
      return;
    }
    const unknown = notFound.length
      ? (l) => ` ${t('statusNotFound', l, { names: notFound.join(', ') })}`
      : () => '';
    if (stops.length === 0) {
      await reportStatus(
        true,
        Object.fromEntries(LANGUAGES.map((l) => [l, `${t('statusNothing', l)}${unknown(l)}`])),
      );
      return;
    }
    const { day } = quota.usage();
    await reportStatus(
      true,
      Object.fromEntries(
        LANGUAGES.map((l) => [
          l,
          `${t('statusConnected', l, { stops: stops.length, interval: effectiveInterval(), day })}${unknown(l)}`,
        ]),
      ),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   * @param {string[]} keys - The widget keys.
   */
  function refreshWidgets(keys) {
    for (const key of keys) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`${data.stop_name}: ${key}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- The departure board -----------------------------------------------------------

  /**
   * @description Read the board of one stop, within the quota of the key.
   * @param {string} stopId - The HAFAS id.
   * @returns {Promise<object>} The board.
   */
  async function readBoard(stopId) {
    const allowed = quota.allow();
    if (!allowed.ok) {
      const err = new Error(`quota of the key kept (${allowed.reason})`);
      err.kind = allowed.reason === 'blocked' ? 'quota' : 'budget';
      throw err;
    }
    quota.record();
    try {
      return await api.departureBoard({ key: config.key, stopId, language: apiLanguage() });
    } catch (err) {
      if (err.kind === 'quota') {
        quota.block();
      }
      throw err;
    }
  }

  // --- Stops -------------------------------------------------------------------------

  /**
   * @description Resolve one stop of the configuration.
   * @param {object} entry - `{ slot, added, stop, line, direction }`.
   * @returns {Promise<object>} The followed stop, or `{ unknown }`: the typed
   * stop the list does not know (or words fitting several stops).
   */
  async function resolveEntry(entry) {
    const stop = await stopList.resolve(entry.stop);
    if (!stop) {
      return { unknown: entry.stop };
    }
    const key = stopKey(stop, entry.line, entry.direction);
    const followed = {
      slot: entry.slot,
      added: entry.added ?? null,
      stop,
      line: entry.line,
      direction: entry.direction,
      key,
    };
    return {
      ...followed,
      name: followedName(followed),
      deviceId: idsOf(gladys, key).device,
    };
  }

  /**
   * @description Resolve the configured stops. A name that cannot be
   * resolved because the stop list is out of reach is tried again later; the
   * other stops are followed meanwhile.
   * @returns {Promise<void>}
   */
  async function resolveConfig() {
    clearTimeout(resolveTimer);
    const resolvedStops = [];
    const resolvedEntries = [];
    const unknown = [];
    let failure = null;
    for (const entry of config.stops) {
      let followed;
      try {
        followed = await resolveEntry(entry);
      } catch (err) {
        // The stop list cannot be read: this name waits; a number still works.
        failure = err;
        resolvedEntries.push(null);
        continue;
      }
      if (followed.unknown) {
        unknown.push(followed.unknown);
        resolvedEntries.push(null);
        continue;
      }
      const known = resolvedStops.find((other) => other.key === followed.key);
      if (!known) {
        resolvedStops.push(followed);
      }
      resolvedEntries.push(known ?? followed);
    }
    resolveError = failure;
    if (failure) {
      logger.warn(`Unable to read the stop list (${failure.kind ?? 'error'}): ${failure.message}`);
      if (timers && !stopped) {
        resolveTimer = setTimeout(() => {
          applyConfig().catch(() => {});
        }, RESOLVE_RETRY_MS);
        resolveTimer.unref?.();
      }
    }
    stops = resolvedStops;
    entries = resolvedEntries;
    notFound = unknown;
    for (const key of [...snapshots.keys()]) {
      if (!stops.some((followed) => followed.key === key)) {
        snapshots.delete(key);
      }
    }
  }

  /**
   * @description Offer a device per stop on the Discovery screen, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = stops.map((followed) => buildStopDevice(gladys, followed, lang));
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  // --- Reading the stops -------------------------------------------------------------

  /**
   * @description Publish the states of a stop, when its device exists.
   * @param {object} followed - The followed stop.
   * @returns {Promise<void>}
   */
  async function publishStopStates(followed) {
    const snapshot = snapshots.get(followed.key);
    if (!snapshot || !createdDevices.has(followed.deviceId)) {
      return;
    }
    await gladys
      .publishChangedStates(
        buildStopStates(gladys, followed, snapshot, {
          language: textLanguage(),
          now: now(),
          timeZone,
        }),
      )
      .catch((err) =>
        logger.warn(`Unable to publish the states of ${followed.name}: ${err.message}`),
      );
  }

  /**
   * @description The events due on the last reading of a stop: reminders,
   * cancellations, delays (and, right after a reading, new messages).
   * @param {object} followed - The followed stop.
   * @param {object} [options] - `{ messages }`: look at the messages too.
   * @returns {object[]} The events.
   */
  function stopEvents(followed, { messages = false } = {}) {
    const snapshot = snapshots.get(followed.key);
    if (!snapshot) {
      return [];
    }
    const options = { language: textLanguage(), timeZone };
    const { seen } = store.data;
    const current = now();
    seen.cancelled ??= {};
    seen.delayed ??= {};
    seen.messages ??= {};
    const cancellations = detectCancellations({
      passages: snapshot.passages,
      known: seen.cancelled[followed.key],
      now: current,
    });
    seen.cancelled[followed.key] = cancellations.known;
    const delays = detectDelays({
      passages: snapshot.passages,
      known: seen.delayed[followed.key],
      now: current,
    });
    seen.delayed[followed.key] = delays.known;
    const reminders = detectReminders({
      passages: snapshot.passages,
      fired: seen.reminders[followed.key],
      now: current,
    });
    seen.reminders[followed.key] = reminders.fired;
    const events = [
      ...cancellations.due.map((passage) => ({
        key: TRIGGERS.DEPARTURE_CANCELLED,
        data: cancelledData(followed, passage, options),
      })),
      ...delays.due.map(({ passage, mark }) => ({
        key: TRIGGERS.DEPARTURE_DELAYED,
        data: delayedData(followed, passage, mark, options),
      })),
      ...reminders.due.map(({ passage, mark }) => ({
        key: TRIGGERS.DEPARTURE_SOON,
        data: reminderData(followed, passage, mark, options),
      })),
    ];
    if (messages) {
      const fresh = detectMessages({
        messages: snapshot.messages,
        seen: seen.messages[followed.key],
        now: current,
      });
      seen.messages[followed.key] = fresh.seen;
      events.push(
        ...fresh.due.map((message) => ({
          key: TRIGGERS.TRAFFIC_MESSAGE,
          data: messageData(followed, message, options),
        })),
      );
    }
    return events;
  }

  /**
   * @description What follows a reading of a stop: events, states.
   * @param {object} followed - The followed stop.
   * @returns {Promise<void>}
   */
  async function digestStop(followed) {
    const events = gladys.connected !== false ? stopEvents(followed, { messages: true }) : [];
    await store.save();
    await publishEvents(events);
    await publishStopStates(followed);
  }

  /**
   * @description A snapshot of a board for one followed (or typed) stop.
   * @param {object} board - The board.
   * @param {object} filter - `{ line, direction }`.
   * @param {number} readAt - The time of the reading.
   * @returns {object} `{ passages, messages, readAt }`.
   */
  function snapshotOf(board, { line = '', direction = '' }, readAt) {
    const passages = parsePassages(board, { line, direction });
    return { passages, messages: boardMessages(board, passages), readAt };
  }

  /**
   * @description Read some followed stops now: one request per stop id, one
   * after the other (two devices of one stop share a request). A stop that
   * fails keeps its last reading; the error is thrown once the others are done.
   * @param {object[]} list - The followed stops.
   * @returns {Promise<void>}
   */
  async function readFollowed(list) {
    let failure = null;
    const read = [];
    for (const id of [...new Set(list.map((followed) => followed.stop.id))]) {
      try {
        const board = await readBoard(id);
        const readAt = now();
        for (const followed of list.filter((item) => item.stop.id === id)) {
          snapshots.set(followed.key, snapshotOf(board, followed, readAt));
          read.push(followed);
        }
      } catch (err) {
        failure = err;
        // The key is refused or the quota spent: the other stops would fail too.
        if (['auth', 'quota', 'budget', 'no_key'].includes(err.kind)) {
          break;
        }
      }
    }
    stopsError = failure;
    if (read.length > 0) {
      stopsReadAt = now();
    }
    await store.save();
    for (const followed of read) {
      await digestStop(followed);
    }
    if (failure) {
      throw failure;
    }
  }

  /**
   * @description Whether the stops are due for a reading.
   * @returns {boolean} True when due.
   */
  function stopsDue() {
    if (quota.blockedUntil()) {
      return false;
    }
    const age = now() - stopsReadAt;
    if (stopsError) {
      // A refused key is not asked again before the configuration changes;
      // a failure is tried again at the next interval, not at each tick.
      return stopsError.kind !== 'auth' && age >= effectiveInterval() * 1000 - 1000;
    }
    if (stops.some((followed) => !snapshots.has(followed.key))) {
      return true;
    }
    // At night no stop announces anything soon: read them less often.
    const quiet = stops.every((followed) =>
      upcomingPassages(snapshots.get(followed.key).passages, now()).every(
        (passage) => passage.at - now() > QUIET_HORIZON_MS,
      ),
    );
    const interval = effectiveInterval() * 1000;
    return age >= (quiet ? Math.max(IDLE_INTERVAL_MS, interval) : interval) - 1000;
  }

  /**
   * @description Read every followed stop when due (one reading at a time).
   * @param {object} [options] - `{ force }`: read even when not due.
   * @returns {Promise<void>}
   */
  function readStops({ force = false } = {}) {
    if (!readingStops) {
      readingStops = (async () => {
        if (config.key && stops.length > 0 && (force || stopsDue())) {
          try {
            await readFollowed(stops);
            refreshWidgets(Object.values(WIDGETS));
          } catch (err) {
            logger.warn(`Mobiliteit.lu stops (${err.kind ?? 'error'}): ${err.message}`);
          }
        }
        await refreshStatus();
      })().finally(() => {
        readingStops = null;
      });
    }
    return readingStops;
  }

  /**
   * @description The snapshots of followed stops, read again (together) when
   * older than `maxAgeMs`. A stop that cannot be read again keeps its last
   * reading when it has one.
   * @param {object[]} list - The followed stops.
   * @param {number} maxAgeMs - The freshness wanted.
   * @returns {Promise<object[]>} Their snapshots, in the same order.
   */
  async function snapshotsOf(list, maxAgeMs) {
    const stale = list.filter((followed) => {
      const snapshot = snapshots.get(followed.key);
      return !snapshot || now() - snapshot.readAt > maxAgeMs;
    });
    if (stale.length > 0) {
      try {
        await readFollowed(stale);
      } catch (err) {
        if (list.some((followed) => !snapshots.has(followed.key))) {
          throw err;
        }
      }
    }
    return list.map((followed) => snapshots.get(followed.key));
  }

  /**
   * @description Check the reminders on the last readings (between readings).
   * @returns {Promise<void>}
   */
  async function checkReminders() {
    // Disconnected, the event would be lost while marked as fired.
    if (gladys.connected === false) {
      return;
    }
    const events = stops.flatMap((followed) => stopEvents(followed));
    if (events.length) {
      await store.save();
      await publishEvents(events);
    }
  }

  // --- Timers ------------------------------------------------------------------------

  /**
   * @description (Re)arm the timers.
   */
  function schedule() {
    clearInterval(stopTimer);
    clearInterval(reminderTimer);
    if (!timers || stopped) {
      return;
    }
    // A short tick: stopsDue() decides whether the stops are due.
    stopTimer = setInterval(() => {
      readStops().catch((err) => logger.error('Stops', err));
    }, TIMER_TICK_MS);
    reminderTimer = setInterval(() => {
      checkReminders().catch((err) => logger.warn(`Reminders: ${err.message}`));
    }, REMINDER_TICK_MS);
    [stopTimer, reminderTimer].forEach((timer) => timer.unref?.());
  }

  /**
   * @description Resolve the configuration, offer the devices, read everything.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await resolveConfig();
    logger.info(
      `${stops.length} stop(s): ${stops.map((followed) => followed.name).join(', ') || 'none'}` +
        (notFound.length ? `; unknown: ${notFound.join(', ')}` : '') +
        `; interval ${effectiveInterval()} s`,
    );
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await readStops({ force: stops.some((followed) => !snapshots.has(followed.key)) });
    await refreshStatus();
    schedule();
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The followed stop a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object|null} The followed stop, the first one by default.
   */
  function target(externalId) {
    const parsed = parseExternalId(externalId);
    const found =
      parsed?.type === DEVICE_TYPES.STOP ? stops.find((item) => item.key === parsed.key) : null;
    return found ?? stops[0] ?? null;
  }

  /**
   * @description The passages of a stop typed in a widget.
   * @param {string} typed - The stop.
   * @param {string} typedLine - Its optional line.
   * @param {string} lang - The language.
   * @returns {Promise<object>} `{ title, passages, readAt }` or `{ message }`.
   */
  async function typedBoard(typed, typedLine, lang) {
    const stop = await stopList.resolve(typed);
    if (!stop) {
      return { message: t('statusNotFound', lang, { names: typed.slice(0, 60) }) };
    }
    const key = stopKey(stop, typedLine, '');
    let board = boards.get(key);
    if (!board || now() - board.readAt > BOARD_MAX_AGE_MS) {
      const raw = await readBoard(stop.id);
      board = snapshotOf(raw, { line: typedLine }, now());
      boards.set(key, board);
    }
    return { title: followedName({ stop, line: typedLine, direction: '' }), ...board };
  }

  /**
   * @description The followed stops chosen in a `multi_select` setting.
   * @param {unknown} raw - Device external ids.
   * @returns {object[]} The followed stops, in the order chosen.
   */
  function chosenStops(raw) {
    const ids = Array.isArray(raw) ? raw : [];
    const chosen = [];
    for (const id of ids) {
      const parsed = parseExternalId(id);
      const followed =
        parsed?.type === DEVICE_TYPES.STOP ? stops.find((item) => item.key === parsed.key) : null;
      if (followed && !chosen.includes(followed)) {
        chosen.push(followed);
      }
    }
    return chosen;
  }

  /**
   * @description The boards of several followed stops, grouped by stop: the
   * devices of one stop (one per line and direction) make one board.
   * @param {object[]} chosen - The followed stops.
   * @returns {Promise<object[]>} `[{ title, label, passages, readAt }]`.
   */
  async function followedBoards(chosen) {
    const groups = new Map();
    for (const followed of chosen) {
      groups.set(followed.stop.id, [...(groups.get(followed.stop.id) ?? []), followed]);
    }
    await snapshotsOf(chosen, SNAPSHOT_MAX_AGE_MS);
    const result = [];
    for (const members of groups.values()) {
      const read = members.map((followed) => snapshots.get(followed.key)).filter(Boolean);
      if (read.length === 0) {
        continue;
      }
      // A route of two chosen devices (all the lines and one of them) once.
      const passages = new Map();
      for (const passage of read.flatMap((snapshot) => snapshot.passages)) {
        passages.set(`${routeOf(passage)}|${passage.scheduled}`, passage);
      }
      const [first] = members;
      result.push({
        title: members.length > 1 ? first.stop.name : first.name,
        label: first.stop.name,
        passages: [...passages.values()].sort((a, b) => a.at - b.at),
        readAt: Math.min(...read.map((snapshot) => snapshot.readAt)),
      });
    }
    return result;
  }

  gladys.onWidgetGet(WIDGETS.DEPARTURES, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const count = readCount(settings.count, BOARD_COUNT);
    const typed = typeof settings.stop_name === 'string' ? settings.stop_name.trim() : '';
    const typedLine = typeof settings.line === 'string' ? settings.line.trim() : '';
    if (!config.key) {
      return messageContent(t('statusNoKey', lang));
    }
    try {
      let board;
      if (typed) {
        board = await typedBoard(typed, typedLine, lang);
        if (board.message) {
          return messageContent(board.message);
        }
      } else {
        const several = await followedBoards(chosenStops(settings.stops));
        if (several.length > 1) {
          board = { boards: several };
        } else if (several.length === 1) {
          board = several[0];
        } else {
          const followed = target(settings.stop);
          if (!followed) {
            return messageContent(t('widgetNoStop', lang));
          }
          const [snapshot] = await snapshotsOf([followed], SNAPSHOT_MAX_AGE_MS);
          board = { title: followed.name, ...snapshot };
        }
      }
      return buildDeparturesWidget({ ...board, count, language: lang, now: now(), timeZone });
    } catch (err) {
      logger.warn(`Widget: unable to read the passages: ${err.message}`);
      return messageContent(errorText(err, lang), 60);
    }
  });

  gladys.onWidgetGet(WIDGETS.MESSAGES, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    if (!config.key) {
      return messageContent(t('statusNoKey', lang));
    }
    const chosen = chosenStops(settings.stops);
    const list = chosen.length > 0 ? chosen : stops;
    if (list.length === 0) {
      return messageContent(t('widgetNoStop', lang));
    }
    try {
      const read = await snapshotsOf(list, SNAPSHOT_MAX_AGE_MS);
      return buildMessagesWidget({
        boards: list.map((followed, index) => ({
          name: followed.stop.name,
          messages: read[index]?.messages ?? [],
          readAt: read[index]?.readAt,
        })),
        language: lang,
        now: now(),
        timeZone,
      });
    } catch (err) {
      logger.warn(`Widget: unable to read the messages: ${err.message}`);
      return messageContent(errorText(err, lang), 60);
    }
  });

  // --- Scene action ------------------------------------------------------------------
  gladys.onSceneAction(SCENE_ACTIONS.GET_NEXT_DEPARTURES, async (fields = {}) => {
    const followed = target(fields.stop);
    if (!followed) {
      throw new Error('No Mobiliteit.lu stop is followed');
    }
    const [snapshot] = await snapshotsOf([followed], SNAPSHOT_MAX_AGE_MS);
    return pick(
      nextDeparturesOutputs({
        followed,
        passages: snapshot.passages,
        now: now(),
        language: textLanguage(),
        timeZone,
      }),
      NEXT_DEPARTURES_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    const messages = [];
    if (!config.key) {
      await refreshStatus();
      return all('statusNoKey');
    }
    try {
      const known = await stopList.list(true);
      messages.push(all('testStopsOk', { stops: known.length }));
    } catch (err) {
      messages.push(all('testStopsError', (l) => ({ error: errorText(err, l) })));
    }
    await resolveConfig();
    await publishDiscoveredDevices().catch(() => {});
    let failure = null;
    if (stops.length > 0) {
      try {
        await readFollowed(stops);
      } catch (err) {
        failure = err;
      }
    } else {
      messages.push(all('testNoStop'));
    }
    for (const followed of stops) {
      const snapshot = snapshots.get(followed.key);
      if (!snapshot || (failure && now() - snapshot.readAt > SNAPSHOT_MAX_AGE_MS)) {
        messages.push(
          all('testStopError', (l) => ({ stop: followed.name, error: errorText(failure, l) })),
        );
        continue;
      }
      const [first] = upcomingPassages(snapshot.passages, now());
      messages.push(
        all('testStop', (l) => ({
          stop: followed.name,
          count: snapshot.passages.length,
          next: first
            ? `${first.line} ${passageWhen(first, { language: l, now: now(), timeZone })}`
            : '–',
        })),
      );
    }
    notFound.forEach((name) => messages.push(all('unknownEntry', { name })));
    messages.push(all('testQuota', quota.usage()));
    refreshWidgets(Object.values(WIDGETS));
    await refreshStatus();
    return Object.fromEntries(
      LANGUAGES.map((l) => [
        l,
        messages
          .map((entry) => entry[l])
          .join(' · ')
          .slice(0, 1000),
      ]),
    );
  });

  gladys.onAction(ACTIONS.SEARCH_STOP, async (fields = {}) => {
    const query = typeof fields.query === 'string' ? fields.query.trim() : '';
    if (query.length < 2) {
      return all('searchTooShort');
    }
    let result;
    try {
      result = await stopList.search(query);
    } catch (err) {
      return all('testStopsError', (l) => ({ error: errorText(err, l) }));
    }
    if (result.found.length === 0) {
      return all('searchNone', { query: query.slice(0, 60) });
    }
    const list = result.found.map((stop) => `• ${stop.name} [${stop.id}]`).join('\n');
    const more = result.total - result.found.length;
    return all('searchFound', (l) => ({
      list: clipLines(
        more > 0 ? `${list}\n${t('searchMore', l, { n: more })}` : list,
        ACTION_TEXT_MAX - 200,
      ),
    }));
  });

  // --- Stops added with the buttons -------------------------------------------------

  const field = (value) => (typeof value === 'string' ? value.trim() : '');

  /**
   * @description Change the added stops, one change after the other: two quick
   * buttons never lose a stop. Applied in memory once Gladys saved it.
   * @param {Function} change - `(added) => Promise<{ next?, message }>`: the new
   * list (none: nothing to save) and the answer, or a function of nothing
   * giving it once the stops are read.
   * @returns {Promise<object>} The answer.
   */
  function changeAddedStops(change) {
    const run = writingStops.then(async () => {
      const { next, message } = await change(config.addedStops);
      if (next) {
        await gladys.setConfig({ [INTERNAL_KEYS.addedStops]: next });
        rawConfig = { ...rawConfig, [INTERNAL_KEYS.addedStops]: next };
        config = normalizeConfig(rawConfig);
        await resolveConfig();
        await publishDiscoveredDevices().catch((err) =>
          logger.warn(`Unable to offer the devices: ${err.message}`),
        );
        // Only the new stop is due: it has no reading yet.
        const fresh = stops.filter((followed) => !snapshots.has(followed.key));
        if (config.key && fresh.length > 0) {
          await readFollowed(fresh).catch((err) =>
            logger.warn(`Mobiliteit.lu stop (${err.kind ?? 'error'}): ${err.message}`),
          );
          await refreshStatus();
        }
      }
      return typeof message === 'function' ? message() : message;
    });
    writingStops = run.catch(() => {});
    return run;
  }

  /**
   * @description How a stop of the configuration reads in "List the stops".
   * @param {object} entry - A stop of `config.stops`.
   * @param {number} index - Its position.
   * @param {string} lang - The language.
   * @returns {string} "2. Hamilius (16) (formulaire, arrêt 2)".
   */
  function entryText(entry, index, lang) {
    const followed = entries[index];
    const typed = [entry.stop, entry.line, entry.direction && `→ ${entry.direction}`]
      .filter(Boolean)
      .join(' ');
    const notes = [
      entry.slot ? t('stopFromForm', lang, { slot: entry.slot }) : '',
      entries.length && !followed ? t('stopUnknownMark', lang) : '',
    ].filter(Boolean);
    const name = followed?.name ?? typed;
    return `${index + 1}. ${name}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  }

  gladys.onAction(ACTIONS.ADD_STOP, async (fields = {}) => {
    const entry = {
      stop: field(fields.stop),
      line: field(fields.line),
      direction: field(fields.direction),
    };
    if (entry.stop.length < 2) {
      return all('searchTooShort');
    }
    return changeAddedStops(async (added) => {
      if (added.length >= MAX_ADDED_STOPS) {
        return { message: all('stopsFull', { max: MAX_ADDED_STOPS }) };
      }
      let followed;
      try {
        followed = await resolveEntry(entry);
      } catch (err) {
        return { message: all('testStopsError', (l) => ({ error: errorText(err, l) })) };
      }
      if (followed.unknown) {
        return { message: all('statusNotFound', { names: followed.unknown.slice(0, 60) }) };
      }
      if (stops.some((other) => other.key === followed.key)) {
        return { message: all('stopAlreadyFollowed', { name: followed.name }) };
      }
      // Stored as resolved: the id of the stop.
      const stored = { stop: followed.stop.id, line: entry.line, direction: entry.direction };
      logger.info(`Stop added: ${followed.name}`);
      return {
        next: [...added, stored],
        message: () => all('stopAdded', { name: followed.name, count: stops.length }),
      };
    });
  });

  gladys.onAction(ACTIONS.REMOVE_STOP, async (fields = {}) => {
    const query = field(fields.stop);
    if (!query) {
      return all('stopRemoveUnknown', { query });
    }
    return changeAddedStops(async () => {
      const number =
        /^#?\d+$/.test(query) && query.length <= 3 ? Number(query.replace('#', '')) : null;
      let found;
      if (number !== null) {
        found = config.stops[number - 1] ? [number - 1] : [];
      } else {
        const wanted = fold(query);
        found = config.stops
          .map((entry, index) => ({ entry, index, followed: entries[index] }))
          .filter(
            ({ entry, followed }) =>
              fold(entry.stop) === wanted ||
              (followed && (fold(followed.name) === wanted || fold(followed.stop.name) === wanted)),
          )
          .map(({ index }) => index);
        // The same name in the form and in the added stops: the added one.
        const fromButtons = found.filter((index) => !config.stops[index].slot);
        found = fromButtons.length > 0 ? fromButtons : found;
      }
      if (found.length === 0) {
        return { message: all('stopRemoveUnknown', { query: query.slice(0, 60) }) };
      }
      if (found.length > 1) {
        return { message: all('stopRemoveAmbiguous', { query: query.slice(0, 60) }) };
      }
      const entry = config.stops[found[0]];
      const name = entries[found[0]]?.name ?? entry.stop;
      if (entry.slot) {
        return { message: all('stopInForm', { name, slot: entry.slot }) };
      }
      logger.info(`Stop removed: ${name}`);
      return {
        next: config.addedStops.filter((_, index) => index !== entry.added - 1),
        message: all('stopRemoved', { name }),
      };
    });
  });

  gladys.onAction(ACTIONS.LIST_STOPS, async () => {
    if (config.stops.length === 0) {
      return all('stopsNone');
    }
    return all('stopsList', (l) => ({
      count: config.stops.length,
      list: clipLines(
        config.stops.map((entry, index) => entryText(entry, index, l)).join('\n'),
        ACTION_TEXT_MAX - 100,
      ),
    }));
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const report = {
      version: VERSION,
      timeZone: timeZone ?? null,
      key: config.key ? `set (${config.key.length} characters)` : 'missing',
      interval: config.interval,
      effectiveInterval: effectiveInterval(),
      language: config.language,
      stops: stops.map((followed) => {
        const snapshot = snapshots.get(followed.key);
        return {
          slot: followed.slot,
          added: followed.added,
          key: followed.key,
          stop: followed.stop,
          line: followed.line || null,
          direction: followed.direction,
          created: createdDevices.has(followed.deviceId),
          readAt: snapshot ? new Date(snapshot.readAt).toISOString() : null,
          messages: snapshot?.messages.length ?? null,
          passages: snapshot?.passages
            .slice(0, 6)
            .map(
              (p) =>
                `${p.line}>${p.destination} ${new Date(p.at).toISOString().slice(11, 16)}Z` +
                `${p.cancelled ? ' cancelled' : p.realtime ? ` ${p.delay >= 0 ? '+' : ''}${p.delay}` : ' sched'}`,
            ),
        };
      }),
      stopsError: stopsError ? `${stopsError.kind ?? 'error'}: ${stopsError.message}` : null,
      notFound,
      quota: { ...quota.usage(), blockedUntil: quota.blockedUntil() || null },
      stopList: {
        count: store.data.stops.list?.length ?? null,
        readAt: store.data.stops.readAt ? new Date(store.data.stops.readAt).toISOString() : null,
        source: store.data.stops.source,
      },
      resolveError: resolveError?.message ?? null,
      requests: api.requests,
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `Mobiliteit.lu diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    await resolveConfig();
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    for (const followed of stops) {
      await publishStopStates(followed);
    }
    refreshWidgets(Object.values(WIDGETS));
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      rawConfig = raw ?? {};
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        // The form values may lack the internal keys: never forget the added
        // stops, the next button would save the list without them.
        rawConfig = {
          [INTERNAL_KEYS.addedStops]: rawConfig[INTERNAL_KEYS.addedStops],
          ...fallback,
        };
        config = normalizeConfig(rawConfig);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (raw) => {
    await loadConfig(raw);
    lastDiscovery = null;
    boards.clear();
    snapshots.clear();
    stopsError = null;
    logger.info('Configuration updated');
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await loadConfig();
      await store.load();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(stopTimer);
    clearInterval(reminderTimer);
    clearTimeout(resolveTimer);
    await store.save();
  });

  return {
    store,
    api,
    quota,
    readStops,
    checkReminders,
    applyConfig,
    effectiveInterval,
    getConfig: () => config,
    getStops: () => stops,
    getSnapshot: (key) => snapshots.get(key),
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, SCENE_ACTIONS, IDLE_INTERVAL_MS, SNAPSHOT_MAX_AGE_MS };

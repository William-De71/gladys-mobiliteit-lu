// -----------------------------------------------------------------------------
// Scene triggers (pure logic) and scene action outputs.
//
// Triggers (one event per transition, never a periodic snapshot):
//   - `departure_soon`      a bus, tram or train of a followed stop leaves in
//                           N minutes (2, 3, 5, 10, 15 or 20), counted on its
//                           real-time estimate: checked on each reading and
//                           every 30 seconds on the last one, fired close to
//                           the mark, once per passage. A passage is matched by
//                           its trip, or by line, destination and time (± 2 min);
//   - `departure_cancelled` a passage of a followed stop in the next hour is
//                           cancelled, once per trip;
//   - `departure_delayed`   the real-time delay of a passage of a followed
//                           stop in the next hour reaches N minutes (3, 5, 10
//                           or 15), once per trip and mark;
//   - `traffic_message`     a new traffic message about the departures of a
//                           followed stop (works, diversion, disruption).
//
// What was seen is kept in /data (`seen`): a restart never fires the same
// event twice, and the first reading of a stop is a baseline (no event
// replays what was already there). A scene action or a widget never fires an
// event.
// -----------------------------------------------------------------------------

import { t, passageWhen } from './i18n.js';
import { routeOf, minutesLeft, upcomingPassages, cancelledPassages } from './departures.js';
import { formatTime, localClock } from './time.js';

const TRIGGERS = {
  DEPARTURE_SOON: 'departure_soon',
  DEPARTURE_CANCELLED: 'departure_cancelled',
  DEPARTURE_DELAYED: 'departure_delayed',
  TRAFFIC_MESSAGE: 'traffic_message',
};
const REMINDER_MINUTES = [2, 3, 5, 10, 15, 20];
const DELAY_MARKS = [3, 5, 10, 15];
// A delay is reported for a passage due within this time.
const DELAY_HORIZON_MS = 60 * 60 * 1000;
const REMINDER_MATCH_MS = 2 * 60 * 1000;
const REMINDER_KEEP_MS = 10 * 60 * 1000;
// A cancelled passage is reported when it was due within this time.
const CANCELLED_HORIZON_MS = 60 * 60 * 1000;
const CANCELLED_KEEP_MS = 3 * 60 * 60 * 1000;
// A message seen is remembered this long after it disappeared: a message the
// API drops for a moment (or shows only with some trips) must not fire again.
const MESSAGE_KEEP_MS = 7 * 24 * 3600 * 1000;
// At most this many new messages fire per stop and reading.
const MAX_MESSAGES_PER_STOP = 5;
const SUMMARY_MAX = 1000;
const MESSAGE_MAX = 1000;
const OUTPUT_MAX = 10000;
const NEXT_DEPARTURES_OUTPUTS = [
  'stop_name',
  'found',
  'line',
  'destination',
  'minutes',
  'time',
  'realtime',
  'delay_minutes',
  'following_minutes',
  'summary',
];

/**
 * @description Truncate a text, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description How close to a mark a reminder may fire (minutes before it).
 * @param {number} mark - The mark (minutes).
 * @returns {number} The tolerance: the marks never overlap.
 */
function tolerance(mark) {
  if (mark <= 3) {
    return 1;
  }
  return mark <= 5 ? 1.5 : 3;
}

/**
 * @description The reminders due on the passages of a stop.
 * @param {object} options - Options.
 * @param {object[]} options.passages - The passages of the stop.
 * @param {object[]} [options.fired] - The reminders already fired `[{ route, mark, at }]`,
 * undefined before the first reading of the stop: a baseline, the reminders
 * already due are remembered without firing (a busy stop would fire dozens).
 * @param {number} options.now - Now (ms).
 * @returns {{ due: Array<{ passage: object, mark: number }>, fired: object[] }}
 * The reminders to fire and the memory to keep.
 */
function detectReminders({ passages, fired, now }) {
  const baseline = !Array.isArray(fired);
  const memory = (fired ?? []).filter((entry) => entry.at > now - REMINDER_KEEP_MS);
  const due = [];
  for (const passage of upcomingPassages(passages, now)) {
    const left = (passage.at - now) / 60000;
    const route = routeOf(passage);
    for (const mark of REMINDER_MINUTES) {
      if (left > mark || left <= mark - tolerance(mark)) {
        continue;
      }
      const known = memory.some(
        (entry) =>
          entry.mark === mark &&
          ((passage.trip && entry.trip === passage.trip) ||
            (entry.route === route && Math.abs(entry.at - passage.at) <= REMINDER_MATCH_MS)),
      );
      if (!known) {
        memory.push({ route, mark, at: passage.at, trip: passage.trip });
        if (!baseline) {
          due.push({ passage, mark });
        }
      }
    }
  }
  return { due, fired: memory };
}

/**
 * @description The cancelled passages of a stop not reported yet.
 * @param {object} options - Options.
 * @param {object[]} options.passages - The passages of the stop.
 * @param {object[]} [options.known] - The cancellations already seen
 * `[{ trip, at }]`, undefined before the first reading: a baseline.
 * @param {number} options.now - Now (ms).
 * @returns {{ due: object[], known: object[] }} The passages to report and the
 * memory to keep.
 */
function detectCancellations({ passages, known, now }) {
  const baseline = !Array.isArray(known);
  const memory = (known ?? []).filter((entry) => entry.at > now - CANCELLED_KEEP_MS);
  const due = [];
  for (const passage of cancelledPassages(passages, now)) {
    if (passage.scheduled - now > CANCELLED_HORIZON_MS) {
      continue;
    }
    const id = passage.trip || `${routeOf(passage)}|${passage.scheduled}`;
    if (!memory.some((entry) => entry.trip === id)) {
      memory.push({ trip: id, at: passage.scheduled });
      if (!baseline) {
        due.push(passage);
      }
    }
  }
  return { due, known: memory };
}

/**
 * @description The delays of a stop not reported yet.
 * @param {object} options - Options.
 * @param {object[]} options.passages - The passages of the stop.
 * @param {object[]} [options.known] - The delays already reported
 * `[{ trip, mark, at }]`, undefined before the first reading: a baseline.
 * @param {number} options.now - Now (ms).
 * @returns {{ due: Array<{ passage: object, mark: number }>, known: object[] }}
 * The delays to report (the highest mark reached only) and the memory to keep.
 */
function detectDelays({ passages, known, now }) {
  const baseline = !Array.isArray(known);
  const memory = (known ?? []).filter((entry) => entry.at > now - CANCELLED_KEEP_MS);
  const due = [];
  for (const passage of upcomingPassages(passages, now)) {
    if (!passage.realtime || passage.scheduled - now > DELAY_HORIZON_MS) {
      continue;
    }
    const id = passage.trip || `${routeOf(passage)}|${passage.scheduled}`;
    const reached = DELAY_MARKS.filter((mark) => passage.delay >= mark);
    const fresh = reached.filter(
      (mark) => !memory.some((entry) => entry.trip === id && entry.mark === mark),
    );
    fresh.forEach((mark) => memory.push({ trip: id, mark, at: passage.scheduled }));
    if (!baseline && fresh.length > 0) {
      due.push({ passage, mark: Math.max(...fresh) });
    }
  }
  return { due, known: memory };
}

/**
 * @description The new traffic messages of a stop.
 * @param {object} options - Options.
 * @param {object[]} options.messages - The messages of its last reading.
 * @param {object} [options.seen] - `{ <id>: lastSeen }`, undefined before the
 * first reading: a baseline.
 * @param {number} options.now - Now (ms).
 * @returns {{ due: object[], seen: object }} The messages to fire and the
 * memory to keep.
 */
function detectMessages({ messages, seen, now }) {
  const baseline = !seen || typeof seen !== 'object';
  const memory = {};
  for (const [id, at] of Object.entries(seen ?? {})) {
    if (at > now - MESSAGE_KEEP_MS) {
      memory[id] = at;
    }
  }
  const fresh = messages.filter((message) => !memory[message.id]);
  messages.forEach((message) => {
    memory[message.id] = now;
  });
  return {
    due: baseline
      ? []
      : fresh.sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).slice(0, MAX_MESSAGES_PER_STOP),
    seen: memory,
  };
}

// --- Payloads ------------------------------------------------------------------------

/**
 * @description The data of a `departure_soon` event.
 * @param {object} followed - The followed stop (`name`, `deviceId`, `stop`).
 * @param {object} passage - The passage.
 * @param {number} mark - The minutes of the reminder.
 * @param {object} options - `{ language, timeZone }`.
 * @returns {object} Flat scalars.
 */
function reminderData(followed, passage, mark, { language, timeZone }) {
  const time = formatTime(passage.at, timeZone);
  return {
    stop: followed.deviceId,
    minutes: String(mark),
    stop_name: followed.name,
    line: passage.line,
    destination: passage.destination,
    time,
    delay_minutes: passage.realtime ? passage.delay : 0,
    summary: clip(
      t(passage.delay > 0 ? 'summarySoonLate' : 'summarySoon', language, {
        line: passage.line,
        destination: passage.destination,
        stop: followed.stop.name,
        minutes: mark,
        time,
        delay: passage.delay,
      }),
      SUMMARY_MAX,
    ),
  };
}

/**
 * @description The data of a `departure_cancelled` event.
 * @param {object} followed - The followed stop (`name`, `deviceId`, `stop`).
 * @param {object} passage - The cancelled passage.
 * @param {object} options - `{ language, timeZone }`.
 * @returns {object} Flat scalars.
 */
function cancelledData(followed, passage, { language, timeZone }) {
  const time = formatTime(passage.scheduled, timeZone);
  return {
    stop: followed.deviceId,
    stop_name: followed.name,
    line: passage.line,
    destination: passage.destination,
    time,
    summary: clip(
      t('summaryCancelled', language, {
        line: passage.line,
        destination: passage.destination,
        stop: followed.stop.name,
        time,
      }),
      SUMMARY_MAX,
    ),
  };
}

/**
 * @description A date of a message: "27/10 22:30".
 * @param {number|null} instant - The instant (ms).
 * @param {string} [timeZone] - IANA timezone.
 * @returns {string} The day and time, '' when none.
 */
function messageDate(instant, timeZone) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const [, month, day] = localClock(instant, timeZone).date.split('-');
  return `${day}/${month} ${formatTime(instant, timeZone)}`;
}

/**
 * @description The data of a `departure_delayed` event.
 * @param {object} followed - The followed stop (`name`, `deviceId`, `stop`).
 * @param {object} passage - The late passage.
 * @param {number} mark - The minutes of delay reached.
 * @param {object} options - `{ language, timeZone }`.
 * @returns {object} Flat scalars.
 */
function delayedData(followed, passage, mark, { language, timeZone }) {
  const time = formatTime(passage.at, timeZone);
  const scheduled = formatTime(passage.scheduled, timeZone);
  return {
    stop: followed.deviceId,
    minutes: String(mark),
    stop_name: followed.name,
    line: passage.line,
    destination: passage.destination,
    scheduled_time: scheduled,
    time,
    delay_minutes: passage.delay,
    summary: clip(
      t('summaryDelayed', language, {
        line: passage.line,
        destination: passage.destination,
        stop: followed.stop.name,
        scheduled,
        delay: passage.delay,
        time,
      }),
      SUMMARY_MAX,
    ),
  };
}

/**
 * @description The data of a `traffic_message` event.
 * @param {object} followed - The followed stop (`name`, `deviceId`, `stop`).
 * @param {object} message - The message (`title`, `text`, `start`, `end`, `lines`).
 * @param {object} options - `{ language, timeZone }`.
 * @returns {object} Flat scalars.
 */
function messageData(followed, message, { language, timeZone }) {
  const lines = (message.lines ?? []).join(', ');
  return {
    stop: followed.deviceId,
    stop_name: followed.name,
    lines,
    title: clip(message.title, 200),
    message: clip(message.text, MESSAGE_MAX),
    start: messageDate(message.start, timeZone),
    end: messageDate(message.end, timeZone),
    summary: clip(
      t(lines ? 'summaryMessageLines' : 'summaryMessage', language, {
        stop: followed.stop.name,
        lines,
        title: message.title,
      }),
      SUMMARY_MAX,
    ),
  };
}

// --- Scene action outputs ------------------------------------------------------------

/**
 * @description The outputs of `get_next_departures`.
 * @param {object} options - Options.
 * @param {object} options.followed - The followed stop.
 * @param {object[]} options.passages - Its passages.
 * @param {number} options.now - Now (ms).
 * @param {string} options.language - Language of the summary.
 * @param {string} [options.timeZone] - IANA timezone.
 * @returns {object} The outputs.
 */
function nextDeparturesOutputs({ followed, passages, now, language, timeZone }) {
  const [first, second] = upcomingPassages(passages, now);
  const outputs = {
    stop_name: followed.name,
    found: Boolean(first),
    line: first?.line ?? '',
    destination: first?.destination ?? '',
    minutes: first ? minutesLeft(first, now) : -1,
    time: first ? formatTime(first.at, timeZone) : '',
    realtime: Boolean(first?.realtime),
    delay_minutes: first?.realtime ? first.delay : 0,
    following_minutes: second ? minutesLeft(second, now) : -1,
  };
  let summary;
  if (first) {
    summary = t('outputNext', language, {
      stop: followed.stop.name,
      line: first.line,
      destination: first.destination,
      when: passageWhen(first, { language, now, timeZone }),
    });
    if (second) {
      summary += ` ${t('outputFollowing', language, { when: passageWhen(second, { language, now, timeZone }) })}`;
    }
  } else {
    summary = t('outputNone', language, { stop: followed.stop.name });
  }
  return { ...outputs, summary: clip(summary, OUTPUT_MAX) };
}

/**
 * @description Keep only the declared outputs.
 * @param {object} outputs - The outputs.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs.
 */
const pick = (outputs, keys) => Object.fromEntries(keys.map((key) => [key, outputs[key]]));

export {
  TRIGGERS,
  REMINDER_MINUTES,
  DELAY_MARKS,
  CANCELLED_HORIZON_MS,
  DELAY_HORIZON_MS,
  NEXT_DEPARTURES_OUTPUTS,
  tolerance,
  detectReminders,
  detectCancellations,
  detectDelays,
  detectMessages,
  reminderData,
  cancelledData,
  delayedData,
  messageData,
  messageDate,
  nextDeparturesOutputs,
  pick,
};

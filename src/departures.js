// -----------------------------------------------------------------------------
// The departure board of a stop -> its passages and its traffic messages.
//
// The board (`departureBoard`, JSON form of the HAFAS ReST schema 2.52) lists
// each departure with:
//   - `date` / `time`        the timetable, Luxembourg wall clock, with its
//                            offset in minutes (`tz`) when given;
//   - `rtDate` / `rtTime`    the real-time estimate, only when the vehicle is
//                            followed (otherwise: the timetable only);
//   - `cancelled`            true for a cancelled trip (`partCancelled` when
//                            only part of it is);
//   - `direction`            the last stop of the trip;
//   - `ProductAtStop` / `Product[]`  the line: `name` ("Bus 16"), `line`,
//                            `displayNumber`, `catOut` ("Bus", "Tram",
//                            "Train"), `cls` (32 bus, 256 tram, 1 / 2 / 4
//                            trains), `operator`;
//   - `JourneyDetailRef.ref` the trip, stable across readings;
//   - `Messages.Message[]`   the traffic messages of the trip (`id`, `act`,
//                            `head`, `lead`, `text`, `sDate`/`sTime`,
//                            `eDate`/`eTime`); the board may also hold
//                            messages of its own (`Message[]`).
// A JSON list of one element may come as an object: `asList()` reads both.
// -----------------------------------------------------------------------------

import { fold } from './stops.js';
import { wallToInstant } from './time.js';

const MODES = { BUS: 'bus', TRAM: 'tram', TRAIN: 'train' };
const TRAIN_CLASSES = new Set([1, 2, 4, 8, 16]);
// Words a typed line may hold around its number: "bus 16", "tram 1", "ligne 302".
const LINE_WORDS = /\b(bus|tram|ligne|line|linie|linea|train|zug|tren|luxtram)\b/g;
const MODE_WORDS = {
  bus: 'bus',
  tram: 'tram',
  luxtram: 'tram',
  train: 'train',
  zug: 'train',
  tren: 'train',
};
const MESSAGE_TEXT_MAX = 1500;

/**
 * @description A value that may be a list or one element.
 * @param {unknown} value - The value.
 * @returns {Array} The list ([] when absent).
 */
function asList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value && typeof value === 'object' ? [value] : [];
}

/**
 * @description The instant of a date and time of the board.
 * @param {unknown} date - "2026-11-07".
 * @param {unknown} time - "18:42:00" or "18:42".
 * @param {unknown} [tz] - The offset in minutes, when given.
 * @returns {number|null} The instant (ms).
 * @example
 * boardInstant('2026-11-07', '18:42:00', 60); // -> 2026-11-07T17:42:00Z
 */
function boardInstant(date, time, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time ?? ''));
  if (!d || !t) {
    return null;
  }
  const wall = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    Number(t[1]),
    Number(t[2]),
    Number(t[3] ?? 0),
  );
  const offset = Number(tz);
  if (tz !== undefined && tz !== null && tz !== '' && Number.isFinite(offset)) {
    return wall - offset * 60000;
  }
  return wallToInstant(wall);
}

/**
 * @description The product (line) of a departure.
 * @param {object} departure - The departure.
 * @returns {object} The product, {} when none.
 */
const productOf = (departure) =>
  (departure?.ProductAtStop && typeof departure.ProductAtStop === 'object'
    ? departure.ProductAtStop
    : asList(departure?.Product)[0]) ?? {};

/**
 * @description The mode of a product.
 * @param {object} product - The product.
 * @returns {string} MODES.
 */
function modeOf(product) {
  const cls = Number(product.cls);
  if (cls === 256) {
    return MODES.TRAM;
  }
  if (TRAIN_CLASSES.has(cls)) {
    return MODES.TRAIN;
  }
  const category = fold(product.catOutL || product.catOut);
  if (category.includes('tram')) {
    return MODES.TRAM;
  }
  if (/train|zug|bahn|express|regional|\bre\b|\brb\b|\bic\b|\bter\b/.test(category)) {
    return MODES.TRAIN;
  }
  return MODES.BUS;
}

/**
 * @description How a line reads: "16" for a bus, "T1" for the tram, "RE 11"
 * for a train.
 * @param {object} product - The product.
 * @param {string} name - The `name` of the departure.
 * @returns {string} The label.
 */
function lineLabelOf(product, name) {
  const mode = modeOf(product);
  const full = String(product.name || name || '').trim();
  if (mode === MODES.TRAIN) {
    return full;
  }
  return String(
    product.displayNumber || product.line || full.replace(/^\S+\s+/, '') || full,
  ).trim();
}

/**
 * @description The names a line answers to, folded.
 * @param {object} product - The product.
 * @param {string} name - The `name` of the departure.
 * @returns {string[]} The names.
 */
function lineNamesOf(product, name) {
  const names = [
    product.line,
    product.displayNumber,
    product.lineId,
    product.name,
    name,
    String(product.name || name || '').replace(/^\S+\s+/, ''),
  ];
  return [...new Set(names.map(fold).filter(Boolean))];
}

/**
 * @description A typed line, folded, without the words around its number.
 * @param {string} typed - "Bus 16", "tram", "RE 11".
 * @returns {string} "16", "re 11".
 */
function typedLine(typed) {
  const folded = fold(typed);
  const bare = folded.replace(LINE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return bare || folded;
}

/**
 * @description Whether a passage is of a typed line.
 * @param {object} passage - The passage (`lineNames`).
 * @param {string} line - The typed line, '' for every line.
 * @returns {boolean} True when it is.
 */
function matchesLine(passage, line) {
  if (!line) {
    return true;
  }
  const wanted = typedLine(line);
  const full = fold(line);
  // A mode alone ("tram", "train", "bus") keeps every line of that mode.
  const mode = MODE_WORDS[full];
  if (mode) {
    return passage.mode === mode;
  }
  return passage.lineNames.some((name) => name === wanted || name === full);
}

/**
 * @description Split a typed direction into the words to look for.
 * @param {string} direction - "Kirchberg | Findel".
 * @returns {string[]} The folded alternatives.
 */
function directionTerms(direction) {
  return String(direction ?? '')
    .split('|')
    .map(fold)
    .filter(Boolean);
}

/**
 * @description A traffic message of the board.
 * @param {object} raw - The message.
 * @returns {object|null} `{ id, title, text, start, end }`, null when
 * inactive or empty.
 */
function messageOf(raw) {
  if (!raw || typeof raw !== 'object' || raw.act === false || raw.act === 'false') {
    return null;
  }
  const title = String(raw.head ?? '').trim();
  const text = [raw.lead, raw.text]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, MESSAGE_TEXT_MAX);
  if (!title && !text) {
    return null;
  }
  return {
    id: String(raw.id ?? `${title}|${text}`.slice(0, 120)),
    title: title || text.split(/(?<=[.!?])\s/)[0].slice(0, 120),
    text,
    start: boardInstant(raw.sDate, raw.sTime),
    end: boardInstant(raw.eDate, raw.eTime),
  };
}

/**
 * @description The passages of a board, soonest first.
 * @param {object} board - The answer of the departure board.
 * @param {object} [filter] - `{ line, direction }`: the optional typed line
 * and direction.
 * @returns {object[]} The passages, cancelled ones included.
 */
function parsePassages(board, { line = '', direction = '' } = {}) {
  const terms = directionTerms(direction);
  return asList(board?.Departure)
    .map((departure) => {
      const product = productOf(departure);
      const scheduled = boardInstant(departure.date, departure.time, departure.tz);
      const estimated = departure.rtTime
        ? boardInstant(
            departure.rtDate || departure.date,
            departure.rtTime,
            departure.rtTz ?? departure.tz,
          )
        : null;
      const realtime = Number.isFinite(estimated);
      const name = String(departure.name ?? '');
      const label = lineLabelOf(product, name);
      return {
        lineId: fold(label),
        line: label,
        lineNames: lineNamesOf(product, name),
        mode: modeOf(product),
        operator: String(product.operator ?? ''),
        destination: String(departure.direction ?? '').trim(),
        at: realtime ? estimated : scheduled,
        scheduled,
        realtime,
        // Minutes, rounded; negative when early.
        delay: realtime ? Math.round((estimated - scheduled) / 60000) : 0,
        cancelled: departure.cancelled === true || departure.cancelled === 'true',
        partCancelled: departure.partCancelled === true || departure.partCancelled === 'true',
        track: String(departure.rtTrack || departure.track || ''),
        trip: String(departure.JourneyDetailRef?.ref ?? ''),
        messages: asList(departure.Messages?.Message).map(messageOf).filter(Boolean),
      };
    })
    .filter((passage) => Number.isFinite(passage.scheduled))
    .filter((passage) => matchesLine(passage, line))
    .filter((passage) => {
      if (terms.length === 0) {
        return true;
      }
      const target = fold(passage.destination);
      return terms.some((term) => target.includes(term));
    })
    .sort((a, b) => a.at - b.at);
}

/**
 * @description The traffic messages of a board for some passages: those of
 * their trips, and those of the board itself. One per id.
 * @param {object} board - The answer of the departure board.
 * @param {object[]} passages - The passages kept (parsePassages).
 * @returns {object[]} The messages, with `lines`: the lines they concern.
 */
function boardMessages(board, passages) {
  const byId = new Map();
  for (const raw of asList(board?.Message)) {
    const message = messageOf(raw);
    if (message && !byId.has(message.id)) {
      byId.set(message.id, { ...message, lines: [] });
    }
  }
  for (const passage of passages) {
    for (const message of passage.messages) {
      const entry = byId.get(message.id) ?? { ...message, lines: [] };
      if (passage.line && !entry.lines.includes(passage.line)) {
        entry.lines.push(passage.line);
      }
      byId.set(message.id, entry);
    }
  }
  return [...byId.values()];
}

/**
 * @description The minutes left before a passage.
 * @param {object} passage - The passage.
 * @param {number} now - Now (ms).
 * @returns {number} Whole minutes (rounded down, like the screens).
 */
function minutesLeft(passage, now) {
  return Math.max(0, Math.floor((passage.at - now) / 60000));
}

/**
 * @description The passages not gone yet, cancelled ones left out.
 * @param {object[]} passages - The passages.
 * @param {number} now - Now (ms).
 * @returns {object[]} The passages to come.
 */
const upcomingPassages = (passages, now) =>
  passages.filter((passage) => !passage.cancelled && passage.at > now - 30000);

/**
 * @description The cancelled passages not gone yet.
 * @param {object[]} passages - The passages.
 * @param {number} now - Now (ms).
 * @returns {object[]} The cancelled passages to come.
 */
const cancelledPassages = (passages, now) =>
  passages.filter((passage) => passage.cancelled && passage.scheduled > now - 30000);

/**
 * @description Who a passage is, across readings: line and destination.
 * @param {object} passage - The passage.
 * @returns {string} "16|kirchberg".
 */
const routeOf = (passage) => `${passage.lineId}|${fold(passage.destination)}`;

export {
  MODES,
  asList,
  boardInstant,
  productOf,
  modeOf,
  lineLabelOf,
  typedLine,
  matchesLine,
  directionTerms,
  messageOf,
  parsePassages,
  boardMessages,
  minutesLeft,
  upcomingPassages,
  cancelledPassages,
  routeOf,
};

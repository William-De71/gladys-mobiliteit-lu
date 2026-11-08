// A fake ATP for the tests, served through the `fetch` option of the
// integration: the dataset of the open GTFS on data.public.lu and its zip
// (stops.txt reduced from the real one of 2026-11-04, CC BY 4.0), and the
// departure board of the HAFAS server.
//
// The boards are BUILT from the HAFAS ReST schema the server publishes
// (rest-2.52.xsd) and the community documentation of the API: no key was at
// hand to record real answers. The "missing accessId" (400) and "refused key"
// (401 API_AUTH, which echoes the key) answers are real ones of the server
// (2026-11-08, the key replaced by the test one); the quota one follows the
// documentation.
// Tests never touch the network.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// 2026-11-07 18:30:00 in Luxembourg: the time of the boards.
const NOW = Date.parse('2026-11-07T17:30:00Z');
const TZ = 'Europe/Luxembourg';
const KEY = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const DATASET_URL =
  'https://data.public.lu/api/1/datasets/horaires-et-arrets-des-transport-publics-gtfs/';
const ZIP_URL =
  'https://download.data.public.lu/resources/horaires-et-arrets-des-transport-publics-gtfs/20261105-053451/gtfs-20261104-20261212.zip';
const OLD_ZIP_URL =
  'https://download.data.public.lu/resources/horaires-et-arrets-des-transport-publics-gtfs/20261022-044343/gtfs-20261021-20261212.zip';
const HAMILIUS = '200405020';
const GARE = '200405060';

const text = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(text(name));
const clone = (value) => JSON.parse(JSON.stringify(value));

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A temporary path for the file kept in /data.
 * @returns {string} The path (its directory exists, the file does not).
 */
const storePath = () => join(mkdtempSync(join(tmpdir(), 'mobiliteit-lu-')), 'mobiliteit-lu.json');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

/**
 * @description The CRC-32 of some bytes.
 * @param {Buffer} buf - The bytes.
 * @returns {number} The CRC.
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @description A zip archive.
 * @param {object} files - `{ name: text | Buffer }`.
 * @param {object} [options] - `{ store }`: no compression.
 * @returns {Buffer} The archive.
 */
function makeZip(files, { store = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = store ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const STOPS_TXT = text('gtfs-stops.txt');
const GTFS_ZIP = makeZip({
  'agency.txt': 'agency_id,agency_name\n6,"Ville de Luxembourg - Service Autobus"\n',
  'stops.txt': STOPS_TXT,
});
// The answer of the data.public.lu API, reduced to what is read.
const DATASET = {
  id: '5a2a58b9111e9b7f34fc6606',
  slug: 'horaires-et-arrets-des-transport-publics-gtfs',
  license: 'cc-by',
  resources: [
    {
      title: 'gtfs-20261021-20261212.zip',
      format: 'zip',
      created_at: '2026-10-22T04:43:46.566000+00:00',
      last_modified: '2026-10-22T04:43:49.857000+00:00',
      url: OLD_ZIP_URL,
    },
    {
      title: 'gtfs-20261104-20261212.zip',
      format: 'zip',
      created_at: '2026-11-05T05:34:54.138000+00:00',
      last_modified: '2026-11-05T05:34:55.712000+00:00',
      url: ZIP_URL,
    },
  ],
};
const BOARDS = {
  [HAMILIUS]: json('board-hamilius.json'),
  [GARE]: json('board-gare-centrale.json'),
};
const ERROR_AUTH = text('error-auth.json');
const ERROR_QUOTA = text('error-quota.json');
const ERROR_NO_KEY = text('error-no-key.xml');

/**
 * @description A departure of a board, as the HAFAS server writes it.
 * @param {object} [options] - What differs from a bus 16 towards Kirchberg at
 * Hamilius at 18:40, followed in real time and on time.
 * @param {string} [options.line] - The line ("16").
 * @param {string} [options.direction] - The destination.
 * @param {string} [options.time] - The timetable, "HH:MM:SS" (Luxembourg).
 * @param {string|null} [options.rtTime] - The estimate, null for none.
 * @param {boolean} [options.cancelled] - A cancelled trip.
 * @param {string} [options.ref] - The trip.
 * @param {object[]} [options.messages] - Its messages.
 * @returns {object} The departure.
 */
function departure({
  line = '16',
  direction = 'Kirchberg, Gare routière',
  time = '18:40:00',
  rtTime = time,
  cancelled = false,
  ref = `1|${line}|${time}|82|7112026`,
  messages = [],
} = {}) {
  const product = {
    name: `Bus ${line}`,
    displayNumber: line,
    num: '8016',
    line,
    lineId: line,
    catOut: 'Bus',
    catIn: '064',
    catCode: '5',
    cls: '32',
    catOutS: '064',
    catOutL: 'Bus',
    operatorCode: 'AVL',
    operator: 'Ville de Luxembourg - Service Autobus',
    admin: 'AVL---',
  };
  const entry = {
    JourneyDetailRef: { ref },
    JourneyStatus: 'P',
    ProductAtStop: product,
    Product: [product],
    name: `Bus ${line}`,
    type: 'ST',
    stop: 'Hamilius (Bus)',
    stopid: `A=1@O=Hamilius (Bus)@X=6125976@Y=49611504@U=82@L=${HAMILIUS}@`,
    stopExtId: HAMILIUS,
    time,
    date: '2026-11-07',
    tz: 60,
    reachable: !cancelled,
    direction,
  };
  if (rtTime) {
    Object.assign(entry, {
      prognosisType: 'PROGNOSED',
      rtTime,
      rtDate: '2026-11-07',
      rtTz: 60,
    });
  }
  if (cancelled) {
    entry.cancelled = true;
  }
  if (messages.length) {
    entry.Messages = { Message: messages };
  }
  return entry;
}

/**
 * @description The fake ATP.
 * @returns {Function} A fetch function, with `.calls` and `.state`.
 */
function fakeAtp() {
  const state = {
    boards: clone(BOARDS),
    // 'network', or an HTTP status, for every board request.
    failBoard: null,
    // 'auth' or 'quota': the matching error answer of the HAFAS server.
    error: null,
    failDataset: null,
  };
  const calls = [];

  /**
   * @description The fetch function.
   * @param {string} url - The URL.
   * @returns {Promise<Response>} The answer.
   */
  async function fetchFn(url) {
    const parsed = new URL(url);
    calls.push({ url, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) });
    if (url === DATASET_URL) {
      if (state.failDataset) {
        return new Response('Bad Gateway', { status: state.failDataset });
      }
      return Response.json(DATASET);
    }
    if (url === ZIP_URL) {
      return new Response(GTFS_ZIP, {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      });
    }
    if (parsed.pathname.endsWith('/departureBoard')) {
      if (state.failBoard === 'network') {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }
      if (typeof state.failBoard === 'number') {
        return new Response('Service Unavailable', { status: state.failBoard });
      }
      if (!parsed.searchParams.get('accessId')) {
        return new Response(ERROR_NO_KEY, {
          status: 400,
          headers: { 'content-type': 'application/xml' },
        });
      }
      if (state.error === 'auth') {
        return new Response(ERROR_AUTH, { status: 401 });
      }
      if (state.error === 'quota') {
        return new Response(ERROR_QUOTA, { status: 400 });
      }
      const board = state.boards[parsed.searchParams.get('id')];
      if (!board) {
        return Response.json(
          {
            serverVersion: '2.52.2',
            dialectVersion: '2.52',
            errorCode: 'SVC_LOC',
            errorText: 'location missing or invalid',
          },
          { status: 400 },
        );
      }
      return Response.json(board);
    }
    return new Response('Not Found', { status: 404 });
  }
  fetchFn.calls = calls;
  fetchFn.state = state;
  fetchFn.boardCalls = () => calls.filter((call) => call.path.endsWith('/departureBoard'));
  return fetchFn;
}

/**
 * @description A minimal Gladys client for the pure builders.
 */
const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:mobiliteit-lu:${type}:${id}`,
    feature: (key) => `ext:mobiliteit-lu:${type}:${id}:${key}`,
  }),
};

export {
  NOW,
  TZ,
  KEY,
  DATASET_URL,
  ZIP_URL,
  HAMILIUS,
  GARE,
  BOARDS,
  STOPS_TXT,
  GTFS_ZIP,
  DATASET,
  silent,
  storePath,
  clone,
  makeZip,
  departure,
  fakeAtp,
  fakeGladys,
};

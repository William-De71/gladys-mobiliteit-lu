// -----------------------------------------------------------------------------
// A zip archive and its CSV files, read without dependency: the zip through
// its central directory and zlib, the CSV by hand (RFC 4180 quotes). Used for
// the stops.txt of the GTFS of the Administration des transports publics.
// -----------------------------------------------------------------------------

import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const inflate = promisify(inflateRaw);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

class ZipError extends Error {
  /**
   * @param {string} message - The detail.
   */
  constructor(message) {
    super(message);
    this.name = 'ZipError';
    this.kind = 'invalid';
  }
}

/**
 * @description The entries of a zip archive.
 * @param {Buffer} zip - The archive.
 * @returns {Map<string, { method: number, offset: number, size: number }>}
 * Name -> compression method, offset of the local header, compressed size.
 */
function zipEntries(zip) {
  // The end of central directory record sits in the last 64 KB.
  let eocd = -1;
  for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index -= 1) {
    if (zip.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd === -1) {
    throw new ZipError('not a zip archive');
  }
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipError('broken zip directory');
    }
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name.split('/').pop(), { method, offset: local, size });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * @description The text of a file of the archive.
 * @param {Buffer} zip - The archive.
 * @param {Map} entries - zipEntries().
 * @param {string} name - "stops.txt".
 * @returns {Promise<Buffer|null>} Its bytes (UTF-8), null when absent.
 */
async function readEntry(zip, entries, name) {
  const entry = entries.get(name);
  if (!entry) {
    return null;
  }
  const { offset } = entry;
  if (zip.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new ZipError(`broken entry ${name}`);
  }
  const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
  const data = zip.subarray(start, start + entry.size);
  if (entry.method === 0) {
    return data;
  }
  if (entry.method !== 8) {
    throw new ZipError(`${name}: compression ${entry.method}`);
  }
  return inflate(data);
}

/**
 * @description Split one CSV line (RFC 4180 quotes).
 * @param {string} line - The line, without its line break.
 * @returns {string[]} The cells.
 * @example
 * splitCsvLine('a,"b, c",d'); // -> ['a', 'b, c', 'd']
 */
function splitCsvLine(line) {
  if (!line.includes('"')) {
    return line.split(',');
  }
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/**
 * @description Go through the rows of a CSV file, line by line from its
 * bytes.
 * @param {Buffer|null} csv - The bytes (UTF-8).
 * @param {Function} visit - `(row: string[], column: (name) => index)`.
 */
function eachRow(csv, visit) {
  if (!csv) {
    return;
  }
  let start = 0;
  let header = null;
  const column = (name) => header.indexOf(name);
  while (start < csv.length) {
    let end = csv.indexOf(0x0a, start);
    if (end === -1) {
      end = csv.length;
    }
    const stop = end > start && csv[end - 1] === 0x0d ? end - 1 : end;
    const line = csv.toString('utf8', start, stop);
    start = end + 1;
    if (!line) {
      continue;
    }
    if (!header) {
      header = splitCsvLine(line.replace(/^\uFEFF/, '')).map((name) => name.trim());
      continue;
    }
    visit(splitCsvLine(line), column);
  }
}

export { ZipError, zipEntries, readEntry, splitCsvLine, eachRow };

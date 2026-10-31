/**
 * DSH session log frame utilities.
 *
 * A session log is a sequence of zstd frames. Each frame is an independently
 * compressed chunk, and the decompressed chunks concatenate into JSONL text:
 * line 1 is the session header, every following line is one event.
 *
 * Node's zstdDecompressSync only decodes the FIRST frame, so a log with many
 * frames has to be split on the zstd magic number and decoded frame by frame.
 */
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Read a session log and return its decompressed JSONL text.
 * @param {string} file
 * @returns {{text: string, frames: number, badFrames: number, bytes: number, firstError: string|null}}
 */
function readSession(file) {
  const buf = fs.readFileSync(file);
  const parts = [];
  let frames = 0;
  let badFrames = 0;
  let firstError = null;
  let pos = 0;
  while (pos < buf.length) {
    const start = buf.indexOf(MAGIC, pos);
    if (start < 0) break;
    const nextMagic = buf.indexOf(MAGIC, start + 4);
    const end = nextMagic < 0 ? buf.length : nextMagic;
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'));
      frames++;
    } catch (err) {
      // Never swallow silently: a code bug (bad require, typo) looks exactly
      // like a corrupt frame unless the first error is kept.
      badFrames++;
      if (!firstError) firstError = String(err && err.message || err);
    }
    pos = end;
  }
  return { text: parts.join(''), frames, badFrames, bytes: buf.length, firstError };
}

/**
 * Parse JSONL text into a header plus an array of events.
 * @param {string} text
 */
function parseSession(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new Error('session log is empty');
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map(line => JSON.parse(line));
  return { header, events };
}

/**
 * Write events back as one JSON line per zstd frame.
 *
 * One line per frame is deliberate: batching 200 lines into a single ~500 KB
 * frame makes the session silently disappear from the sidebar, with no error
 * anywhere. Keep frames small.
 *
 * @param {string} file
 * @param {object} header
 * @param {object[]} events
 * @returns {{frames: number, bytes: number}}
 */
function writeSession(file, header, events) {
  const lines = [JSON.stringify(header), ...events.map(event => JSON.stringify(event))];
  const fd = fs.openSync(file, 'w');
  try {
    for (const line of lines) {
      fs.writeSync(fd, zlib.zstdCompressSync(Buffer.from(line + '\n', 'utf8')));
    }
  } finally {
    fs.closeSync(fd);
  }
  const bytes = fs.statSync(file).size;
  const check = readSession(file);
  if (check.badFrames) throw new Error(`wrote ${check.badFrames} undecodable frame(s): ${check.firstError}`);
  return { frames: check.frames, bytes };
}

module.exports = { readSession, parseSession, writeSession };

#!/usr/bin/env node
/**
 * Repack a session JSONL into a multi-frame zstd log, one event per frame.
 *
 * Usage:
 *   node scripts/repack.js input.jsonl output.v4.jsonl.zstd
 *
 * One line per frame is not a style choice. A frame holding 200 lines (~500 KB)
 * makes the session silently disappear from the sidebar instead of failing loudly.
 */
'use strict';

const fs = require('node:fs');
const { writeSession, readSession } = require('./lib/frames.js');

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node scripts/repack.js <input.jsonl> <output.v4.jsonl.zstd>');
    process.exit(2);
  }

  const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) {
    console.error('input is empty');
    process.exit(2);
  }

  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`line ${index + 2} is not valid JSON: ${err.message}`);
    }
  });

  // seq must equal the array index; refuse to write a log that is already broken.
  events.forEach((event, index) => {
    if (event.seq !== index) throw new Error(`seq mismatch at index ${index}: event.seq=${event.seq}`);
  });

  const written = writeSession(output, header, events);
  const check = readSession(output);
  const readBack = check.text.split(/\r?\n/).filter(Boolean);

  console.log(`wrote        ${output}`);
  console.log(`frames       ${written.frames}`);
  console.log(`bytes        ${written.bytes}`);
  console.log(`bad frames   ${check.badFrames}`);
  console.log(`lines        ${readBack.length} (1 header + ${readBack.length - 1} events)`);
}

main();

#!/usr/bin/env node
/**
 * Inspect a DSH session log and report everything needed to judge it.
 *
 * Read-only. Never writes to the session file.
 *
 * Usage:
 *   node scripts/inspect.js <session.v4.jsonl.zstd>
 *
 * Exit codes: 0 = no structural problem found, 1 = problem found, 2 = unreadable.
 */
'use strict';

const { readSession, parseSession } = require('./lib/frames.js');

const SURFACE_TYPES = new Set([
  'user/message', 'assistant/message', 'tool/result', 'developer/message', 'system/message',
]);

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/inspect.js <session.v4.jsonl.zstd>');
    process.exit(2);
  }

  const raw = readSession(file);
  console.log(`bytes        ${raw.bytes}`);
  console.log(`frames       ${raw.frames}`);
  console.log(`bad frames   ${raw.badFrames}${raw.firstError ? '  first error: ' + raw.firstError : ''}`);
  if (raw.badFrames === raw.frames) {
    console.error('\nEvery frame failed to decode. This is usually a code problem, not a corrupt file —');
    console.error('verify the decompressor works on a known-good log before repairing anything.');
    process.exit(2);
  }

  const { header, events } = parseSession(raw.text);
  console.log(`format       v${header.version}`);
  console.log(`events       ${events.length}`);
  console.log(`max seq      ${events.length ? events[events.length - 1].seq : 'n/a'}`);

  const problems = [];
  const note = (msg) => problems.push(msg);

  // seq must equal the array index: 0..n-1, no gaps, no duplicates.
  events.forEach((event, index) => {
    if (event.seq !== index) note(`seq gap at index ${index}: event.seq=${event.seq}`);
  });

  // Surface events must carry a surfaceOp: "append" or {op:"replace", startSeq, endSeq}.
  for (const event of events) {
    if (SURFACE_TYPES.has(event.type)) {
      const op = event.surfaceOp;
      if (op === undefined) note(`${event.type}@${event.seq} missing surfaceOp`);
      else if (op !== 'append') {
        if (typeof op !== 'object' || Array.isArray(op)) note(`${event.type}@${event.seq} surfaceOp is not an object`);
        else {
          const keys = Object.keys(op).sort().join(',');
          if (keys !== 'endSeq,op,startSeq' || op.op !== 'replace') note(`${event.type}@${event.seq} malformed replace: ${keys}`);
          for (const key of ['startSeq', 'endSeq']) {
            if (!(op[key] < event.seq)) note(`${event.type}@${event.seq} surfaceOp.${key}=${op[key]} is not earlier`);
          }
        }
      }
    } else if (event.surfaceOp !== undefined) {
      note(`${event.type}@${event.seq} carries surfaceOp but is not a surface event`);
    }
  }

  // sourceEventSeqs members must be unique and strictly earlier than the event.
  for (const event of events) {
    if (!Array.isArray(event.sourceEventSeqs)) continue;
    const flat = [];
    for (const entry of event.sourceEventSeqs) {
      if (typeof entry === 'number') flat.push(entry);
      else if (Array.isArray(entry) && entry.length === 2) {
        for (let seq = entry[0]; seq <= entry[1]; seq++) flat.push(seq);
      } else note(`${event.type}@${event.seq} malformed sourceEventSeqs member`);
    }
    const seen = new Set();
    for (const seq of flat) {
      if (seq >= event.seq) note(`${event.type}@${event.seq} sourceEventSeqs cites ${seq}, not earlier`);
      if (seen.has(seq)) note(`${event.type}@${event.seq} sourceEventSeqs repeats ${seq}`);
      seen.add(seq);
    }
  }

  // tool/result must pair with an earlier tool/call for the same callId.
  const openCalls = new Map();
  for (const event of events) {
    if (event.type === 'tool/call' && event.data && event.data.callId) {
      openCalls.set(event.data.callId, event.seq);
    }
    if (event.type === 'tool/result') {
      const message = event.data && event.data.message || {};
      const callId = message.toolCallId || (message.source && message.source.callId);
      if (callId && !openCalls.has(callId)) note(`tool/result@${event.seq} has no earlier tool/call for ${callId}`);
      if (callId) openCalls.delete(callId);
    }
  }
  for (const [callId, seq] of openCalls) note(`tool/call@${seq} never receives a tool/result (${callId})`);

  // error metadata must agree with the isError flag — ONE direction only.
  // `data.error` present requires `isError:true`. The reverse is legal: a tool can
  // fail (`isError:true`) without carrying structured error metadata.
  for (const event of events) {
    if (event.type !== 'tool/result') continue;
    const message = event.data && event.data.message || {};
    const hasErrorMeta = event.data && event.data.error !== undefined;
    if (hasErrorMeta && message.isError !== true) note(`tool/result@${event.seq} carries error metadata but isError is not true`);
  }

  // developer/message declarations must resolve to exactly one tool in their header.
  for (const event of events) {
    if (event.type !== 'developer/message') continue;
    const data = event.data || {};
    if (data.headerSeq === undefined) continue;
    const headerEvent = events[data.headerSeq];
    if (!headerEvent || headerEvent.type !== 'request/header') {
      note(`developer/message@${event.seq} headerSeq ${data.headerSeq} is not a request/header`);
      continue;
    }
    const tools = new Set((((headerEvent.data || {}).header || {}).tools || []).map(tool => tool.name));
    const blocks = (data.message && data.message.content) || [];
    for (const block of blocks) {
      if (block.type !== 'tool-addition' && block.type !== 'tool-removal') continue;
      let matches = 0;
      for (const name of tools) if (name === block.toolName) matches++;
      if (block.type === 'tool-addition' && matches !== 1) {
        note(`developer/message@${event.seq} tool-addition "${block.toolName}" matches ${matches} tools in headerSeq ${data.headerSeq}`);
      }
    }
  }

  // Summary
  const byType = new Map();
  for (const event of events) byType.set(event.type, (byType.get(event.type) || 0) + 1);
  console.log('\ntop event types');
  [...byType].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([type, count]) => console.log(`  ${String(count).padStart(5)}  ${type}`));

  const toolCalls = new Map();
  for (const event of events) {
    if (event.type === 'tool/call' && event.data) {
      toolCalls.set(event.data.name, (toolCalls.get(event.data.name) || 0) + 1);
    }
  }
  console.log('\ntool calls');
  [...toolCalls].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([name, count]) => console.log(`  ${String(count).padStart(5)}  ${name}`));

  console.log('');
  if (problems.length) {
    console.log(`problems: ${problems.length}`);
    for (const problem of problems.slice(0, 40)) console.log(`  - ${problem}`);
    if (problems.length > 40) console.log(`  ... ${problems.length - 40} more`);
    process.exit(1);
  }
  console.log('problems: none');
}

main();

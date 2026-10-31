---
name: dsh-session-repair
description: "Diagnose and repair corrupt DeepSeek Harness (dsh) session logs (session.v4.jsonl.zstd) — sessions that refuse to open, throw SessionFormatError, fail with a 400 about tool_use without tool_result, silently vanish from the sidebar, or loop forever calling a tool that no longer exists. Use when a dsh conversation is unreadable or unusable and the log must be inspected, patched, and re-verified."
---

# DSH Session Repair

A `session.v4.jsonl.zstd` is the only copy of a conversation. It can go bad in ways that
look like "the data is gone" but are almost always structural: a half-written frame, a
deleted event that something else still cites, a tool call whose result vanished.
This skill is the procedure for finding out which, and fixing it without losing content.

**Read the iron laws first. Every one of them cost a night to learn.**

---

## 1. Iron laws

1. **One event per zstd frame.** Batching 200 lines into one ~500 KB frame makes the session
   *silently disappear from the sidebar* — no error, not clickable. Small frames, always.
2. **`surfaceOp` is a required field, not litter.** In format v4 these five event types must
   carry it: `user/message`, `assistant/message`, `tool/result`, `developer/message`,
   `system/message`. Legal values are exactly `"append"` or `{"op":"replace","startSeq":N,"endSeq":M}`
   (three keys, endpoints strictly earlier than the event). Anything else is rejected.
3. **Renumbering is contagious.** If you delete or insert events you must rewrite `seq`
   *and every citation of the old numbers*: `sourceEventSeqs` (numbers **and** `[start,end]`
   pairs), `developer/message.data.headerSeq`, `session/title(.title-llm-request).data.messageSeqs`,
   `delivery-accepted.data.throughSeq`, `surfaceOp.startSeq/endSeq`.
4. **`data.error` and `message.isError` are a pair.** Result rows must be one of: no error
   metadata and no `isError:true`, or error metadata plus `isError:true`. Deleting only one
   half yields `carries error metadata for a non-error tool result`.
5. **Declarations are not behaviour.** `request/header.data.header.tools` and
   `developer/message`'s `toolName` are declarations — never touch them; a `tool-addition`
   must resolve to exactly one same-named tool in its `headerSeq`. `tool/call`,
   assistant `tool-call` blocks and `data.stream` fragments are behaviour — those you may edit.
6. **Thinking is not contamination.** Tool-call records are what the model *did*; reasoning
   text is what it *thought*. Repairing the first is maintenance. Rewriting the second
   erases its memory of how it got out. Do not scrub reasoning.
7. **Take a baseline before you touch anything.** Run `inspect.js` on the untouched original
   and save the output. The original contains entries that look wrong but are legal; without
   a baseline you cannot tell an inherited oddity from damage you just caused. Pass condition:
   the post-repair problem set is a **strict subset** of the baseline.
8. **Find the writer, not just the symptom.** These logs are not written by you alone —
   context-compression plugins rewrite history by converting `surfaceOp` to a `replace` range,
   and a fold boundary landing between a call and its result produces exactly the same
   `tool_use`-without-`tool_result` symptom as a bad patch. Repairing the data without
   identifying (and stopping) the writer means repairing it again next week.

---

## 2. Triage: which failure is this?

| Symptom | Likely cause | Where to look |
|---|---|---|
| Session will not open; `SessionFormatError: ...` with a line number | structural violation at that line | `scripts/inspect.js`, then the reported field |
| `400` upstream: `'tool_use' ids were found without 'tool_result' blocks` | an orphaned tool call in the request history | find `tool/call` with no matching `tool/result` |
| Session **not listed at all**, no error | oversized frame, or a fatal record | check frames-per-line ratio first |
| Opens, history empty | the running process cached "this session was deleted" | fully quit the app, not just the window |
| Model loops calling a tool that no longer exists | the history teaches the call | count `tool/call` by name |

**Run `node scripts/inspect.js <log>` before anything else.** It is read-only and reports
seq gaps, surfaceOp violations, broken tool pairs, error-metadata mismatches, and
declaration/header mismatches — the five things that actually break these logs.

---

## 3. Procedure

### Step 0 — never touch the original

```bash
cp session.v4.jsonl.zstd session.v4.jsonl.zstd.orig-$(date +%Y%m%d-%H%M)
```

Then work on a copy. The original is the ground truth for one question only:
*does unmodified content still load?* If yes, every field in it is legal, and any
validator of yours that disagrees is wrong.

### Step 1 — diagnose, and take a baseline

```bash
node scripts/inspect.js copy.v4.jsonl.zstd   > baseline.txt
```

Keep that file. The original contains entries that look wrong but are legal (a `replace`
`surfaceOp` whose range looks arbitrary, a missing `step/end`). Without a baseline you cannot
tell an inherited oddity from one you introduced.

**Pass condition: the post-repair problem set is a strict subset of the baseline.** Anything
new is your damage.

### Step 1.5 — ask who else writes this file

This log is not written by you alone. Context-compression plugins (billion-context and
similar) rewrite history to save tokens, and they do it by converting an event's `surfaceOp`
into a `replace` range. When that fold boundary lands **between a tool call and its result**,
the log ends up with a `tool_use` that has no `tool_result` — byte-for-byte the same symptom
as a bad manual patch.

Before you patch, decide:

- **The writer is still installed** → your fix buys time, not permanence. Disable it, or
  accept periodic maintenance.
- **It is gone** → the repair will hold.

How to tell: count replace-form `surfaceOp` events and look at their ranges. A few scattered
ones are original. **Clusters whose ranges repeatedly cover the same small span** mean a fold
is actively moving.

Repair the data, but identify the writer. Structure is the symptom; authorship is the cause.

Note also that a local validator is never the authority. If your `inspect.js` says clean and
dsh still refuses the file, the app is right — read its error, add the missing rule to the
script, then re-run.

### Step 2 — pick the smallest possible patch

In order of preference:

1. **Rename a field value** (e.g. a stale tool name). Costs one string per event, no
   renumbering, no structural risk.
2. **Rewrite a result body** (and its `data.error` / `isError` pair). Same cost.
3. **Delete a whole tool pair** (`tool/call` + `tool/result`) plus the assistant
   `tool-call` block that advertised it. Requires full renumbering — see law 3.
4. **Insert a missing event** (e.g. a `step/end` before `turn/end`). Requires renumbering
   everything after the insertion point.

If a symptom can be fixed at level 1, do not reach for level 3.

### Step 3 — renumber correctly

Build an explicit map `oldSeq -> newSeq` where deleted indices map to `null`. Then:

- rewrite `seq` from the map
- expand any `[start,end]` in `sourceEventSeqs` to individual numbers, map them, drop
  the ones that vanished, de-duplicate, sort ascending
- map the scalar citations listed in law 3
- map `surfaceOp.startSeq` / `surfaceOp.endSeq`, and fail loudly if a mapped endpoint
  is `null` (a replacement range that lost its boundary must be repaired deliberately,
  not silently)

### Step 4 — write and re-verify

```bash
node scripts/repack.js input.jsonl output.v4.jsonl.zstd
node scripts/inspect.js output.v4.jsonl.zstd
```

Both must report clean before the file goes back.

### Step 5 — load it

Put the file back, then **fully quit the app** (tray → Quit). A running process that once
saw the session deleted will keep serving an empty history from memory no matter what the
file says.

---

## 4. Success criteria

- `inspect.js` reports `problems: none`
- the session appears in the sidebar again
- history renders
- a new message sends, and the log gains a `delivery-accepted` event — that marker means
  the request survived tool-call/tool-result validation upstream

`delivery-accepted` is the real finish line. File validity is not.

---

## 5. When the model loops on a dead tool

A conversation whose history contains hundreds of calls to a tool that has since been
removed will keep calling it: the model imitates *actions*, not *consequences*. Rewriting
the error results to look successful does **not** help — verified the hard way.

What works, cheapest first:

1. **Rename the historical call** to a tool that still exists and needs no arguments.
   Cover all four places: `tool/call.data.name`, assistant `tool-call` block `name`,
   and `data.stream` fragments (`block-start` and `tool-call-delta` both carry `name`).
2. **Scrub the plain-text mentions** (`"<name> × 3"` reminder notices, summaries) so the
   token stops appearing in context.
3. Only if both fail: delete the calls (level 3, expensive — count the collateral first:
   replacement ranges whose endpoints sit on deleted events, steps left with no body).

Do not touch reasoning text while doing this. See law 6.

---

## 6. Files

```
scripts/lib/frames.js   read/parse/write a multi-frame zstd log
scripts/inspect.js      read-only structural diagnosis
scripts/repack.js       JSONL -> one-line-per-frame zstd, with readback
docs/rules.md           the long form of the six laws, with the error text each produces
docs/cases.md           two worked examples, sanitized
```

---

## 7. Reporting

When you hand the session back, state: frames, bad frames, event count, seq continuity,
and whether `problems` is empty. Numbers, not adjectives.

# Implementation Plan: Consequence Journal From Events v1

> Feature branch: `feature/consequence-journal-from-events-v1`
> ADR: none for this plan. An ADR may be considered **during closeout only** if
> the implementation meaningfully changes journal-source precedence (it is not
> expected to — see D1/D2 below).
> Status: **APPROVED — docs-only plan; decisions D1/D2 locked. No code yet.**
> Depends on / relates to: Consequence Journal v0 (ADR-0029), Generated Room
> Consequence Journal v0 (ADR-0058), World State & Event Log v0 (ADR-0013).

## Overview

Add a **pure, read-only, event-derived journal projection** that turns the
already-recorded `WorldEvent` log into a `JournalView` for the existing,
unchanged `JournalPanel`. It reads only data that the append-only event log
already holds, echoes **no** string payload content, and has no write path to
truth. This is the "populate the journal from events" follow-up anticipated by
ADR-0058 — now realised as a sibling projector, not a new UI surface.

The safest, self-contained deliverable (Slice 1) is the pure domain projector +
its tests, with **zero** wiring and **zero** runtime behaviour change — mirroring
how the generated journal shipped its projector before wiring. Wiring into the
existing render slot (Slice 2) is a **separate slice** behind an explicit,
default-OFF feature flag, so shipped generated/authored journal behaviour is
byte-identical until the flag is enabled (see
[Locked decisions](#locked-decisions-d1--d2)).

## Minimum Safe Change Check

| Question | Answer |
|---|---|
| What existing code is reused? | `JournalView` / `JournalEntryView` shape and `JournalPanel` (both unchanged); `WorldEvent` **type** from `domain/world/events`; the existing `WorldSession.getEventLog` read path and `InMemoryWorldStore` log retention (incl. `restoreSession`); the `computeDerivedViews` / `refreshDerivedViews` seam (touched only in the gated wiring slice) |
| What new code is actually necessary? | One pure projector `buildEventConsequenceJournal(events): JournalView` (~1 file) + closed template table; its Vitest file. Wiring (if approved) adds a thin, explicit event fetch at existing refresh sites — no new component, no new schema, no new lint rule |
| What safety boundaries remain unchanged? | Event log stays append-only; `WorldSession` + reducers stay the sole truth; all schemas/save-load unchanged; renderer trust boundary unchanged; memory/room-memory untouched; provider/LLM/prompt untouched; log discipline unchanged |
| What targeted tests prove the change? | Pure projector Vitest tests with sentinel leak-guards across every content-bearing payload field; ordering/cap/empty/purity tests; export-shape structural test |

---

## 1. What Consequence Journal v0 already provides

- **UI surface (done, reused as-is):** `renderer/ui/JournalPanel.tsx` — a
  presentational, collapsible `role="status"` panel taking `view: JournalView`,
  with a toggle, a title, an empty state ("Nothing of consequence yet."), and a
  `<ul>` of `{ id, text }` entries. Rendered at `App.tsx` via
  `{journal && <JournalPanel view={journal} />}`.
- **Two existing sources, one render slot:**
  - Authored/demo → `demoJournalSpec` + `projectJournal(spec, state)` (entries
    gated by `evaluateCondition` over `WorldState`).
  - Generated play → `buildGeneratedConsequenceJournal(...)` (safe counts +
    closed story-phrase templates).
- **Shape:** `JournalView = { journalId, title, entries: { id, text }[] }`
  (`domain/journal/projectJournal.ts`).
- **Selection:** `computeDerivedViews` picks **exactly one** source (generated
  XOR authored) or `null`; the two are mutually exclusive.
- **Boundaries already honoured:** read-only projection from authoritative
  `WorldState`; no event-log mutation; no memory writes; no schema/save-load/
  provider changes. Leak guards forbid room names, object ids/names, flag keys,
  `interaction:` prefixes, quest title/objective text, seed/prompt/provider text.

**Key limitation:** both existing sources project the **current `WorldState`
snapshot** (and, for generated, the current room). A snapshot cannot express
*what happened over time* — transitions between rooms, or item / health / status
changes — because those are only distinguishable in the **event log**.

## 2. Why "from-events v1" is needed

The append-only `WorldEvent` log (ADR-0013) already records, in order, the exact
consequences a player caused: movements, item add/discover/remove, health
changes (with sign), status add/clear, and room-state/flag changes. None of this
chronology is available to a snapshot projector. A from-events projection lets
the journal read as an actual **log of consequences** ("You took harm.", "A
condition took hold.", "You pressed on to a new area.") using data **already
recorded** — no new events, no new extraction logic, no provider work.

It is deliberately **additive and safe**: it consumes the same trusted event log
the world already commits, and — like the existing journal — reduces everything
to closed phrases and counts so no content leaks.

## 3. Event types and data it may safely read

Source: `WorldSession.getEventLog(sessionId)` → `WorldEvent[]` (already
schema-validated, seq-ordered). Per event, the projector may read **only** the
fields marked ✅ below. Every ❌ field is content-bearing and must never be read
or echoed.

| Event type | Safe to read (✅) | Never read/echo (❌) |
|---|---|---|
| `session-started` | *(nothing — skipped)* | `payload.seed` (CanonSeed: `worldId`, canon text) |
| `moved-to-room` | presence of the event; `seq` (id/order only) | `fromRoomId`, `toRoomId` |
| `item-added` | presence; `seq` | `payload.item.name`, `payload.item.itemId` |
| `item-discovered` | presence; `seq` | `roomId`, `itemId` |
| `item-removed` | presence; `payload.quantity` (count only); `seq` | `itemId` |
| `health-changed` | **sign** of `payload.delta` (`<0` / `>0` / `0`); `seq` | `payload.reason`, the raw `delta` magnitude (only its sign is used) |
| `status-changed` | `payload.op` (closed enum `'add'`/`'clear'`); `seq` | `payload.status` (free string) |
| `room-state-changed` | whether **any** flag value is `true`; `seq` | `roomId`, flag **keys**, flag values as strings |

**Rule of thumb (the sanitizer contract):** read **closed enums** (`type`,
`op`), **numeric signs/counts** (`delta` sign, `quantity`, entry counts), and
`seq` (integer, used only for entry `id` and ordering). **Never** read any
string or object payload field. This exactly matches the v0 leak-guard posture.

## 4. Sanitizer / projection rules

- **Allowlist by event type.** A total `switch` over `WorldEvent['type']` maps
  each qualifying event to **at most one** closed, hand-written phrase. Unknown/
  future types and `session-started` fall through to *skip* (forward-compatible).
- **Closed phrase table only.** Entry `text` comes exclusively from a frozen
  `Record` of hand-written strings (illustrative wording; finalised in
  implementation):

  | Event → condition | Entry `text` (illustrative) |
  |---|---|
  | `moved-to-room` | "You pressed on to a new area." |
  | `item-added` | "You gained something of use." |
  | `item-discovered` | "You noticed something worth taking." |
  | `item-removed` | "You parted with something." |
  | `health-changed`, `delta < 0` | "You took harm." |
  | `health-changed`, `delta > 0` | "You recovered some vigor." |
  | `health-changed`, `delta === 0` | *(skip)* |
  | `status-changed`, `op === 'add'` | "A new condition took hold." |
  | `status-changed`, `op === 'clear'` | "A condition lifted." |
  | `room-state-changed`, any flag `true` | "Your actions left a mark here." |
  | `room-state-changed`, visited-only | *(skip — covered by movement)* |
  | `session-started` | *(skip)* |

- **Entry `id`:** `evt-${seq}` — `seq` is a per-session integer, unique, stable
  across reloads, and carries no content. Guarantees unique ids for the panel.
- **No numbers-with-content:** counts (`quantity`, totals) may appear as bare
  integers; no id, name, room, flag, status, or reason string ever appears.

## 5. Ordering and capping rules

- **Input order:** consume events in `seq`-ascending order (as returned by
  `getEventLog`).
- **Map → filter:** each event yields 0 or 1 entry per the allowlist; skipped
  events produce nothing.
- **Cap:** keep at most `MAX_EVENT_JOURNAL_ENTRIES` (proposed **15**) — the
  **most recent** qualifying entries (tail). This bounds noise from long
  sessions without paginating the panel.
- **Display order:** chronological ascending (oldest → newest), consistent with
  the existing journal's simple top-to-bottom list. *(Newest-first is a possible
  alternative; called out as a minor decision — default is ascending.)*
- **Determinism:** identical `events` input → identical `JournalView` output; no
  clock, no randomness, no `Date.now`.

## 6. Empty / fallback behaviour

- No events, only `session-started`, or no qualifying events → `entries: []`.
  The unchanged `JournalPanel` already renders "Nothing of consequence yet."
- The projector is **total and non-throwing.** Events arrive pre-validated from
  the log; the `switch` default *skips* unrecognised shapes, so even a
  forward-added event type degrades to "ignored," never a crash.
- **Save/load:** `InMemoryWorldStore.restoreSession` restores the full log, so
  post-load `getEventLog` returns the same history and the projection
  reconstructs identically — **no save/load change required.**

## 7. How it feeds the existing JournalPanel

The projector returns the existing shape:

```
buildEventConsequenceJournal(events: WorldEvent[]): JournalView
// → { journalId: 'event-consequence-journal', title: 'Consequences', entries }
```

`JournalPanel` consumes `JournalView` and is **unchanged**. Wiring (Slice 2)
fetches events via the existing `WorldSession.getEventLog(sessionId)` and feeds
the result through the same `journal` slot `App` already renders. **No new
component, no new prop, no new UI.**

### Locked decisions (D1 & D2)

**D1 — Source precedence: Option A, behind an explicit feature flag.**

- The event-derived journal is gated by the environment flag
  **`VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS === "true"`**, read only in the
  composition/app layer (consistent with `app/llmConfig.ts` being the sole
  `import.meta.env` reader — no domain/env coupling). **Default OFF.**
- **When OFF:** the existing generated/authored journal selection is
  **byte-identical** to today. The event projector is never invoked in the
  render path.
- **When ON:** for a session where the event projection **succeeds** and yields a
  `JournalView`, that view **may feed the existing `JournalPanel`** through the
  single `journal` slot. If projection does **not** succeed (see D2), the app
  **falls back to the existing behaviour** (generated XOR authored XOR null)
  unchanged.
- The single-render-slot rule is preserved: at most one source fills the slot.
  The flag + success/fallback rule *is* the precedence rule; no third panel.
- Rejected alternatives remain rejected: replacing the generated count-journal
  outright (behaviour change) and a second panel (violates "no new journal UI").

Slice 1 does **not** depend on D1 — the pure projector ships regardless of the
flag.

**D2 — Wiring seam: smallest async composition seam; no `refreshDerivedViews`
refactor.**

- `refreshDerivedViews` is **not** refactored. It stays synchronous over
  `WorldState`, and the existing generated/authored journal path through
  `computeDerivedViews` is untouched.
- The event journal is wired via the **smallest async composition seam** near the
  existing **session-start / load / room-entry** flows: at those points the app
  calls `WorldSession.getEventLog(sessionId)`, runs `buildEventConsequenceJournal`
  on the result, and — only when D1's flag is ON and projection succeeds — sets
  the existing `journal` view-model slot to the event-derived `JournalView`.
- **No polling, no subscriptions, no event writes, no App.tsx-heavy refactor.**
- **On async failure** (the `getEventLog` call rejects/returns not-found, or the
  projection throws) the existing journal behaviour is **left unchanged** — the
  app keeps whatever `refreshDerivedViews` already produced. Failure is silent
  and non-blocking (no user-facing error, no gameplay impact).

## 8. Non-goals

- No new event types, no event-extraction logic, no changes to what gets
  recorded. Read-only over existing events.
- No event-log mutation; no memory writes; no room-memory mutation.
- No provider / LLM / prompt changes; no cost/usage interaction.
- No schema or save-load changes.
- No FTS / persistence / backend / server work.
- No new journal UI component; `JournalPanel` reused unchanged.
- No timestamps, ids, names, room names, flag keys, statuses, reasons, or seed/
  prompt/provider text rendered anywhere.
- No gameplay-authority or consequence-authority change: the journal is display
  only and never influences state, quests, objectives, or flags.
- No `refreshDerivedViews` refactor and no App.tsx-heavy refactor (D2). Wiring is
  a minimal async composition seam near existing session/load/room-entry flows;
  no polling, no subscriptions, no event writes.
- Not on by default: the event source ships behind
  `VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS` (default OFF) and falls back to existing
  journal behaviour on projection/async failure (D1).

## 9. Safety boundaries (must hold in every slice, asserted by tests)

1. **No authority change.** No write path; appends no events, emits no commands,
   mutates nothing. `WorldSession` + event log + reducers remain the sole truth.
2. **No content leakage.** Never reads/outputs `seed`, room ids, item names/ids,
   `health.reason`, raw `status` strings, flag keys/values, or any other string
   payload. Enforced by sentinel leak-guard tests.
3. **Append-only preserved.** Uses only the read path `getEventLog`; the store's
   append-only guarantees are untouched.
4. **No schema change.** `RoomSpec`, `QuestSpec`, `JournalSpec`, `SaveGame`,
   `WorldEvent`/`WorldState` schema versions all remain `1`. No new zod schema.
5. **Existing journals unchanged.** `demoJournalSpec`, `projectJournal`,
   `buildGeneratedConsequenceJournal`, and `JournalPanel` are byte-identical;
   their tests stay green.
6. **Single render slot, flag-gated precedence (D1).** At most one journal source
   fills the slot. The event source is OFF by default and only fills the slot when
   `VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS === "true"` **and** projection succeeds;
   otherwise the existing generated/authored behaviour is byte-identical.
7. **No cost impact.** Pure/synchronous projector; the only added call is the
   already-existing in-memory `getEventLog`. No LLM/network/I-O.
8. **Log-safe.** Domain projector is silent (no logger). Wiring adds no new log
   line; counts/enums are not logged either.

## 10. Proposed slices

### Slice 1 — Pure domain projector (self-contained, no wiring)

**Goal:** ship `buildEventConsequenceJournal` fully tested, with zero runtime/UI/
App change.

**Add:**
- `apps/web/src/domain/journal/eventConsequenceJournal.ts`
- `apps/web/src/domain/journal/eventConsequenceJournal.test.ts`

**Permitted imports (domain layer only):**
- `../world/events` — **type only** (`WorldEvent`). *(No `zod` at runtime; type
  import erases.)*
- `./projectJournal` — **types only** (`JournalView`, `JournalEntryView`).

**Must not import:** `zod`, `react`, `three`, `platform/**`, `world-session/**`,
`interactions/**`, `encounters/**`, `dialogue/**`, `memory/**`,
`persistence/**`, `server/**`.

**Do not touch any other file.** Stop point: targeted test + build + lint green.

### Slice 2 — Composition wiring (flag-gated, per D1 & D2)

**Prerequisite:** Slice 1 merged. No further decision needed — D1/D2 are locked
above.

**Goal:** behind `VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS === "true"` (default OFF),
feed a successful event-derived `JournalView` through the existing `journal` slot
per D1, using the smallest async seam per D2. `JournalPanel` reused unchanged.

**Likely modified:**
- `apps/web/src/App.tsx` — near the existing **session-start / load / room-entry**
  flow: read the flag (via the app-layer env reader, e.g. `app/llmConfig.ts` or a
  sibling), call `WorldSession.getEventLog(sessionId)`, run
  `buildEventConsequenceJournal`, and — only when the flag is ON and projection
  succeeds — set the existing `journal` view-model slot to the event-derived
  view. On any async failure, leave the existing journal state as-is.

**Must not touch (byte-identical):** `renderer/ui/JournalPanel.tsx`,
`journalSpec.ts`, `projectJournal.ts`, `demoJournal.ts`,
`generatedConsequenceJournal.ts`, `app/derivedViews.ts` **journal selection
logic** (the generated/authored path stays unchanged), `refreshDerivedViews`
(**no refactor**, per D2), `renderer/**`, schemas, `world-session/**` internals,
memory/FTS files, `eslint.config.js`, `package.json`.

**Design note (async seam, per D2):** `refreshDerivedViews` remains synchronous
and untouched. The event journal is set from a small async step in the existing
session/load/room-entry composition — no polling, no subscription, no event
write. If `getEventLog` rejects/returns not-found or projection throws, the app
keeps the existing journal behaviour unchanged.

### Slice 3 — Docs / status closeout

**Prerequisite:** Slice 2 merged.

- Mark this plan complete.
- Short ✅ entry in `docs/architecture/ARCHITECTURE.md`.
- Short safe-degradation entry in `docs/architecture/FAILURE-MODES.md`.
- **ADR:** do **not** author one by default. Consider an ADR **only if** the
  implementation meaningfully changed journal-source precedence beyond the
  locked flag-gated Option A (D1). As specified, it does not, so no ADR is
  expected.
- No runtime file changes in this slice.

---

## 11. Tests

Modelled on `generatedConsequenceJournal.test.ts` (pure Vitest, no DOM/jsdom).

**Slice 1 — `eventConsequenceJournal.test.ts`:**

1. **Empty log → empty view, no throw.** `[]` → `entries: []`, correct
   `journalId`/`title`.
2. **`session-started`-only → empty.** No entry produced.
3. **Per-type mapping.** One qualifying event of each type → expected closed
   phrase / skip, per the table in §4.
4. **Health sign split.** `delta < 0` → "took harm"; `delta > 0` → "recovered";
   `delta === 0` → skipped.
5. **Status op split.** `op:'add'` vs `op:'clear'` → distinct phrases.
6. **Room-state split.** Any flag `true` → mark entry; visited-only → skipped.
7. **Ordering.** Mixed events → entries follow `seq`-ascending order.
8. **Cap.** More than `MAX_EVENT_JOURNAL_ENTRIES` qualifying events → only the
   most-recent N remain, newest retained.
9. **Stable ids.** Entry ids are `evt-${seq}`, unique.
10. **Purity / no mutation.** Input `events` deep-equal before/after; fresh
    arrays each call; identical input → identical output.
11. **Structural export check.** Module exports only
    `buildEventConsequenceJournal`; nothing returning `WorldEvent`/`WorldCommand`.
12. **Leak-guards (sentinels).** Build events with distinctive sentinels in
    every content-bearing field and assert **none** appear in any entry `text`:
    - `session-started` → `seed.worldId` / canon text sentinel
    - `moved-to-room` → `fromRoomId`/`toRoomId` sentinel
    - `item-added` → `item.name` / `item.itemId` sentinel
    - `item-discovered` → `roomId`/`itemId` sentinel
    - `item-removed` → `itemId` sentinel
    - `health-changed` → `reason` sentinel
    - `status-changed` → `status` sentinel
    - `room-state-changed` → flag **key** sentinel; assert no `interaction:`
    Also assert no entry contains an event-type token or `seq` string content
    beyond the `evt-` id.

**Regression (must stay green, unmodified):**
`domain/journal/projectJournal.test.ts`,
`domain/journal/generatedConsequenceJournal.test.ts`,
`app/derivedViews.test.ts`, and (after Slice 2) `App.test.tsx`.

---

## 12. Manual smoke (applies after Slice 2 wiring only)

1. `npm run dev`; start a session that produces events (move rooms, take an
   item, trigger a health/status change).
2. Open the Journal panel; confirm it lists closed consequence phrases in
   chronological order, capped to the most recent N.
3. Confirm **no** room name, object/item name, id, flag key, status string,
   reason, timestamp, or seed/prompt text appears.
4. Trigger harm vs recovery; confirm the two distinct health phrases.
5. Add then clear a status; confirm the two distinct status phrases.
6. Save → load; confirm the journal reconstructs identically from the restored
   log (no extra/missing entries).
7. **Flag OFF (default, no env var):** confirm the generated/authored journal is
   exactly as today and the event projector never appears.
8. **Flag ON (`VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS=true`):** confirm the
   event-derived journal feeds the panel on success; simulate a `getEventLog`
   failure / empty projection and confirm the app silently keeps the existing
   journal behaviour (no error, no gameplay impact).
9. `npm run build` — confirm green.

---

## 13. Review checklist

- [ ] Slice scope respected; no scope expansion.
- [ ] `JournalPanel` and both existing journal sources are byte-identical.
- [ ] Projector reads only closed enums, numeric signs/counts, and `seq`.
- [ ] Leak-guard tests cover every content-bearing payload field and pass.
- [ ] No event-log mutation; no write path; no command/event emitted.
- [ ] No memory / room-memory / provider / prompt / cost interaction.
- [ ] No schema, save-load, FTS, persistence, or server change.
- [ ] No new UI component; no `refreshDerivedViews`/App.tsx-heavy refactor (D2).
- [ ] Event source flag-gated (`VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS`, default
      OFF); OFF path byte-identical; ON falls back on projection/async failure (D1).
- [ ] Single render slot; env flag read only in the app/composition layer.
- [ ] Domain projector imports no `zod`/`react`/`three`/`platform`/app layers.
- [ ] Projector is pure, total, deterministic, non-throwing.
- [ ] `npm run test` (targeted), `npm run build`, `npm run lint` reported green.
</content>
</invoke>

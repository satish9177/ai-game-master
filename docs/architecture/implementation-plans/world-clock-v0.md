# Implementation Plan — `feature/world-clock-v0`

> Status: **IMPLEMENTED / CLOSED.**
> A pure, deterministic world clock derived as a read-only projection over the
> existing `WorldEvent` log, plus a read-only HUD line. No authoritative state,
> schema, event, persistence, provider, or renderer change. See §12 Closeout.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the authoritative event-log model
> ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)) and reuses the
> existing read-only HUD/journal projection pattern.
>
> **No ADR proposed.** This feature deliberately touches **no** architectural
> boundary: no `WorldState` field, no new `WorldEvent`/`WorldCommand`, no schema
> or save-game change, no persistence/migration, no new lint rule. It reuses
> ADR-0013's "event log is authoritative, everything else is a projection"
> decision rather than making a new one. This matches the plan-only precedent set
> by `npc-relationship-state-v0` and `structured-dialogue-effects-v0`: an ADR is
> written only when/if a later slice touches a boundary (e.g. persisting the
> clock, or wiring it into dialogue/provider context).

---

## 1. Title and status

**World Clock v0 — a pure, deterministic, non-authoritative world clock
(`day` / `hour` / `timeOfDay`) derived by projecting the existing `moved-to-room`
events out of the authoritative `WorldEvent` log, surfaced only as a read-only
HUD line.**

Status: **IMPLEMENTED / CLOSED.** See §12 Closeout. `npm run build`,
`npm run lint`, and the full `npm run test` suite are **clean/green** (§12).

---

## 2. Problem statement

The world has no notion of in-fiction time. We want a minimal, safe sense of
"when" — a world day, a world hour, and a coarse `timeOfDay` band
(dawn/day/dusk/night) — so the HUD can show it and later features can build on
it.

The obvious trap is to make time a *stateful, mutable* thing: a field on
`WorldState`, an `advance-time` event, or worst of all a real wall-clock timer
(`setInterval` / `Date.now`) mutating the world in the background. Every one of
those adds an authoritative-state surface, a save/load/schema burden, a
double-advancement risk, and a path for an LLM to influence time. None of that is
needed for v0.

This plan defines the **smallest safe clock**: a pure function of the event log
that is already authoritative and already persisted, exposed read-only.

---

## 3. Current architecture recap

Grounded in the code as it exists today:

- **Authoritative truth** — `WorldState` (`domain/world/worldState.ts`,
  `schemaVersion 1`, `.strict()`) is projected from the append-only `WorldEvent`
  log via `applyEvent` / `projectWorldState` (`domain/world/applyEvent.ts`).
  State changes **only** by appending a validated event and projecting it
  (ADR-0013). There is no time/clock field anywhere in `WorldState`.
- **Travel is already an event.** `moved-to-room` (`domain/world/events.ts`) is
  appended by `WorldSession.move` on a successful room transition. It is the one
  in-fiction "time passes" signal already in the log.
- **Blocked navigation appends nothing.** `navigateWithExitGate`
  (`app/gatedNavigation.ts`) returns `reason: 'gate-locked'` **without** appending
  a `moved-to-room` event when a gate is locked.
- **Dialogue appends nothing.** `NPCDialogueService` is read-only display data; it
  never appends events (ADR-0017).
- **Pregeneration appends nothing.** `AdjacentRoomPregenerator` only warms a room
  cache; it makes no `WorldEvent`.
- **The save *is* the log.** `SaveGame` (`domain/world/saveGame.ts`) persists
  `log: WorldEvent[]` **and** `snapshot: WorldState`. Anything derivable from the
  log restores for free with no schema or save-game change.
- **Read-only projections are an established pattern.** The player HUD, quest
  tracker, and journal are all read-only view-models projected from authoritative
  state and rendered presentationally; the event-derived consequence journal
  (`app/eventConsequenceJournalSeam.ts`) already reads the event log via
  `WorldSession.getEventLog` behind a monotonic-guarded async seam.

**Key structural fact that shapes this plan:** because travel is already an event
and the log is already persisted, the clock does **not** need to be stored,
mutated, or timed. It only needs to be *read*.

---

## 4. Design decision — derived projection, not persisted state

**The clock is a pure projection over the event log. It is never persisted state.**
This was the central decision of the design review, and the codebase forces it:

- **`WorldState` is `.strict()` and event-projected.** Adding `worldDay`/
  `worldHour` fields would be a schema change touching the snapshot, the
  projection, and every `.strict()` validation site, and would invite a
  `schemaVersion` bump. The event log stays the single source of truth (ADR-0013);
  a second, hand-maintained time field would be a competing source of truth.
- **The log is already the save.** `SaveGame` parks the full `log`, so a clock
  derived from `moved-to-room` events **restores identically after load/replay**
  with **zero** save-game, schema, or migration change.
- **Determinism is free.** A pure function of an immutable, ordered log is
  deterministic by construction: same log → same clock, on every machine, on every
  replay.
- **The hard boundaries fall out automatically.** No `WorldState` mutation, no new
  event/command, no timer, and no LLM write path — see §5 and §7 — because the
  projection *reads* events rather than *producing* them.

The rejected alternative (a persisted `advance-time` event plus a `WorldState`
field) is the *only* approach that simultaneously requires an event-schema change,
a `WorldState` field, `applyEvent` handling, save/load reasoning, payload
determinism concerns, **and** opens the double-advancement and LLM-leak surfaces.
It is unjustified for v0 and was not built.

### Time model (as implemented)

`computeWorldClock(log)` in `domain/world/worldClock.ts`:

- Counts `moved-to-room` events in the log.
- `absoluteHours = (START_DAY − 1) × 24 + START_HOUR + moves × HOURS_PER_MOVE`,
  with `START_DAY = 1`, `START_HOUR = 8`, `HOURS_PER_MOVE = 1`, `HOURS_PER_DAY = 24`.
- `day = ⌊absoluteHours / 24⌋ + 1`, `hour = absoluteHours mod 24`.
- `timeOfDay = timeOfDayForHour(hour)` using half-open bands so each hour maps to
  exactly one bucket: **night `[0,5)` · dawn `[5,8)` · day `[8,18)` · dusk `[18,21)`
  · night `[21,24)`**.
- An empty log (or a session with no moves yet) reads as the start: **Day 1,
  Hour 8, "day"**.

The function is pure domain: it imports only the `WorldEvent` type, holds no
state, performs no I/O, and never reads `Date.now()`.

---

## 5. Advancement rules

Time advances **only** on successful in-fiction travel. All other cases leave the
clock untouched — and, critically, do so *by construction* because the projection
counts a specific event type rather than reacting to UI actions:

| Case | Appends `moved-to-room`? | Advances time? |
| --- | :---: | :---: |
| **Successful room transition** | Yes | **Yes** (`+HOURS_PER_MOVE`) |
| **Generated adjacent-room transition** | Yes (same event, once) | **Yes** (once) |
| **Dialogue turn** (prompt / free text / Continue) | No (read-only service) | **No** |
| **Blocked / gate-locked navigation** | No (`gate-locked` returns early) | **No** |
| **Background pregeneration** (adjacent warming) | No (cache only) | **No** |
| **Save / load / replay** | No new events; re-projects the log | **No** (re-derives identically) |
| **Non-move events** (item, health, status, room-state-changed, session-started) | n/a | **No** |

Because advancement is defined as "count `moved-to-room` events," dialogue,
blocked navigation, and pregeneration cannot advance time even in principle: they
append no such event. Non-move events are ignored by the counter. Save/load/replay
re-derives the same value from the same persisted log.

---

## 6. Safe context / HUD exposure

- **Read-only projection only.** The clock is surfaced as a small HUD line
  (`Day 1 · 08:00 · Day`) rendered by `StatusHud`, which receives an optional,
  defaulted `clock` prop. It is presentational, `pointer-events: none`, and writes
  nothing back into any domain state.
- **Only `day` / `hour` / `timeOfDay` are exposed.** No raw event data, room names,
  or other content is projected through the clock.
- **Composition-root seam, mirroring the journal seam.** `App` computes the clock
  via `applyWorldClockFromSession`, whose only call is the in-memory
  `WorldSession.getEventLog`; a monotonic request id drops stale async results so a
  newer refresh always wins. It appends nothing and mutates no truth. It runs at
  the same derived-view refresh points as the existing journal seam
  (bootstrap / prompt-start / load / navigation).
- **No provider / LLM write path.** The clock is derived from the log only. No
  provider, prompt, template, or dialogue-context injection reads or writes it in
  v0. An LLM cannot set, nudge, or observe time through any structured effect.

---

## 7. Explicit non-goals

None of the following are in v0 (they are hard "not this feature," each a possible
future slice with its own approval):

- ❌ **No `WorldState` field, `WorldEvent`, `WorldCommand`, or `applyEvent`
  change.** Time is not authoritative state.
- ❌ **No `SaveGame` / schema change, no `schemaVersion` bump, no SQLite
  migration.** The clock rides the already-persisted log.
- ❌ **No wall clock.** No `setInterval`, no `Date.now`, no background/real-time
  mutation of the world.
- ❌ **No day/night rendering or lighting.** The renderer/engine is untouched; the
  clock is data, not a light rig.
- ❌ **No lazy room-environment transitions.** Rooms do not re-theme, re-light, or
  regenerate as time passes.
- ❌ **No rest action.** There is no `rest`/`wait` event today; adding one is a new
  command/event and is out of scope.
- ❌ **No "major interaction" time costs.** Interactions (item/health/status/
  room-state) do not advance time in v0; only travel does.
- ❌ **No NPC routines / schedules / patrols.** NPC behavior is not driven by the
  clock.
- ❌ **No dialogue/provider/context injection** of time (deferred; would be its own
  reviewed slice and likely its own ADR).
- ❌ **No configurable start hour via `CanonSeed`** (that would be a schema change);
  start is a domain constant.

---

## 8. Authority model

**The world clock is a non-authoritative, derived projection. It is strictly below
`WorldState`.**

| Concept | Authoritative? | Mutates truth? | Persisted? | Derived from |
| --- | :---: | :---: | :---: | --- |
| `WorldEvent` log / `WorldState` | **Yes** | Yes (reducer) | Yes | validated commands |
| **`WorldClock` (this feature)** | **No — projection** | **No** | **No (re-derived)** | *`moved-to-room` events only* |

Locked invariants:

- The clock never becomes a `WorldEvent`, `WorldCommand`, `WorldState` field,
  `CanonSeed`, save-game field, SQLite row, or API payload.
- The clock never gates navigation, interactions, encounters, quests, inventory,
  or exits.
- `computeWorldClock` has no write path to truth: it imports only the `WorldEvent`
  type from `domain/**`. It cannot reach `world-session`/`interactions`/
  `encounters`/`dialogue`.

---

## 9. Determinism and tests

Deterministic, co-located Vitest at `domain/world/worldClock.test.ts`
(10 tests, all passing):

- **empty-log default** → Day 1, Hour 8, "day".
- **session-started only (no moves)** → start value.
- **`moved-to-room` advances** one hour per move (1/3/9 moves).
- **non-move events do not advance** (item/health/status/room-state/removed).
- **interleaved** moves + non-moves count only the moves.
- **day rollover** at hour 24 (16 moves → Day 2 00:00; 17 → 01:00; 40 → Day 3 00:00).
- **bucket boundaries** as hours cross 17→18 (day→dusk), 20→21 (dusk→night), into
  next-day 05:00 (dawn); plus a direct `timeOfDayForHour` boundary table
  (0/4/5/7/8/17/18/20/21/23).
- **determinism**: the same log yields byte-equal clocks; repeated calls are equal.
- **save/load equivalence via the persisted log**: a `SaveGameSchema.parse`
  round-trip's `log` yields the identical clock.

---

## 10. Implementation slices / files

- **Slice 1 — pure domain projection.** `domain/world/worldClock.ts`
  (`computeWorldClock`, `timeOfDayForHour`, `WorldClock`/`TimeOfDay` types,
  `START_DAY`/`START_HOUR`/`HOURS_PER_MOVE`/`HOURS_PER_DAY` constants) plus
  co-located tests. Unwired; called by tests only.
- **Slice 2 — read-only HUD exposure.** `App` gains a `worldClock` state and the
  `applyWorldClockFromSession` monotonic-guarded event-log seam, called at the
  existing derived-view refresh sites; `StatusHud` gains an optional `clock` prop
  and renders the clock line; `index.css` adds one `.status-hud-clock` rule.

**Deferred future features (each its own plan/approval):** dialogue/provider time
awareness; a `rest`/`wait` action (a new command/event); interaction time costs;
NPC routines/schedules; day/night rendering; configurable start via `CanonSeed`.

---

## 11. Minimum Safe Change Check (per AGENTS.md)

- **Reused:** the authoritative `WorldEvent` log and `moved-to-room` event; the
  `WorldSession.getEventLog` read path; the monotonic-guarded async view seam
  pattern from the event-consequence journal; the read-only HUD projection pattern
  and `StatusHud`; the `SaveGame` log for free save/load; the existing `domain/**`
  and composition-root lint allowances (no new rule).
- **Minimum new code:** one pure domain function file + its tests, one `App` seam +
  a state field, one optional `StatusHud` prop, one CSS rule.
- **Safety boundaries unchanged:** no `WorldEvent`/`WorldCommand`/`applyEvent`/
  `WorldState`; read-only services untouched; memory firewall intact; no
  persistence/migration/schema bump; no provider/prompt change; no timer; the
  renderer/engine is untouched; the clock derives only from `moved-to-room` events.
- **Tests prove it:** §9.

---

## 12. Closeout

**Final status: COMPLETE.**

**Implemented files:**

- `apps/web/src/domain/world/worldClock.ts` — pure `computeWorldClock(log)` +
  `timeOfDayForHour`, types, and constants.
- `apps/web/src/domain/world/worldClock.test.ts` — 10 deterministic tests.
- `apps/web/src/App.tsx` — `worldClock` state + `applyWorldClockFromSession`
  read-only event-log seam, called at the existing derived-view refresh sites.
- `apps/web/src/renderer/ui/StatusHud.tsx` — optional read-only `clock` prop +
  presentational clock line.
- `apps/web/src/index.css` — `.status-hud-clock` styling.

**Verification commands / results:**

```bash
npm run test          # 193 files / 3242 tests passing
npm run lint          # clean
npm run build         # tsc -b && vite build — clean
```

- Targeted: `npm run test -- worldClock StatusHud Hud` → 32 passed.
- Full suite: **193 files / 3242 tests passed.**
- Lint: clean. Build (`tsc -b && vite build`): clean.

**Safety boundary confirmation:**

- No `WorldState` field and no `WorldState` mutation.
- No new `WorldEvent` / `WorldCommand`; `applyEvent` untouched.
- No `SaveGame` / `RoomSpec` / `QuestSpec` schema change, no `schemaVersion` bump,
  no SQLite migration; save/load/replay re-derives the clock from the persisted
  log.
- No wall clock — no `setInterval`, no `Date.now`, no background real-time
  mutation.
- No provider / LLM / prompt / dialogue-context write or read path to time.
- No renderer/engine change; no day/night rendering or lighting; no lazy room
  transitions.
- No rest action, no interaction time costs, no NPC routines.
- `computeWorldClock` is pure domain with no import path to `world-session` or any
  application layer; no new lint rule was required.

**Known limitations / deferred:**

- Time advances on travel only; there is no `rest`/`wait` and no interaction time
  cost in v0.
- The clock is display-only: no gameplay, dialogue, rendering, or NPC behavior
  reads it yet.
- Start-of-day is a fixed domain constant (Day 1, Hour 8); it is not configurable
  through `CanonSeed`.

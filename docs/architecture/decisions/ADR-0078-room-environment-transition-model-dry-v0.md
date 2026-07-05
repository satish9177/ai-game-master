# ADR-0078: Room environment transition model is dry until authoritative environment state exists

- **Status:** Accepted / Implemented (model-only / dry-at-runtime)
- **Date:** 2026-07-05
- **Deciders:** Project owner
- **Builds on:**
  [`world-clock-v0`](../implementation-plans/world-clock-v0.md),
  [`time-context-and-day-night-presentation-v0`](../implementation-plans/time-context-and-day-night-presentation-v0.md)
  ([ADR-0076](./ADR-0076-read-only-timeofday-dialogue-context-v0.md)),
  and the dry-reducer pattern of
  [`valenced-dialogue-effect-candidates-v0`](../implementation-plans/valenced-dialogue-effect-candidates-v0.md)
  ([ADR-0075](./ADR-0075-valenced-dialogue-effect-candidates-v0.md)) and
  [`relationship-valence-reducer-v0`](../implementation-plans/relationship-valence-reducer-v0.md)
  ([ADR-0077](./ADR-0077-relationship-valence-reducer-v0.md)).

> Full plan, transition table, elapsed-time helper design, test plan, and slices live
> in [`lazy-room-environment-transitions-v0`](../implementation-plans/lazy-room-environment-transitions-v0.md).
> This ADR records the decision and delivery closeout.

---

## Context

We want rooms to reflect passing in-fiction time: a fire left burning should later
read as smoldering, then burned-out, with ambient after-effects (stale smoke, cold
ashes), computed **lazily on room enter/read** from the deterministic world clock —
never on timers or a background loop.

`world-clock-v0` already exists and gives us the temporal spine: a pure, deterministic
`WorldClock` projected over the authoritative `WorldEvent` log by counting
`moved-to-room` events, with no wall clock, no `WorldState` field, and no schema/save
change. ADR-0076 exposed only the coarse `timeOfDay` enum to dialogue and **explicitly
deferred** "lazy room/object transitions" to a separate ADR — this is that ADR.

The blocking fact is architectural: **room environment state does not exist.** The
only room-scoped authoritative state is `WorldState.roomStates[roomId] =
{ visited, flags? }`, whose `flags` are booleans only — no environment kind, no
intensity, no "established-at" anchor. `corpse` is a visual `RoomObject` type; `torch`/
`candle`/`flicker` are lighting presentation. Nothing in `domain`/`world`/`persistence`
models fire, smoke, or ash.

Consequently a **visible** fire/smoke transition in v0 is not safely reachable. It
would require one of the shortcuts the repo has repeatedly rejected: inferring state
from **raw generated text or object names/types** (a "no text sniffing" / logging
violation), **mutating the generated `RoomSpec`**, adding a **schema/save** field, or
minting a **new `WorldEvent`/`WorldCommand`**. Additionally, even with a source, the
event log yields only *hours-since-the-player-last-entered a room*, not
*hours-since-ignition*; a true origin anchor would itself require persisted state.

Two facts shape the safe design:

1. The transition mechanics (a closed state machine + an elapsed-hours input) can be
   modeled purely and deterministically today, reusing the `world-clock-v0` accounting.
2. There is no authoritative *source* of environment state, so a closed transition
   model is **inert at runtime** until a separate, approved source feature exists —
   exactly the situation `valenced-dialogue-effect-candidates-v0` and
   `relationship-valence-reducer-v0` shipped into safely.

---

## Decision

Add **only a pure model and reducer** in v0, and keep it **dry at runtime**.

- **Closed fire/smoke state enum only.** `RoomEnvironmentState` is
  `{ kind: 'burning' | 'smoldering' | 'burned_out' }`. No other environment kinds and
  **no numeric intensity field** (a continuous value would imply an origin anchor the
  repo cannot authoritatively supply).
- **Closed presentation tags only.** `EnvironmentPresentationTag` is
  `'stale_smoke' | 'cold_ashes'`. Tags are **display-only data**, never authoritative
  truth and never a `RoomSpec` field.
- **Pure deterministic reducer.** `projectRoomEnvironment(prior, elapsedWorldHours)` is
  a total function over the closed enum and a non-negative elapsed value, driven by a
  frozen threshold table: `burning → smoldering → burned_out`, monotonic, saturating at
  the terminal `burned_out`, with half-open thresholds (mirroring `timeOfDayForHour`).
  Recomputation with equal-or-greater elapsed time is stable.
- **Pure elapsed-time helper.** `elapsedWorldHoursSinceLastEntered(log, roomId)` reuses
  the `world-clock-v0` move-count accounting to derive hours-since-last-entered from the
  existing event log; it reads the log and returns a number, never appends, and returns
  `0` when the room was never entered. `world-clock-v0` advancement rules are unchanged.
- **No visible transitions until an authoritative environment source exists.** No
  runtime/composition code constructs or applies a `RoomEnvironmentState`, so the
  reducer is **dry** in live gameplay — proven by a dedicated dry-at-runtime test, not
  merely asserted. There are no room changes and no UI changes.
- **No schema / save / event / command / `RoomSpec` mutation.** Environment state is a
  pure projection helper in `domain/world/`, never a `WorldState` field, `WorldEvent`,
  `WorldCommand`, save-game field, persisted row, or `RoomSpec` field. `applyEvent` is
  untouched. No `schemaVersion` bump.
- **No raw text inference.** State is a total function of the closed enum; it is never
  derived from generated room/object/prompt/dialogue text or object names/types, by
  regex, keyword, heuristic, or an LLM label.
- **No timers / `Date.now` / `setInterval` / background simulation, no LLM/provider,
  no corpse/blood cleanup, no NPC routines.** Lazy-only is structural: the model is a
  pure function a future consumer may call on enter/read, never on a loop.

The model becomes live behavior only when a future, separately-approved
`room-environment-state-source-v0` establishes an authoritative environment state, at
which point a `room-environment-transition-runtime-v0` slice wires the lazy read and a
`room-environment-presentation-v0` slice surfaces tags UI-only.

---

## Consequences

- **The feature has no manual, visible gameplay effect yet.** No fire visibly becomes
  smoke or ash; no room, HUD, or renderer output changes. This is intended.
- **It creates a safe, closed, reviewed contract for future runtime transitions.** The
  state machine, thresholds, presentation mapping, and elapsed-time derivation are
  fixed and tested now, so the later source/runtime/presentation slices are small and
  low-risk.
- **The path to going live is explicit:** add an authoritative environment-state source
  (its own feature, where the schema/event decision is made), then wire the lazy read,
  then the UI presentation — each separately approved.
- **No text- or LLM-based environment path is introduced.** State can only ever come
  from the closed enum via an authoritative source, never from sniffing generated
  content.
- **No authoritative-state, `RoomSpec`, persistence, migration, save-game,
  provider, prompt, UI, renderer, or lint-rule change is introduced. No `schemaVersion`
  bump.** Build stays green.
- **Deferred (each its own maintainer-approved feature/ADR):**
  1. `room-environment-state-source-v0` — how environment state is authoritatively
     established (owns the schema/event decision).
  2. `room-environment-transition-runtime-v0` — lazy room-enter/read wiring.
  3. `room-environment-presentation-v0` — UI-only presentation of tags (not renderer
     lighting).
  4. `corpse-blood-cleanup-v0` — only after structured body/gore state exists; never by
     `RoomSpec` mutation or object-name inference.
- **Recorded limitation:** the elapsed-time helper yields hours-since-last-entered, not
  hours-since-ignition; a true ignition anchor is part of the deferred source feature.

---

## Alternatives considered

- **Ship a visible fire/smoke v0 now.** Rejected: it requires unsafe text/object-name
  inference, `RoomSpec` mutation, or new schema/event surface — all out of scope and
  each a boundary violation.
- **Model a numeric smoke-intensity that decays over elapsed time.** Rejected for v0: a
  continuous value implies an authoritative ignition/established-at anchor the event log
  cannot supply; the coarse `stale_smoke` tag conveys "fading" without inventing state.
- **Derive environment state from existing boolean `flags`.** Deferred to the source
  feature: flags carry no environment semantics or time anchor today, and overloading
  them here would be inference without a reviewed contract.
- **Plan-only, no ADR.** Rejected: this is the first world-time-driven room-environment
  concept and establishes the environment-state model plus the authority/presentation
  boundary; ADR-0076 explicitly flagged it as warranting its own decision record.
- **Renderer day/night or fire lighting.** Rejected for v0: it touches the trusted
  Three.js renderer (ADR-0001/ADR-0002), a far larger surface with no v0 value;
  presentation, when it lands, will be UI-only.

---

## Verification

Implemented and verified 2026-07-05.

Files changed:

- `apps/web/src/domain/world/roomEnvironment.ts`
- `apps/web/src/domain/world/roomEnvironment.test.ts`

Threshold constants chosen (final, as implemented — recorded per the decision that
thresholds are constants in one file, covered by boundary tests):

- `SMOLDER_AFTER_HOURS = 2`
- `BURNED_OUT_AFTER_HOURS = 6`

Both are exported `as const` and mirrored read-only in the frozen
`ROOM_ENVIRONMENT_TRANSITION_THRESHOLDS` object; no other threshold or numeric field
exists.

Verification run:

```bash
npm.cmd run test -- roomEnvironment
npm.cmd run lint
npm.cmd run build
npm.cmd run test
git diff --check
```

Results:

- `npm.cmd run test -- roomEnvironment` passed: 18 tests.
- `npm.cmd run lint` passed.
- `npm.cmd run build` passed.
- `npm.cmd run test` passed: 197 files / 3357 tests (full suite, unaffected).
- `git diff --check` passed (no whitespace errors).

Dry-at-runtime scan fix: the non-emission test's `import.meta.glob` scans both
`../../**/*.ts` **and** `../../**/*.tsx` production sources (excluding the module's
own `.ts` file and any `.test.ts`/`.test.tsx` file) for the strings `roomEnvironment`
/ `RoomEnvironmentState`. An initial `.ts`-only glob would silently miss a future
`.tsx` importer and let a live wire-up through the dry-at-runtime proof undetected;
scanning both extensions closes that gap.

The model remains dry at runtime and has no visible gameplay behavior: no runtime or
composition module imports `roomEnvironment.ts`, no `RoomEnvironmentState` is
constructed or applied outside the module's own test, and no room/HUD/renderer output
changes. Confirmed boundaries, unchanged:

- No `WorldState` / `WorldEvent` / `WorldCommand` / `applyEvent` change.
- No schema / save / persistence / migration / `schemaVersion` bump.
- No `RoomSpec` mutation.
- No UI / renderer / runtime wiring.
- No timers, `Date.now`, `setInterval`, or background simulation.
- No LLM / provider involvement.
- No raw prompt / generated text / object-name inference or logging.

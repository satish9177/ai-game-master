# Implementation Plan — `feature/lazy-room-environment-transitions-v0`

> Status: **PROPOSED / model-only / dry-at-runtime.**
> This slice adds a pure, closed room-environment transition model plus a pure
> elapsed-world-hours helper and their tests. It has **no visible runtime
> behavior**: no code path constructs or applies a `RoomEnvironmentState`, so the
> reducer is dry in live gameplay, proven by a dedicated dry-at-runtime test.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out `world-clock-v0`
> ([plan](./world-clock-v0.md)) and
> `time-context-and-day-night-presentation-v0`
> ([plan](./time-context-and-day-night-presentation-v0.md) · [ADR-0076](../decisions/ADR-0076-read-only-timeofday-dialogue-context-v0.md)),
> and follows the dry-reducer pattern of `valenced-dialogue-effect-candidates-v0`
> ([plan](./valenced-dialogue-effect-candidates-v0.md) · [ADR-0075](../decisions/ADR-0075-valenced-dialogue-effect-candidates-v0.md))
> and `relationship-valence-reducer-v0`
> ([plan](./relationship-valence-reducer-v0.md) · [ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)).
> See [ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md).

---

## 0. Approval status and locked invariants (read first)

The maintainer approved this feature **narrowed to model-only / dry-at-runtime**.
These invariants may not be relaxed without explicit maintainer approval:

- **Closed fire/smoke state enum only:** `burning | smoldering | burned_out`. No
  other environment kinds, no numeric intensity field.
- **Closed presentation tags only:** `stale_smoke | cold_ashes`. Presentation tags
  are display-only data, never authoritative truth and never a `RoomSpec` field.
- **Pure deterministic reducer only.** Transitions are a total function of a prior
  `RoomEnvironmentState` plus non-negative `elapsedWorldHours`. Monotonic and
  saturating; recomputation is stable.
- **Pure elapsed-time helper only.** Elapsed world hours are derived from the
  existing `moved-to-room` event log, exactly like `world-clock-v0` counts moves.
  It reads the log and returns data; it never appends.
- **Dry at runtime.** No runtime/composition code constructs or applies a
  `RoomEnvironmentState`. A dedicated dry-at-runtime test proves no transition can
  occur in live gameplay yet.
- **No visible room changes, no UI changes.**
- **No `RoomSpec` mutation.**
- **No schema / save / persistence changes.**
- **No `WorldEvent` / `WorldCommand` / `applyEvent` changes.**
- **No timers, `Date.now`, `setInterval`, or background simulation.**
- **No LLM / provider involvement.**
- **No raw room / object / prompt / dialogue text parsing or logging.** State is a
  closed enum; nothing infers it from generated text or object names/types.
- **No corpse / blood / body cleanup.**
- **No NPC routines / patrol / chase / awareness.**
- **No `schemaVersion` bump** anywhere. Build stays green.

---

## 1. Title and status

- **Feature:** `lazy-room-environment-transitions-v0`
- **Lane:** worked on `main` directly; no feature branch.
- **Status:** PROPOSED / model-only / dry-at-runtime.
- **ADR:** [ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md)
  (next free number; ADR-0077 is `relationship-valence-reducer-v0`).

## 2. Problem statement

We want rooms to feel like in-fiction time passes: a fire left burning should later
read as smoldering, then burned-out, with ambient after-effects (stale smoke, cold
ashes) — computed **lazily** on room enter/read from the deterministic world clock,
never via timers or background simulation.

The blocker is architectural, not stylistic: the engine has **no authoritative
structured room environment state** for fire/smoke. The only room-scoped
authoritative state is `WorldState.roomStates[roomId] = { visited, flags? }`, whose
`flags` are booleans only — no environment kind, no intensity, no "established-at"
anchor. `corpse` is a visual `RoomObject` type, not a state; `torch`/`candle`/
`flicker` are lighting presentation. There is no fire/smoke/ash concept anywhere in
domain, world, or persistence.

Every route to a **visible** v0 therefore crosses a hard boundary: inventing state
from raw generated text or object names (forbidden text inference), mutating the
generated `RoomSpec` (forbidden), adding a schema/save field (out of scope), or
minting a new `WorldEvent`/`WorldCommand` (out of scope). So this slice lands the
**pure, deterministic transition foundation now, dry**, and defers the authoritative
environment-state *source* to a later, separately-approved feature. This is the same
safe order the dialogue chain used: land the closed, reviewed model before any
emission source exists (`valenced-dialogue-effect-candidates-v0` →
`relationship-valence-reducer-v0`).

## 3. Why visible fire/smoke transitions are deferred

- **No authoritative source of environment state exists.** With nothing that legally
  establishes `burning` for a room, the reducer has no input, so no transition can be
  shown.
- **The only in-fiction "fire/smoke" today lives in raw generated text and object
  types** (e.g. a `corpse` prop, a `torch`). Reading those to seed state is
  explicitly forbidden ("no raw text inference", "no object-name inference").
- **A visible transition needs an origin anchor the log cannot supply.** Elapsed time
  is derivable as *hours-since-the-player-last-entered a room* (see §7), but that is
  not *hours-since-ignition*. A true "fire started at hour T" anchor would require a
  persisted fact — the schema/event surface this feature must not touch.
- **Corpse/blood cleanup is out of scope by construction**: `corpse` has no structured
  body state and no reducer/storage; "cleaning it up" would mean mutating the
  generated `RoomSpec` or inventing state. Deferred entirely (see §12).

Landing the model dry keeps the contract reviewed and ready while leaving the
schema/source decision to its own feature.

## 4. Current architecture findings

- **Authoritative room state is boolean-only.** `WorldState.roomStates[roomId] =
  { visited: boolean, flags?: Record<string, boolean> }`
  (`apps/web/src/domain/world/worldState.ts`), mutated only by appending a validated
  `room-state-changed` event (`apps/web/src/domain/world/applyEvent.ts`). No numeric
  intensity, no environment kind, no timestamp/sequence anchor.
- **No environment concept exists** in `domain/`, `world/`, or `persistence/`. `corpse`
  is a visual `RoomObject['type']` in `apps/web/src/domain/roomSpec.ts`; `torch` /
  `candle` / `flicker` are lighting presentation only. Grep for
  `smoke|burning|smolder|ember|ash|environment` finds only unrelated matches
  (`firewall`, `stableHash`, generic prose).
- **The world clock is a pure, deterministic projection.**
  `computeWorldClock(log)` (`apps/web/src/domain/world/worldClock.ts`) counts
  `moved-to-room` events: `absoluteHours = (START_DAY-1)*24 + START_HOUR +
  moves*HOURS_PER_MOVE`. It holds no `WorldState` field, mints no event/command, uses
  no wall clock, and needs no schema/save change. This is the exact technique the new
  elapsed-time helper reuses.
- **The room-enter seam is composition-owned and read-only.** `App` drives
  `refreshDerivedViews` → `computeDerivedViews` and `applyWorldClockFromSession` at
  bootstrap / load / navigation (`apps/web/src/App.tsx`); room presentation is derived
  read-only via `buildRoomSummary` (`apps/web/src/domain/roomSummary.ts`) and
  `StatusHud`. This slice adds nothing here.
- **The repo already ships "dry model, wire later" features.**
  `valenced-dialogue-effect-candidates-v0` (ADR-0075) and
  `relationship-valence-reducer-v0` (ADR-0077) ship closed reducers/tables proven dry
  by a non-emission test; `generated-mechanical-gate-contract-v0` (ADR-0061) ships a
  pure contract with no runtime enforcement. This feature follows that pattern.
- **ADR-0076 explicitly deferred** "lazy room/object transitions" as future work
  needing its own ADR. This is that follow-up, hence ADR-0078.

## 5. Proposed v0 scope

A single **pure domain module** (proposed `apps/web/src/domain/world/roomEnvironment.ts`)
plus its test file, containing:

- The closed `RoomEnvironmentState` fire/smoke enum.
- The closed `EnvironmentPresentationTag` enum.
- A pure reducer `projectRoomEnvironment(prior, elapsedWorldHours)` driven by a frozen,
  closed threshold table.
- A pure `presentationTagsFor(state)` mapping.
- A pure `elapsedWorldHoursSinceLastEntered(log, roomId)` helper derived from the
  existing event log.
- Unit tests plus a **dry-at-runtime test** proving no runtime/composition path
  constructs or applies a `RoomEnvironmentState`.

Nothing is wired to produce environment state; the reducer is inert exactly like the
valence reducer.

## 6. Environment state model

Closed, data-only, renderer-agnostic; lives in `domain/` and imports no
React/Three.js/logger/DB (a fresh session/room has **no** environment state, i.e.
`undefined`, which is the only runtime case in v0):

```ts
export type RoomEnvironmentKind = 'burning' | 'smoldering' | 'burned_out'

export type RoomEnvironmentState = { kind: RoomEnvironmentKind }

export type EnvironmentPresentationTag = 'stale_smoke' | 'cold_ashes'
```

- **No numeric intensity field.** A continuous "smoke level" would invite an
  origin-anchor the repo cannot authoritatively supply; "smoke fading" is expressed as
  the `stale_smoke` presentation tag on later stages, not a decaying number.
- **Absent environment = `undefined` = strict no-op.** This is the only state reachable
  at runtime in v0.

## 7. Authority model

- The model is a **pure projection helper, not authoritative state**. It holds no
  `WorldState` field, mints no event/command, and is never persisted — identical in
  posture to `world-clock-v0`.
- **State is a total function of the closed enum + elapsed hours**, never derived from
  text, object names/types, heuristics, or a model. There is no field through which an
  LLM-proposed value can reach a transition.
- **Presentation tags are display-only** data, never world truth, never a `RoomSpec`
  field, never logged as content.
- The elapsed-time helper **reads** the already-persisted log and returns a number; it
  never appends.
- Because there is no authoritative *source* of `RoomEnvironmentState` in v0, the
  reducer is **dry**: correctness is guaranteed by construction plus a
  no-construction/no-application test, mirroring the relationship-valence reducer.

## 8. Transition rules (closed table, v0)

Given a non-null prior state and `elapsedWorldHours >= 0` (thresholds are constants in
`HOURS_PER_MOVE` units, recorded in the ADR; values below are the proposed defaults):

| prior | condition | next |
| --- | --- | --- |
| `burning` | `elapsed < SMOLDER_AFTER_HOURS` | `burning` |
| `burning` | `elapsed >= SMOLDER_AFTER_HOURS` | `smoldering` |
| `smoldering` | `elapsed < BURNED_OUT_AFTER_HOURS` | `smoldering` |
| `smoldering` | `elapsed >= BURNED_OUT_AFTER_HOURS` | `burned_out` |
| `burned_out` | any | `burned_out` (terminal, idempotent) |

- **Monotonic and saturating.** Transitions only advance; `burned_out` is terminal;
  recomputing with equal-or-greater elapsed time is stable (determinism requirement).
- **Half-open thresholds**, mirroring the `timeOfDayForHour` bucket convention, so each
  elapsed value maps to exactly one stage boundary.
- **Presentation mapping** (`presentationTagsFor`): `burning → []`,
  `smoldering → ['stale_smoke']`, `burned_out → ['cold_ashes']`. (An optional later
  refinement — `burned_out` briefly carrying both tags before settling to
  `['cold_ashes']` — is deferred to the presentation feature; v0 keeps the mapping
  flat and total.)

## 9. Elapsed time helper design

`elapsedWorldHoursSinceLastEntered(log, roomId): number`, pure and deterministic:

- Reuse the `world-clock-v0` accounting: absolute world-hours at any log prefix =
  `START_HOUR + (moveCountUpToThatPoint) * HOURS_PER_MOVE` (day rollover handled as in
  `computeWorldClock`).
- Find the index of the **most recent** `moved-to-room` event whose
  `payload.toRoomId === roomId`; compute absolute hours at that point and at the end of
  the log; return the non-negative difference.
- If the room was never entered (no matching `moved-to-room`), return `0`.
- Non-`moved-to-room` events do not affect the result, matching the clock's
  advancement rule (which this feature must not change).

This yields *hours-since-last-entered*. It is **sufficient for the model's mechanics
and tests** but is deliberately **not** wired as a transition trigger in v0, because it
is not *hours-since-ignition* — the missing origin anchor is exactly what defers a
visible transition (see §3).

## 10. Runtime integration: none in V0 except the dry test

- **No wiring that can activate.** No call site constructs a `RoomEnvironmentState`, so
  `projectRoomEnvironment` never runs in live gameplay and no room/UI changes.
- **Lazy-only is satisfied structurally**: the model is a pure function callable on
  enter/read by a *future* consumer, never on a timer or loop.
- The only "integration" is the **dry-at-runtime test** (see §11) asserting that no
  runtime/composition module imports or applies the model yet. This mirrors how
  `relationship-valence-reducer-v0` shipped its reducer with no emission source.

## 11. Logging / debug safety

- The pure module **does no logging**; it returns results as data, like `worldClock` /
  `validateRoom`.
- No new log surface is added anywhere. If a diagnostic is ever added in a later slice,
  it must be **enum/count/boolean only** (e.g. the resulting `kind`), never room/object
  names, generated text, prompts, provider bodies, or presentation strings.
- No raw room/object/prompt/dialogue text is parsed or logged by this feature.

## 12. Test plan (targeted, deterministic)

**`domain/world/roomEnvironment.test.ts` (reducer + tags):**

- Determinism: same `(prior, elapsed)` → same output.
- Monotonicity: output stage never regresses as `elapsed` increases.
- Saturation/idempotence: `burned_out` stays `burned_out` for any elapsed.
- Threshold boundaries (half-open): exact `SMOLDER_AFTER_HOURS` /
  `BURNED_OUT_AFTER_HOURS` land on the later stage; one unit below stays on the earlier
  stage.
- Presentation mapping: `presentationTagsFor` returns the exact closed tags per stage.

**`domain/world/roomEnvironment.elapsed.test.ts` (elapsed helper):**

- Derives correct hours from a synthetic log (agrees with `computeWorldClock`
  accounting).
- Returns `0` when the room was never entered.
- Unaffected by non-`moved-to-room` events.
- Uses the most recent matching `moved-to-room` when the room was entered more than
  once.

**Dry-at-runtime test (the load-bearing proof):**

- Assert no runtime/composition path constructs or applies a `RoomEnvironmentState`
  (e.g. the model export is imported only by its own tests), mirroring the
  relationship-valence non-emission proof — the guarantee that transitions stay dry in
  production until a source feature exists.

Targeted run:

```bash
npm.cmd run test -- roomEnvironment
npm.cmd run lint
npm.cmd run build
```

## 13. Implementation slices

Only the model slice is in scope now; the rest are named as separate future features
(see §14).

1. **Pure model + reducer + elapsed helper + tests (dry).** Self-contained; no wiring;
   no visible change. **This is the whole approved v0.**
2. **Docs closeout** — flip this plan and ADR-0078 to Implemented and add the
   ARCHITECTURE.md status line, at implementation time only (implemented-only
   convention).

## 14. Deferred future features (each its own maintainer-approved feature/ADR)

1. **`room-environment-state-source-v0`** — decide how a `RoomEnvironmentState` is ever
   authoritatively established (candidate: an interaction effect appending a
   `room-state-changed`-style fact carrying an environment kind and an established-at
   anchor). **This is where the schema/event/save decision actually lives** and must be
   approved on its own.
2. **`room-environment-transition-runtime-v0`** — wire the lazy read at the room-enter
   seam so transitions compute on enter/read once a source exists.
3. **`room-environment-presentation-v0`** — surface presentation tags UI-only (a derived
   line/tag on the existing room summary or a `role="status"` overlay like
   ADR-0071); **not** renderer lighting.
4. **`corpse-blood-cleanup-v0`** — only *after* structured body/gore state exists; never
   by mutating the generated `RoomSpec` or inferring from object names/types.

## 15. Risks

- **"Foundation with no runtime effect feels like dead code."** Mitigated: this is the
  repo's deliberate, repeatedly-used pattern (ADR-0075 / 0077 / 0061); the
  dry-at-runtime test locks the boundary and makes the later source slice cheap and
  safe.
- **Threshold bikeshedding.** Contained: thresholds are constants in one file, covered
  by boundary tests; the ADR records them.
- **Scope creep toward corpse/blood or renderer feedback.** Explicitly out of scope;
  would require `RoomSpec` mutation or new state / trusted-renderer changes.
- **Accidental authority or presentation leak.** Prevented structurally: no
  event/command/state field; presentation tags are a separate display-only enum with no
  write path.
- **Dry-now, live-later.** When a source feature lands, transitions must go live only
  through that reviewed slice; this feature's dry-at-runtime test guards the "still dry
  today" claim in the meantime.

## 16. Final recommendation

**Implement Slice 1 only:** a pure, closed, deterministic room-environment transition
model (`burning | smoldering | burned_out`), closed presentation tags
(`stale_smoke | cold_ashes`), a pure event-log-derived elapsed-world-hours helper, and
a dry-at-runtime test — with **no wiring, no visible effect, and no schema / save /
event / command / `RoomSpec` change**. Defer the authoritative environment-state
*source* (and its schema/event decision), the runtime transition wiring, all
presentation/renderer feedback, and any corpse/blood cleanup to the separate,
individually-approved features named in §14. Record the model, the authority/presentation
split, and the deferrals in [ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md).

### Minimum Safe Change Check

- **Reused:** the `world-clock-v0` move-counting accounting (`computeWorldClock`
  constants/technique), the existing `WorldEvent` log read path, and the domain
  test/fixture conventions.
- **Minimum new code:** one pure domain module (closed enums + frozen threshold table +
  reducer + tag mapping + elapsed helper) and its test files. No new runtime wiring,
  UI, or abstraction.
- **Safety boundaries unchanged:** no `RoomSpec` mutation; no schema / save /
  persistence / migration / `schemaVersion` bump; no `WorldEvent` / `WorldCommand` /
  `applyEvent` change; no timers / `Date.now` / `setInterval` / background loop; no
  LLM/provider; no raw text or object-name inference or logging; no corpse/blood
  handling; no NPC routines. `world-clock-v0` advancement rules untouched.
- **Tests prove it:** §12, anchored by the dry-at-runtime non-construction proof.

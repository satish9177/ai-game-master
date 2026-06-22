# ADR-0011: Semantic Room Validator v0 — deterministic playability check

- **Status:** Accepted — **implemented** (Semantic Room Validator v0)
- **Date:** 2026-06-22
- **Deciders:** Project owner

## Context

[Generation Foundation v0](./ADR-0010-generation-foundation-v0.md) proved the
generation **seam** end-to-end with a deterministic fake generator: a prompt
becomes raw, untrusted JSON text that `GeneratedRoomSource` runs through
`JSON.parse` and the **same** `loadRoomSpec` boundary every source uses. That
boundary answers one question — *is this well-formed?* (correct shape and types,
zod). It deliberately does **not** answer the next one — *is this room actually
playable?*

The docs already name that gap. The full pipeline
([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)) places a
**deterministic code validator** (explicitly *not* an LLM) after schema
validation, and [FAILURE-MODES](../FAILURE-MODES.md) case 4b records "valid JSON
does not mean a room is playable or good" as ❌ not built. ADR-0010 deferred this
out of v0: with only a fake generator, nothing could yet produce a
*valid-but-unplayable* room worth rejecting.

We now close the first slice of that gap. This is **stage 2** of the ADR-0007
pipeline — the deterministic code validator — built small. It emits no repair, no
regeneration, and no reviewer; those stay future.

## Decision

Ship **Semantic Room Validator v0**: a pure, deterministic `validateRoom`
function in the domain, run by `GeneratedRoomSource` immediately after
`loadRoomSpec` succeeds and before a room is returned.

```
generator.generate(prompt) → raw untrusted JSON text
  → JSON.parse                                 (untrusted → value)
  → loadRoomSpec(parsed)        ✅ schema boundary   — well-formed?   (unchanged)
  → validateRoom(room)          ✅ semantic boundary — playable?      (NEW)
       └─ RoomValidationResult { ok, issues[] }
  → fatal issue  → RoomLoadResult invalid-room (existing code + message)
  → ok / warnings → RoomLoadResult ok          (warnings logged as counts/codes)
  → existing trusted Three.js renderer          (untouched)
```

### What v0 is

- **A pure domain function** `validateRoom(room: LoadedRoom):
  RoomValidationResult`. It lives in `domain/validateRoom.ts` as a peer of
  `loadRoomSpec` — the same contract layer the future backend HTTP edge will
  reuse. It imports no React, Three.js, renderer, platform logger, backend, or DB;
  it does no I/O and **never logs**. It returns problems as **data**, exactly like
  the loader ([ADR-0003](./ADR-0003-logging-abstraction.md)).
- **A severity model.** Each issue carries a stable enum `code` and a `severity`
  (`fatal` | `warning`); `ok` is derived (`false` iff any issue is `fatal`). The
  split maps to FAILURE-MODES 4b: **room-level** problems that make a room
  unplayable are `fatal` (block render); **object-level** problems are `warning`
  (the room still renders, surfaced as data).
- **The v0 rules**, over anchor positions, schema-declared sizes, counts, and
  `shell.dimensions` only:
  - *fatal* — room below the minimum walkable size or above the pathological
    maximum; spawn outside the walkable AABB (the same margin the engine clamps
    to); object or light count over the **hard** budget.
  - *warning* — unusual corridor aspect ratio; spawn at an unusual height; an
    object anchor outside the footprint (with an edge epsilon) or above the
    ceiling; a solid object crowding the spawn; no declared exit; object or light
    count over the **soft** budget; an NPC/scroll with an empty interaction
    prompt, a missing dialogue body, or an unnamed NPC.
- **Tunable thresholds** live in a documented `LIMITS` constant co-located in
  `validateRoom.ts` (not env/config — there is no config layer yet).
- **Wiring in `GeneratedRoomSource`.** One new step between schema success and
  `ok:true`: a **fatal** result folds into the existing `invalid-room`
  `RoomLoadResult` (reusing the existing safe copy "This room could not be
  loaded.") so an unplayable room never reaches the renderer; a **warnings-only**
  result returns the unchanged room. No new error code, no port change, no schema
  change.
- **Logging is counts/codes only.** On fatal, one `log.warn` line:
  `code: 'invalid-room'`, fatal/warning counts, and the distinct fatal issue
  **codes** (a fixed enum → always safe). On success, the existing info line gains
  `semanticWarningCount`. Issue **messages** (templated from type/index/coords),
  full prompt text, and raw generated JSON are **never** logged. The "exactly one
  log line per `getRoom()` call" invariant is preserved.
- **Tested with Vitest:** one fixture per rule (fatal and warning), false-positive
  guards (wall-edge anchors within epsilon, a rug at spawn, spawn on the walkable
  boundary), determinism + no input mutation, stable issue ordering; plus
  `GeneratedRoomSource` integration tests (semantic-fatal → `invalid-room` logged
  once at warn, warnings-only → `ok:true` with `semanticWarningCount`, prompt text
  never logged) and a regression guard that every `FakeRoomGenerator` output has
  **zero fatal** semantic issues.

### What v0 is **not** (deliberately deferred)

- **No repair / regenerate loop, corrective re-prompt, or attempt budget** — the
  ADR-0007 retry policy stays future.
- **No LLM reviewer / creative-quality judgment** — incl. "too empty / boring",
  which is reviewer territory, not the code validator.
- **No real reachability / pathfinding** — v0 checks that an exit is *declared*,
  not that it is reachable from spawn through walkable space.
- **No object↔object collision / solid-volume overlap, no "NPC inside a wall"
  volume test** — that needs the renderer's builder geometry, which the domain
  must not import ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)). v0
  uses anchor positions + schema-declared sizes only.
- **No quest-item consistency** (no quest system exists) and **no multi-room /
  adjacent-room checks** ([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md)).
- **No UI surfacing of warnings** (a dev overlay stays future); v0 logs counts and
  codes only.
- **No real LLM, backend, DB, memory, config/env-tunable thresholds, or async/IO**
  — `validateRoom` is a pure synchronous function.

### Invariants this preserves

- **The trust boundary is unchanged.** Semantic validation runs over an
  already-loaded room and only *narrows* what reaches the renderer; it never lets
  raw or unvalidated data through. The renderer still executes only trusted,
  hand-written builders ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **Boundaries hold.** The validator obeys the same domain import rules as
  `loadRoomSpec` (pure, returns data, never logs); orchestration and logging stay
  in the composition layer ([BOUNDARIES](../BOUNDARIES.md),
  [ADR-0003](./ADR-0003-logging-abstraction.md)).
- **Prompt safety holds.** The caller logs codes/counts, never issue messages,
  prompt text, or raw JSON ([FAILURE-MODES](../FAILURE-MODES.md) case 4).

## Consequences

- A schema-valid-but-unplayable generated room (an unwalkable size, a spawn
  outside the walls, a pathological object/light count) now fails with the
  existing `invalid-room` outcome instead of reaching the renderer. Playable rooms
  with only warnings are unaffected — they still render.
- The deterministic fake stays green: its output is playable, so every
  `FakeRoomGenerator` room passes with zero fatal issues (the regression guard
  proves it). The user-visible happy path is unchanged.
- The semantic boundary is now a **shared, tested contract** in the domain. When
  the backend lands ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md)),
  its HTTP edge reuses `validateRoom` with no move — "validate at every trust
  boundary" ([FAILURE-MODES](../FAILURE-MODES.md)).
- This closes only the first slice of FAILURE-MODES 4b. Deeper reachability,
  collision, quest consistency, the LLM reviewer, and the bounded repair loop
  remain future
  ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md)).

## Alternatives considered

- **Put the validator in `generation/`** — rejected: it would tie a reusable,
  renderer-agnostic invariant to the browser generation layer, which can't import
  the logger anyway; the domain is the shared contract layer the future backend
  reuses ([ADR-0005](./ADR-0005-defer-shared-package-extraction.md)).
- **Add a new `RoomLoadResult` error code for semantic failure** — rejected: a
  semantically-bad room is, to the host and the user, the same "could not load"
  outcome as a bad envelope. Reusing `invalid-room` keeps the port and the
  user-facing copy unchanged.
- **Mutate/repair the room, or surface warnings to the UI now** — rejected as
  out of scope: repair belongs with a real model that can produce bad-but-valid
  rooms, and a warning overlay is future
  ([ADR-0007](./ADR-0007-generated-room-validation-and-repair.md),
  [FAILURE-MODES](../FAILURE-MODES.md) cases 2/4b).
- **Do real collision / reachability now** — rejected: precise object-vs-object
  geometry needs the renderer's builders, which the domain must not import
  ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)). v0 checks anchors,
  declared sizes, and the same walkable-AABB math the engine already uses.
- **Log this as `error` like a malformed envelope** — rejected: a
  semantically-bad room is an *expected, repairable* outcome in the full pipeline,
  distinct from malformed JSON; it logs at `warn`.
```

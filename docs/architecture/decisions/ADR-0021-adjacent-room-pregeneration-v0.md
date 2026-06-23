# ADR-0021: Adjacent-Room Pre-generation v0 — a browser-only room-acquisition seam

- **Status:** Accepted — **implemented** (Adjacent-Room Pre-generation v0)
- **Date:** 2026-06-23
- **Deciders:** Project owner

## Context

[Multi-Room Navigation & Cache v0](./ADR-0016-multi-room-navigation-cache-v0.md)
made the game multi-room: an interactable door appends `moved-to-room`, rooms are
resolved through a `RoomRegistry` and held in a per-session `SessionRoomCache`,
and `App` keeps one session + cache alive across transitions. But room
acquisition was **synchronous at the door** — `NavigationService.resolveRoom`
hit the cache or the registry only at the moment the player triggered an exit,
and a target that was neither cached nor authored ended at "the way is blocked".

[ADR-0009](./ADR-0009-adjacent-room-pre-generation.md) sketched the *future*
shape of hiding generation latency: while the player explores, pre-generate the
**nearby frontier** in parallel (capped jobs), and at a door behave by the
room's readiness. That ADR assumed a real LLM, a backend, a per-room status
lifecycle, and a parallel-job system — none of which exist or are wanted yet.

This slice ships the **deterministic, browser-only subset** of ADR-0009 that the
current code can support honestly: warm the rooms behind the current room's exits
in the background, and resolve rooms safely **on demand** at the door — including
generating a non-authored target instead of blocking. No backend, no real LLM,
no parallel-job framework, no per-room status machine.

## Decision

Ship **Adjacent-Room Pre-generation v0**: a single composition-layer
`AdjacentRoomPregenerator` that is the session's one **room-acquisition seam**,
used by *both* background warming and on-demand door resolution over one shared
cache and one shared in-flight map. `NavigationService` no longer owns the
cache/registry; it depends on the narrow `RoomResolver` interface the
pregenerator implements (DIP). Every generated adjacent room passes through the
same `GeneratedRoomSource → assembleRoom → repairRoom → fallbackRoom` pipeline as
the prompt path, so only valid, zero-fatal rooms ever enter the cache.

```
 App (composition root)
   ├─ on bootstrap: resolveRoom(STARTING_ROOM_ID) → warmAdjacent(startRoom)
   └─ after each navigate: warmAdjacent(enteredRoom)        depth = 1 (never recursive)
        │
        ▼
 AdjacentRoomPregenerator  (one cache + one in-flight map; the RoomResolver)
   resolveRoom(id):  cache → in-flight join → runResolve(id)        ALWAYS safe, never throws
        runResolve(id):
          registry.has(id) ? resolveAuthored(id)                    authored → RoomRegistry.resolve
                           : resolveGenerated(id)                    non-authored → generate
   resolveAuthored(id):  registry.resolve → cache.set               (authored rooms are NEVER fake-generated)
   resolveGenerated(id): createSource(id).getRoom()                 GeneratedRoomSource(generator, `adjacent:${id}`, …)
          → assembleRoom (parse→schema→semantic→repair→fallback)    ✅ zero-fatal room or `unavailable`
          → normalize(id): withRoomId + defensive re-validate       cache key === room.id
          → cache.set
   warmAdjacent(room):  exits in declaration order, capped at maxJobs=3,
                        skip cached / in-flight, fire-and-forget (void resolveRoom)
        │
        ▼
 NavigationService.navigate({ sessionId, toRoomId })  — depends only on RoomResolver
        resolveRoom(toRoomId) (resolve-before-append) → WorldSession.move → moved-to-room
```

### What v0 is

- **One shared room-acquisition seam** `app/AdjacentRoomPregenerator.ts`
  (composition layer). Both the background warmer and the door resolver call the
  same `resolveRoom`, over **one** `SessionRoomCache` and **one** in-flight
  `Map<string, Promise<…>>`, so a door request and a background warm for the same
  id collapse into a single job (no duplicate generation). It is constructed once
  in `App` and lives for the play session.
- **`resolveRoom(roomId)` — total, cache-first, in-flight-aware.** A cache hit
  returns immediately (`source: 'cache'`, `cacheHit: true`); otherwise an
  existing in-flight promise is **joined**; otherwise a new job runs and is
  recorded in the in-flight map until it settles (`try/finally` always clears the
  entry). It **never throws**: a genuinely unexpected fault (a throwing
  registry/factory) maps to a typed `{ ok: false, reason: 'unavailable' }` and
  caches nothing.
- **Authored rooms warm through the registry; they are never fake-generated.**
  `registry.has(id)` (a pure map check, [ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md)'s
  `RoomRegistry` gained `has()`) decides the branch. An authored id resolves
  through `RoomRegistry.resolve → loadRoomSpec` (`source: 'registry'`); a
  non-authored/unknown id is generated. This honors the rule that authored rooms
  keep their authored content.
- **Non-authored rooms generate through the safe assembly pipeline.**
  `resolveGenerated` calls the injected `RoomSourceFactory`, which `App` wires as
  `(roomId) => new GeneratedRoomSource(generator, \`adjacent:${roomId}\`, logger,
  fallbackRoom)`. The seed is the **structural room id only** — never a user
  prompt. `assembleRoom` guarantees a zero-fatal room (generated/repaired/
  fallback); only a generator **throw/reject** is `unavailable` (the retry path,
  nothing cached). Bad *content* never becomes `unavailable`.
- **Id normalization keeps the cache key and `room.id` in agreement.** A
  generated/fallback room may carry its own `id`, so `normalize` relabels it to
  the navigation id via the pure `withRoomId(room, id)` (a fresh spread — the
  shared fallback room is never mutated). `id` is **not** a semantic input to
  `validateRoom` (which reads dimensions/spawn/objects only), so relabeling is
  provably semantics-preserving; a **defensive re-validate** guards the
  unreachable case, falling back to `withRoomId(fallbackRoom, id)` if it ever
  failed. Tests prove relabel-preserves-validity and no input mutation.
- **`warmAdjacent(room)` — bounded, fire-and-forget frontier warming.** It reads
  the current room's exits via the existing `buildExitLookup`, dedupes by
  `toRoomId` in **declaration order**, skips already-cached and in-flight ids, and
  starts at most **`maxJobs` (default 3)** background `resolveRoom` calls
  (`void`-ed; it never blocks the caller and never throws). The cap bounds only
  speculative work — an explicit `resolveRoom` at a door is never throttled by it.
- **Depth = 1; no recursive pre-generation.** `warmAdjacent` is called **only**
  from the composition root — once after bootstrap resolves the starting room, and
  once after each successful navigation — never from inside `resolveRoom`. Warming
  a room does **not** warm *its* neighbours, so pre-generation can't fan out
  through the world. (The deterministic `FakeRoomGenerator` also emits dead-end
  rooms, so a generated room exposes no further frontier in any case.)
- **`NavigationService` depends only on `RoomResolver` (DIP).** Room acquisition
  moved out of the service: it no longer imports `SessionRoomCache`/`RoomRegistry`
  or owns a `resolveRoom`; it takes a `RoomResolver` and calls `resolveRoom`
  before appending (resolve-before-append preserved). A non-authored target now
  **navigates via on-demand generation** instead of returning "the way is
  blocked"; only a genuine `invalid-room`/`unavailable` is a typed failure.
- **Safe logging only.** The pregenerator logs ids/codes/counts/booleans/
  provenance: `room resolved` (`roomId`, `source`, `cacheHit`, optional
  `provenance`), `room resolve failed` (`roomId`, `source`, `code`), `adjacent
  warm requested` (`adjacentCount`, `started`), and `normalized room failed
  revalidation` (`roomId`). It **never** logs the seed/prompt text, raw generated
  JSON, story text, or object names; `GeneratedRoomSource` still logs only
  `promptLength` (here, the length of `adjacent:${id}`).
- **Wired only in the example/multi-room play path.** `App` constructs the
  pregenerator once, passes it to `NavigationService`, bootstraps via
  `pregenerator.resolveRoom(STARTING_ROOM_ID)`, and warms after bootstrap and
  after each navigated transition. The **PromptBar** generated single-room path is
  unchanged — a fresh session + fresh cache, no navigation, no warming.
- **Tested with Vitest** (no DOM/e2e). `withRoomId` (relabel preserves validity,
  no input/shared-fallback mutation); `resolveRoom` (cache hit skips factory +
  registry; authored → registry + cache, no factory; non-authored → generate +
  id-normalize + input unmutated; in-flight join = one job; `unavailable` not
  cached + retry; throwing source → `unavailable`, no reject; no recursion into a
  generated room's exits; real-generator determinism with `room.id === toRoomId`;
  log-safety — no object name / seed text); `warmAdjacent` (cap at 3 in
  declaration order; skip cached + dedup; skip in-flight; never fake-generate an
  authored id); plus `RoomRegistry.has` and the `NavigationService` resolver-result
  mapping (authored + generated navigate; cacheHit propagation; invalid-room /
  unavailable / already-here / not-found / conflict; log-safety).

### What v0 is **not** (deliberately deferred)

- **No backend generation endpoint and no real LLM.** Generation stays the
  browser-side deterministic fake through `assembleRoom`; the Node API
  ([ADR-0019](./ADR-0019-backend-world-session-api-v0.md)) is untouched and the
  browser still uses in-memory adapters.
- **No parallel-job system / async queue / WebSocket / worker pool.** "Parallel"
  here is just a handful of `void`-ed promises bounded by `maxJobs`; there is no
  scheduler, priority queue, cancellation, or job framework.
- **No per-room status lifecycle UI** (`not_started → generating → … → ready`,
  "Opening the way…"): with a synchronous deterministic generator a warmed room is
  either already cached (instant) or resolved on demand in the same tick, so there
  is no visible in-between state to show. The ADR-0009 status model stays future
  with the real, slow LLM.
- **No recursive / multi-hop pre-generation** (depth stays 1), **no priority
  ordering** beyond exit declaration order, and **no "where is the player
  heading" heuristic** — the frontier is simply the current room's exits, capped.
- **No world-bible, memory, or DB persistence of warmed rooms** — the cache is
  the existing in-memory `SessionRoomCache`; nothing is written to SQLite.
- **No renderer/engine/domain/schema/server/persistence change.** `RoomViewer`
  and the engine stay presentation/intent-only; no new `RoomSource` error code, no
  new event type, no new lint block.

### Invariants this preserves

- **The trust boundary is unchanged.** Every generated adjacent room passes
  through `assembleRoom` (parse → `loadRoomSpec` → `validateRoom` → `repairRoom` →
  re-validate → fallback) **before** it can enter the cache, so only valid,
  zero-fatal rooms are cached and the renderer still consumes only a validated
  `LoadedRoom` built by trusted hand-written builders
  ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md)).
- **Boundaries hold with no new lint rule.** `AdjacentRoomPregenerator` is
  composition (`app/`), which may import the registry, cache, generation, domain,
  and the logger — exactly where `NavigationService` already lives
  ([BOUNDARIES](../BOUNDARIES.md)). The engine imports none of it; the renderer
  stays intent-only ([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md)).
- **Resolve-before-append still holds.** `NavigationService` resolves the target
  (now possibly by generating it) before appending `moved-to-room`, so the log
  never claims a move into an unrenderable room.
- **Prompt/seed safety holds.** Logs carry ids/codes/counts/booleans/provenance
  only — never seed/prompt text, raw JSON, story text, or object names
  ([ADR-0003](./ADR-0003-logging-abstraction.md),
  [FAILURE-MODES](../FAILURE-MODES.md) cases 4 / 4b / 7).
- **Cost is bounded.** `maxJobs`, the cache + in-flight dedup, and depth-1
  frontier-only warming keep speculative work small and a backtrack cheap.

## Consequences

- A transition into a **warmed** room is an instant cache hit; a transition into a
  **cold non-authored** room is now **generated safely on demand** rather than
  blocked. Room acquisition is one seam shared by the door and the warmer, so the
  two never double-generate the same id.
- In the current authored two-room loop (`throne-room` ⇄ `ruined-safehouse`, both
  authored), warming resolves both through the registry in the background, so
  every transition is already a cache hit and **the user-visible behavior is
  unchanged** — no notice, no wait, no new UI. The generation branch is exercised
  by unit tests, not by the example world (which has no non-authored exits).
- `NavigationService` is now decoupled from room storage via `RoomResolver`: the
  same service works over the in-memory resolver today and any future
  resolver (a durable room store, a real LLM-backed source) with no caller change.
- When a real, slow LLM lands, this seam is where ADR-0009's deferred pieces
  attach: the per-room status lifecycle, the "Opening the way…" wait, priority
  ordering, and a true parallel-job budget wrap `resolveRoom`/`warmAdjacent`; the
  cache, the resolve-before-append contract, and the renderer do not move.

## Alternatives considered

- **Keep room resolution inside `NavigationService` and add a separate warmer** —
  rejected: two code paths to the cache/registry would risk double-generation and
  drift. One seam with a shared cache + in-flight map is DRY and makes
  door/warm dedup automatic.
- **Skip authored rooms when warming (generate only non-authored)** — rejected by
  the maintainer: authored rooms must keep their authored content, so warming
  resolves them through the registry; only non-authored ids are generated, and an
  authored id is **never** fake-generated.
- **Cache generated rooms under their own `room.id` (no normalization)** —
  rejected: the cache key (the navigation `toRoomId`) and `room.id` could diverge,
  so a later cache hit or a self-nav guard could misfire. `withRoomId` + a
  defensive re-validate keeps them in agreement, provably without changing
  semantics.
- **Build the per-room status lifecycle and "Opening the way…" UI now**
  ([ADR-0009](./ADR-0009-adjacent-room-pre-generation.md)) — rejected as
  premature: with a synchronous deterministic generator there is no observable
  intermediate state; the lifecycle is meaningful only with a slow,
  non-deterministic model and stays future.
- **A real parallel-job queue / worker pool / WebSocket pre-gen** — rejected:
  over-engineering for a browser, in-memory, deterministic v0. A `maxJobs`-bounded
  set of `void`-ed promises captures the benefit at a fraction of the complexity
  (AGENTS.md rule 13).
- **Recursive (multi-hop) pre-generation of the frontier-of-the-frontier** —
  rejected for v0: it risks unbounded fan-out through an effectively infinite
  world. Depth-1, capped, cache-deduped warming is the bounded, predictable
  choice; deeper look-ahead is future.
- **A backend generation endpoint for adjacents** — rejected: out of scope and
  unjustified for a deterministic browser fake. The Node API stays untouched;
  generation moving server-side later reuses the same `assembleRoom` contract.

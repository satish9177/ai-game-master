# ADR-0014: Object Interactions v0 — interactions produce world-state/event-log effects

- **Status:** Accepted — **implemented** (Object Interactions v0)
- **Date:** 2026-06-22
- **Deciders:** Project owner

## Context

Object interactions are presentation-only today. A RoomSpec object may carry an
`interaction: { key: 'E' | 'F', prompt, title?, body? }` ([roomSpec.ts](../../../apps/web/src/domain/roomSpec.ts)).
The engine collects every object that has one into a neutral `Interactable`
([domain/ports/interaction.ts](../../../apps/web/src/domain/ports/interaction.ts)),
`Engine.updateProximity()` surfaces the nearest in-range one to the HUD, and
pressing the matching key fires `onRequestOpenInteraction(target)`, which
`RoomViewer` turns into a static `DialoguePanel` showing `title`/`body`. Nothing
changes game state — pressing E to "read the scroll" only shows demo text.

Meanwhile, **World State & Event Log v0** ([ADR-0013](./ADR-0013-world-state-event-log-v0.md))
shipped the authoritative gameplay-truth layer, **but headless**: an append-only
`WorldEvent[]` is the truth, `WorldState` is a pure projection cache, and the
**only write path is "append a typed, validated event, then project"** through
`WorldSession.appendEvent`. It is not wired to the renderer.

This slice connects the two: an E/F interaction should produce **real
world-state/event-log effects** (read a note → record it; open a crate → add an
item; use a medkit → remove it and change health), with **typed results, never
thrown exceptions**, while preserving every existing boundary — especially that
the **renderer only emits intent and never mutates world state**.

## Maintainer-approved decisions (binding for this slice)

This brief was approved with these explicit choices:

1. **Integration depth (Q1):** include the minimal composition-root wiring as
   commit 3 so E/F appends real world-session events in-app. The renderer **must
   still only emit intent** — it must not import `world-session`/`interactions`
   and must not mutate state.
2. **Event modeling (Q2):** **reuse the existing `room-state-changed` event**
   (its `flags`) for inspect recording and one-shot idempotency. **Do NOT add a
   new event type.** ADR-0013's seven-event closed union stays stable. *(If
   implementation appears to need a new event type, STOP and ask the maintainer
   first — per the standing constraint.)*
3. **Compound effect (Q3):** include `use-item` in v0 — remove item **+ optional
   health change**, composed from the existing `item-removed` and
   `health-changed` commands.
4. **Schema breadth (Q4):** add **optional** `interaction` support to `crate`,
   `barrel`, `debris`, and `barricade`. Keep it optional; **do not** add behavior
   defaults that force every asset to be interactable.
5. **Stable-id rule:** one-shot effects (`inspect`, `take-item`) require a
   **stable idempotency key**. If none is available, return typed `missing-id`.
   **Never generate a random id for an interaction ref** — idempotency must be
   stable across reloads/regeneration.

## Decision

Insert a thin, two-part interaction layer **between** the engine's
"interaction-open intent" and the world-session write path, and wire it at the
composition root:

```
 Engine (renderer)                 — emits intent only; no world-session import
   onRequestOpenInteraction(target: Interactable)   target carries a stable id
        │
        ▼  (composition root maps id → { effect, ref } from the LoadedRoom)
 planInteraction(effect, ref, state)   — PURE DOMAIN: decide what should happen
        │     → InteractionPlan: apply(commands[]) | already-resolved | rejected
        ▼
 InteractionService.resolve(...)       — APPLICATION: execute the plan
        │     threads each WorldCommand through WorldSession.appendEvent
        ▼
 WorldSession.appendEvent → applyEvent → WorldStore.commit   (ADR-0013 write path)
        │
        ▼  typed InteractionResult back to the composition root → DialoguePanel
```

The **planner is pure domain** (a peer of `applyEvent`/`validateRoom`): effect +
current `WorldState` → an ordered list of **existing** `WorldCommand`s, or a
typed non-apply outcome. The **service is application** (a peer of
`WorldSession`): it runs the commands through the unchanged ADR-0013 write path
and returns a typed result. The **renderer is untouched in spirit** — it only
gains a passive `id` on the neutral `Interactable` so the composition root can
look up the effect.

### Architectural rules (binding)

1. **The renderer only emits intent.** The engine never imports
   `world-session`/`interactions`, never holds a `WorldSession`, and never
   mutates `WorldState`. Its sole new responsibility is passing through the
   object's `id`.
2. **All state changes go through `WorldSession.appendEvent`** — the ADR-0013
   single write path ("append a typed, validated event, then project"). No new
   write path, no direct snapshot setters.
3. **No new world-session event types.** Effects compose the existing seven
   events only (`item-added`, `item-removed`, `health-changed`,
   `room-state-changed`; `moved-to-room`/`status-changed` available but unused
   here). Reuse `room-state-changed.flags` for inspect + idempotency (Q2).
4. **The planner is pure and total** — no I/O, no `Date.now`/`Math.random`/
   `crypto`, never mutates its inputs, deterministic under fixed input (mirrors
   `applyEvent`/`validateRoom`).
5. **Expected failures are typed results, never thrown** (`missing-id`,
   `missing-effect`, `insufficient-item`, `already-resolved`, `conflict`,
   `not-found`, `partial`). Genuine bugs may still throw.
6. **Effects are data only.** `InteractionEffect` is a zod-validated descriptor
   selected from a fixed `kind` vocabulary — never code, never `eval`'d
   ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)). RoomSpec
   stays renderer-agnostic; no engine objects enter effects or results.
7. **Idempotency keys are stable, never random** (decision 5).
8. **Logs carry ids/counts/codes only** — never item `name`, `body`, `title`,
   `reason`, or any narrative/user content (ADR-0013 rule 10,
   [ADR-0003](./ADR-0003-logging-abstraction.md)).
9. **Ports + constructor injection; no new framework.** The service takes its
   collaborators as constructor params (AGENTS.md rule 13).

## Scope (v0)

**In scope:**

- `domain/interactions/` (pure): the `InteractionEffect` schema, the
  `planInteraction` function, and the `InteractionPlan`/`InteractionOutcome`
  result types.
- A `RoomSpec` change: optional `effect` on the shared `Interaction`; optional
  `interaction` on `crate`/`barrel`/`debris`/`barricade` (Q4).
- `interactions/` (application, headless): `InteractionService` over
  `WorldSession`, with its own lint block, plus full Vitest coverage.
- Minimal composition-root wiring (commit 3): a passive `id` on `Interactable`;
  the engine passes it through; `RoomViewer`/`App` start an in-memory session and
  route opens through the service; `DialoguePanel` shows the typed outcome; the
  example rooms gain `id`s + `effect`s.
- ADR + architecture-doc/boundary/failure-mode/AGENTS updates (commit 4).

**Out of scope / non-goals (must NOT be built in this slice):**

- ❌ New world-session event types (Q2) — **stop and ask** if one seems needed.
- ❌ Real backend, DB/SQLite/Postgres, HTTP/`apps/api`, `packages/contracts`.
- ❌ Real LLM; LLM-authored effects (effects are authored data this slice).
- ❌ NPC dialogue trees/branching; combat/damage systems.
- ❌ Inventory/HUD **redesign** (reuse the existing `DialoguePanel`).
- ❌ GLTF/animation; first-person/free-camera; any camera/player work.
- ❌ Renderer importing `world-session`/`interactions` or mutating state.
- ❌ Multi-room movement, persistence between rooms, save/load wiring.
- ❌ Cooldowns, random loot tables, conditional/quest-gated effects, deeper
  `validateRoom` checks.

## Data model

Exact zod 4 calls are Codex's choice; the constraints below are binding. Reuse
`InventoryItemSchema` from [`domain/world/worldState.ts`](../../../apps/web/src/domain/world/worldState.ts)
and the `WorldCommand` type from [`domain/world/events.ts`](../../../apps/web/src/domain/world/events.ts)
(domain → domain imports are allowed).

### `InteractionEffect` (new — `domain/interactions/effects.ts`)

A discriminated union on `kind`, data only:

| `kind` | Payload | One-shot? |
| --- | --- | --- |
| `inspect` | `{ flag?: string }` — optional explicit room-state flag key | yes |
| `take-item` | `{ item: InventoryItem }` | yes |
| `use-item` | `{ itemId: non-empty string, quantity: int ≥ 1, health?: { delta: int } }` | no (inventory-gated) |

- `InventoryItem` = `{ itemId: non-empty, name: non-empty, quantity: int ≥ 1 }`.
- The schema is exported plus an inferred `InteractionEffect` type.

### RoomSpec changes (`domain/roomSpec.ts`)

- Add `effect: InteractionEffectSchema.optional()` to the shared `Interaction`
  object. `scroll`/`npc`/`zombie` get effects for free; `Interaction` **without**
  `effect` stays valid (presentation-only, today's behavior).
- Add `interaction: Interaction.optional()` to `Crate`, `Barrel`, `Debris`, and
  `Barricade` (Q4 — optional, no default). No other object changes.
- Watch for an import cycle: `effects.ts` imports `InventoryItemSchema` from
  `world/worldState.ts`; `roomSpec.ts` imports `effects.ts`. No cycle today —
  keep it that way.

### `Interactable` view-model (`domain/ports/interaction.ts`) — commit 3

- Add an optional `id?: string` (the object's stable id). It stays a neutral,
  framework-free field. The engine sets it; the composition root reads it to look
  up the effect. **No `effect` field is added to `Interactable`** — the engine
  and UI must not learn about effects.

## Pure planner (`domain/interactions/planInteraction.ts`)

`planInteraction(input: { effect, ref, state }) → InteractionPlan`, where `ref`
is the object's stable `id` (`string | undefined`) and `state` is the current
`WorldState`. Pure, total, deterministic, never mutates inputs.

**Idempotency key (one-shot effects):**
`flagKey = effect.flag ?? (ref ? \`interaction:${ref}\` : undefined)`.
If `flagKey` is `undefined` → `{ status: 'rejected', reason: 'missing-id' }`
(decision 5 — never invent an id). The flag lives under
`state.roomStates[state.currentRoomId].flags[flagKey]`.

**Mapping:**

| Effect | Guard | Emitted `WorldCommand[]` (existing union) | Outcome |
| --- | --- | --- | --- |
| `inspect` | flag set → `already-resolved` | `[ { type:'room-state-changed', roomId, flags:{ [flagKey]: true } } ]` | `{ kind:'inspected' }` |
| `take-item` | flag set → `already-resolved` | `[ { type:'item-added', item }, { type:'room-state-changed', roomId, flags:{ [flagKey]: true } } ]` | `{ kind:'item-taken', item }` |
| `use-item` | held `<` quantity → `rejected: insufficient-item` | `[ { type:'item-removed', itemId, quantity }, …(health ? [{ type:'health-changed', delta: health.delta }] : []) ]` | `{ kind:'item-used', itemId, quantityUsed, healthDelta? }` |

- All commands include `schemaVersion: 1` and validate against
  `WorldCommandSchema`. `roomId` is always `state.currentRoomId`.
- `take-item` emits `item-added` **first**, then the flag (intuitive ordering).
  See Failure modes for the single-writer atomicity rationale.
- `use-item` is **not** flag-gated — it repeats until the inventory runs out; the
  held-quantity check mirrors `WorldSession`'s existing `invalid-command` guard
  (defense in depth, since `appendEvent` re-checks it too).
- The planner returns **no narrative text** — `body`/`title` for the panel come
  from the `Interactable`, keeping display strings out of the domain and the logs.

**Result types (`domain/interactions/` — exported for the service & UI):**

```
InteractionOutcome =
  | { kind: 'inspected' }
  | { kind: 'item-taken'; item: InventoryItem }
  | { kind: 'item-used'; itemId: string; quantityUsed: number; healthDelta?: number }
  | { kind: 'nothing' }                       // already-resolved / no-op

InteractionPlan =
  | { status: 'apply'; commands: WorldCommand[]; outcome: InteractionOutcome }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' } }
  | { status: 'rejected'; reason: 'missing-id' | 'missing-effect' | 'insufficient-item' }
```

`missing-effect` is produced by the **caller/service** when an interaction has no
`effect` at all (the planner is only called with an effect); document it as a
service-level rejection so the dialogue still opens with `body` text.

## Application service (`interactions/InteractionService.ts`)

Headless application layer, constructor-injected with a `WorldSession` and a
`Logger` (DI = constructor params). One method:

`resolve(input: { sessionId, effect?, ref }) → Promise<InteractionResult>`:

1. `effect` absent → `{ status: 'rejected', reason: 'missing-effect' }`.
2. `session.getWorldState(sessionId)` → not ok → `{ status: 'failed', reason: 'not-found' }`.
3. `plan = planInteraction({ effect, ref, state })`.
   - `already-resolved` → `{ status: 'already-resolved', outcome, state }`.
   - `rejected` → `{ status: 'rejected', reason }`.
4. `apply`: thread the revision. Start `revision = state.revision`. For each
   command in order: `res = await session.appendEvent(sessionId, command, revision)`.
   - On failure: if it's the **first** command, map `res.error.code`
     (`conflict`/`not-found`/other → `'conflict'`/`'not-found'`/`'partial'`);
     if a **later** command, return `{ status: 'failed', reason: 'partial' }`.
     Do not retry.
   - On success: `revision = res.state.revision`; keep `res.state` as latest.
5. All commands committed → `{ status: 'applied', outcome, state: latestState }`.

```
InteractionResult =
  | { status: 'applied'; outcome: InteractionOutcome; state: WorldState }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' }; state: WorldState }
  | { status: 'rejected'; reason: 'missing-id' | 'missing-effect' | 'insufficient-item' }
  | { status: 'failed'; reason: 'conflict' | 'not-found' | 'partial' }
```

**Logging:** `sessionId`, `effect.kind`, command count, result `status`/`reason`
**codes** only — never `item.name`, `body`, `title`, or `health.delta` values
beyond what a code conveys (rule 8).

## Composition-root wiring (commit 3)

Keep it small; the renderer stays import-clean.

- **Engine (`renderer/engine/Engine.ts`):** when building each `Interactable` in
  `setRoom`, set `id: o.id` (read `'id' in o ? o.id : undefined`). No other
  engine change; no `world-session`/`interactions` import.
- **Composition root (`App.tsx` + `RoomViewer.tsx`, both composition-root-class
  per BOUNDARIES):**
  - App constructs the headless runtime once: `InMemoryWorldStore`, the real
    `Clock`/`IdGenerator` from `platform/system/`, a `WorldSession`, and an
    `InteractionService`. Pass the `InteractionService` (and a small
    session-start helper) down to `RoomViewer`.
  - On room load (after `roomSource.getRoom()` resolves), the composition root
    derives a **`CanonSeed` from the room** — `worldId = idGen.newId()`,
    `name = room.name`, `startingRoomId = room.id`, `initialPlayer` from
    composition-root defaults (e.g. `health { current: 100, max: 100 }`, empty
    `status`/`inventory`). **None of this enters RoomSpec.** Call
    `session.startSession(canon)`; hold `sessionId` and current `revision` in
    refs.
  - Build an effect-lookup map `interactableId → { effect, ref }` from
    `room.objects` (objects whose `interaction.effect` is present). Keep this in a
    small **pure helper** so it is unit-testable without the DOM.
  - On `onRequestOpenInteraction(target)`: lock input + open the panel as today,
    **and** call `interactionService.resolve({ sessionId, effect, ref })` using
    `target.id`. Apply the typed `InteractionResult` to the panel (one extra
    confirmation line) and update the tracked `revision`/state.
- **`DialoguePanel.tsx`:** accept an optional result/outcome message prop and
  render one extra line (e.g. "You take: Medkit ×1", "Already searched.",
  "You don't have that."). **No redesign, no new component.**
- **Example rooms (`throneRoom.ts`, `ruinedRoom.ts`):** give interactable objects
  stable `id`s and `effect`s — scroll/npc/zombie → `inspect`; a crate →
  `take-item`; add one `use-item` (e.g. a medkit) to demonstrate remove + heal.
  Data only.

Session lifecycle is **ephemeral**: one in-memory session per room load, no
persistence. A new room (e.g. via a prompt) starts a fresh session.

## Failure modes (to add to [FAILURE-MODES.md](../FAILURE-MODES.md))

New case **12 — Object interaction resolution**:

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Re-read / re-open a one-shot | room-state flag already set | `already-resolved`; no event appended; panel still shows `body` | code only |
| Repeated item pickup | `take-item` flag gate | `already-resolved`; no second `item-added` | code only |
| Interaction has no `effect` | service step 1 | `rejected: missing-effect`; panel opens with `body` | code only |
| One-shot effect, no stable id | planner | `rejected: missing-id`; no event (decision 5) | code only |
| `use-item` with too few held | planner held-check (+ `appendEvent` guard) | `rejected: insufficient-item`; nothing appended | code only |
| Stale `expectedRevision` | `appendEvent` → `conflict` | `failed: conflict`; caller may re-read state | code, revision |
| Mid-sequence append failure | service step 4 | `failed: partial`; no retry | code, count |

**Single-writer atomicity (consistency rule):** v0 has a single in-process writer
and the service threads each command's `expectedRevision` from the previous
append's returned revision, so a mid-sequence `conflict` cannot occur in
practice; `take-item`'s two events are therefore effectively atomic. Should any
append still fail, the service returns `failed: partial` and does not retry. True
cross-event atomicity (a multi-event unit-of-work or a compound event) is a
future concern, consistent with `WorldStore.commit` being single-event today
([ADR-0013](./ADR-0013-world-state-event-log-v0.md)).

## Boundaries (encoded with the shipped code)

- `domain/interactions/**` is covered by the existing `src/domain/**` lint block
  (zod only; no React/Three/renderer/UI/platform). No lint change needed there.
- A `src/interactions/**` `no-restricted-imports` block in
  [`eslint.config.js`](../../../apps/web/eslint.config.js) mirroring the
  `world-session/**` block: it may import domain contracts/ports and the `Logger`
  interface, but must **not** import `react`, `react-dom`, `three`, `three/*`, or
  `**/renderer/**`. `no-console` stays enforced (the service logs via `Logger`).
- The engine keeps its existing block forbidding `react`/`react-dom` and now also
  forbids `**/world-session/**` + `**/interactions/**`; it cannot gain the state
  mutation/application dependencies that the callback boundary excludes.
- No engine objects ever enter `InteractionEffect`, the plan, or the result
  ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

## Commit plan

Small, independently buildable/testable commits (AGENTS.md rule 12). Codex
implements; the maintainer commits manually.

1. **`feat(domain): add interaction effect contracts and planner`** —
   `domain/interactions/effects.ts`, `domain/interactions/planInteraction.ts`
   (+ result/outcome types), optional `effect` on `Interaction` and optional
   `interaction` on `crate`/`barrel`/`debris`/`barricade` in `roomSpec.ts`, and
   unit tests. Pure domain; no wiring.
2. **`feat(interactions): add interaction service over world session`** —
   `interactions/InteractionService.ts`, the `src/interactions/**` lint block,
   and tests (fake `Clock`/`IdGenerator` + `InMemoryWorldStore`). Headless.
3. **`feat(app): wire object interactions into the session`** — optional `id` on
   `Interactable`; engine passes it through; `App`/`RoomViewer` start the session
   and route opens through `InteractionService`; `DialoguePanel` shows the typed
   outcome; example rooms gain `id`s + `effect`s; a pure effect-lookup helper +
   its test.
4. **`docs(architecture): record object-interactions-v0`** — flip this ADR's
   status to *implemented*; add the interaction layer to
   [ARCHITECTURE.md](../ARCHITECTURE.md), [BOUNDARIES.md](../BOUNDARIES.md) (layer
   row + lint note), [FAILURE-MODES.md](../FAILURE-MODES.md) (case 12), and the
   [AGENTS.md](../../../AGENTS.md) module table.

Each commit must leave `npm run build`, `npm run lint`, and `npm run test`
(in `apps/web`) passing.

## Files likely to change

- **New:** `apps/web/src/domain/interactions/effects.ts`,
  `apps/web/src/domain/interactions/planInteraction.ts` (+ result types),
  `apps/web/src/domain/interactions/planInteraction.test.ts`,
  `apps/web/src/interactions/InteractionService.ts`,
  `apps/web/src/interactions/InteractionService.test.ts`, this ADR.
- **Edited (core):** `apps/web/src/domain/roomSpec.ts`,
  `apps/web/eslint.config.js`.
- **Edited (wiring, commit 3):** `apps/web/src/domain/ports/interaction.ts`,
  `apps/web/src/renderer/engine/Engine.ts`, `apps/web/src/App.tsx`,
  `apps/web/src/renderer/RoomViewer.tsx`,
  `apps/web/src/renderer/ui/DialoguePanel.tsx`,
  `apps/web/src/domain/examples/throneRoom.ts`,
  `apps/web/src/domain/examples/ruinedRoom.ts` (+ a small effect-lookup helper).
- **Docs:** `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`, `AGENTS.md`.

## Tests (Vitest; co-located; no browser/e2e)

- **Effect schema:** valid effects parse per `kind`; malformed rejected;
  `Interaction` without `effect` still valid; an object with optional
  `interaction` parses, one without still parses.
- **Planner:** each `kind` → exact `WorldCommand[]`; one-shot idempotency
  (`flag` set → `already-resolved`, no commands); `missing-id` when no `ref`/`flag`;
  `insufficient-item` (held `<` quantity, and the held `==` quantity boundary);
  `use-item` with and without `health`; purity / no input mutation; determinism;
  stable flag-key derivation (`interaction:<id>` and explicit `flag`).
- **InteractionService (fake ports + `InMemoryWorldStore`):** applied path appends
  the expected events and bumps `revision`; `already-resolved` appends nothing;
  `take-item` threads revision across two events and
  `projectWorldState(log) deepEquals snapshot`; `use-item` insufficient →
  `rejected`, nothing appended; `missing-effect` → `rejected`; stale revision →
  `failed: conflict`; missing session → `failed: not-found`; **log-safety**
  (assert `item.name`/`body`/`title`/`reason` never reach the logger — mirrors the
  ADR-0013 prompt-safety test).
- **Composition (commit 3):** unit-test the **pure effect-lookup helper**
  (`interactable id → { effect, ref }`); do **not** add WebGL/DOM e2e tests
  (consistent with `RoomViewer` having no unit test today).

## Consequences

- E/F interactions produce real, append-only world-state effects through the
  unchanged ADR-0013 write path, fully unit-tested headless, with the renderer
  still emitting only intent. "Read the scroll" now records an event; "open the
  crate" adds an item; "use the medkit" removes it and changes health.
- The event union and the world-session write path are untouched, so this slice
  adds no domain risk to the authoritative-truth layer.
- The pure planner makes "what an interaction does" a deterministic, testable
  domain decision; the LLM could later emit `InteractionEffect` **data**
  (validated at the boundary) without any new code path to execution
  ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- Multi-event effects rely on single-writer sequencing for consistency; a future
  multi-event unit-of-work or compound event would harden this if concurrency is
  ever introduced.

## Alternatives considered

- **Add an `interaction-resolved` event type** for first-class "append event" /
  idempotency — rejected for v0 (Q2): expands ADR-0013's closed union; reusing
  `room-state-changed.flags` meets the need with no domain-union change. Revisit
  only with maintainer approval.
- **Put the effect→command mapping in the engine or the service** — rejected: the
  mapping is a renderer-agnostic domain decision (a peer of `applyEvent`/
  `validateRoom`) the future backend edge can reuse; keeping it pure makes it
  deterministically testable (same reasoning as [ADR-0011](./ADR-0011-semantic-room-validator-v0.md)).
- **Let the engine resolve interactions directly** — rejected: it would make the
  renderer import `world-session` and mutate state, violating the core boundary
  (BOUNDARIES.md). The engine emits intent; the composition root wires effects.
- **Derive idempotency from object index or generate a ref** — rejected
  (decision 5): indices/random ids are not stable across reloads/regeneration, so
  idempotency would silently break; require a stable author id and return
  `missing-id` otherwise.
- **Keep it fully headless (skip commit 3)** — rejected (Q1): the feature goal is
  precisely to replace demo text with real in-app effects; the wiring is isolated
  in one small commit and keeps the renderer import-clean.
- **Compound/atomic multi-event effect** for `take-item`/`use-item` — deferred:
  `WorldStore.commit` is single-event today; single-writer sequencing makes the
  two events effectively atomic in v0, and a `partial` result reports the
  (v0-impossible) failure honestly.

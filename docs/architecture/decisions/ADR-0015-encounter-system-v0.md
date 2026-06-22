# ADR-0015: Encounter System v0 — threat encounters produce world-state/event-log effects

- **Status:** Accepted — **design approved; not yet implemented** (Encounter System v0)
- **Date:** 2026-06-22
- **Deciders:** Project owner

> This ADR is an **approved design / implementation brief**. It records the agreed
> shape so the implementing agent (Codex) can build it without re-deciding. It is
> **not implemented yet**; flip the status to *implemented* in the docs commit once
> the slice lands. The implementer must **not** commit — the maintainer commits
> manually.

## Context

Object Interactions v0 ([ADR-0014](./ADR-0014-object-interactions-v0.md)) wired the
renderer's E/F interaction intent into the authoritative world-state/event-log truth
layer ([ADR-0013](./ADR-0013-world-state-event-log-v0.md)): a neutral `Interactable`
intent → a pure `planInteraction` → an `InteractionService` that writes only through
`WorldSession.appendEvent`. A single key press resolves a single, data-only
`InteractionEffect` (`inspect`, `take-item`, `use-item`).

The next foundation is a small, **genre-neutral encounter layer**: a *threat* the player
meets, a set of *choices* (`fight`, `hide`, `run`, `distract`, `negotiate`), and a
deterministic *authored outcome* per choice that updates world state through the
**existing** events. The same examples must work across genres — zombie survival (a bite),
fantasy (a guard confrontation, a cursed statue), space (a hostile drone, an oxygen leak),
mystery (a guard catches the player, a trap), mythology (a spirit trial, a temple trap) —
**without genre-specific code**.

An encounter differs from an interaction in exactly one structural way: it is **two-phase**
— first *present* the threat and its choices, then *resolve* the one the player picks.
Everything else (pure planner → typed plan → service threads commands through
`appendEvent`; `room-state-changed.flags` for one-shot idempotency; stable-id rule; typed
results) reuses the ADR-0014 blueprint.

## Maintainer-approved decisions (binding for this slice)

This brief was approved with these explicit choices:

1. **Service shape (Q1):** a **separate** pure `planEncounter` + **separate**
   `EncounterService`. Extract a small shared `world-session/applyCommands.ts` helper for
   the revision-threading apply loop and **refactor `InteractionService` to use it**, only
   as long as that refactor is **small and behavior-preserving** (its existing tests must
   stay green unchanged).
2. **Integration depth (Q2):** include the minimal composition-root wiring as **commit 3**
   so encounters work in-app through the **existing E/F interaction flow**. The renderer
   **must still only emit intent** — it must not import `encounters`/`world-session` and
   must not mutate state.
3. **Trigger surface (Q3):** encounters **ride the existing `Interaction` model**
   (`interaction.encounter?`). Pressing E/F on an object/NPC whose interaction carries an
   encounter triggers it. **If an interaction has both `effect` and `encounter`, the
   encounter takes precedence.**
4. **Lethality (Q4):** use the existing `health-changed` behavior; allow health to clamp
   to `0`. **Do not** add death/game-over/respawn/permadeath state in this slice.
5. **Outcome vocabulary (Q5):** include **all six** encounter effect atoms — `damage`,
   `heal`, `add-status`, `clear-status`, `remove-item`, `add-item`. Each maps 1:1 to an
   existing `WorldCommand`.
6. **No new world-session event types.** Reuse the existing events only
   (`health-changed`, `status-changed`, `item-added`, `item-removed`,
   `room-state-changed`). *(If implementation appears to need a new event type, STOP and
   ask the maintainer first — per the standing constraint.)*
7. **Stable-id rule (carried from ADR-0014 decision 5):** the encounter's one-shot
   resolution key must be **stable**, derived from `encounter.id` or the object `ref`.
   **Never generate a random id** — return typed `missing-id` instead.

## Decision

Insert a thin, two-part encounter layer parallel to ADR-0014, and wire it at the
composition root over the **existing** interaction trigger:

```
 Engine (renderer)            — emits intent only; no encounters/world-session import
   onRequestOpenInteraction(target: Interactable)   target carries a stable id
        │
        ▼  (composition root maps id → EncounterSpec from the LoadedRoom; encounter wins over effect)
   open the encounter panel: show threat description + choice buttons (no state change yet)
        │
        ▼  player picks a choice → choiceId
 planEncounter({ encounter, choiceId, ref, state })   — PURE DOMAIN: decide what happens
        │     → EncounterPlan: apply(commands[]) | already-resolved | rejected
        ▼
 EncounterService.resolve(...)        — APPLICATION: execute the plan
        │     applyCommands(...) threads each WorldCommand through WorldSession.appendEvent
        ▼
 WorldSession.appendEvent → applyEvent → WorldStore.commit   (ADR-0013 write path)
        │
        ▼  typed EncounterResult back to the composition root → DialoguePanel result line
```

The **planner is pure domain** (a peer of `planInteraction`/`applyEvent`): encounter +
chosen choice + current `WorldState` → an ordered list of **existing** `WorldCommand`s, or
a typed non-apply outcome. The **service is application** (a peer of `InteractionService`):
it runs the commands through the unchanged ADR-0013 write path and returns a typed result.
The **renderer is untouched** — it already collects any object with an `interaction` and
passes the object `id` through `onRequestOpenInteraction`, which is all the encounter
trigger needs.

### Architectural rules (binding)

1. **The renderer only emits intent.** The engine never imports
   `encounters`/`world-session`, never holds a `WorldSession`/`EncounterService`, and never
   mutates `WorldState`. **No engine change and no `Interactable` change** is required —
   `id` already flows through.
2. **All state changes go through `WorldSession.appendEvent`** — the ADR-0013 single write
   path. No new write path, no direct snapshot setters.
3. **No new world-session event types.** Outcomes compose the existing five reusable
   events only. Reuse `room-state-changed.flags` for one-shot resolution idempotency
   (decision 6).
4. **The planner is pure and total** — no I/O, no `Date.now`/`Math.random`/`crypto`, never
   mutates its inputs, deterministic under fixed input (mirrors `planInteraction`).
5. **Expected failures are typed results, never thrown** (`missing-id`, `missing-encounter`,
   `unknown-choice`, `insufficient-item`, `already-resolved`, `conflict`, `not-found`,
   `partial`). Genuine bugs may still throw.
6. **Encounters are data only.** `EncounterSpec` is a zod-validated descriptor selected
   from fixed vocabularies (`action` enum, effect-atom `kind` union) — never code, never
   `eval`'d ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)). RoomSpec
   stays renderer-agnostic; no engine objects enter encounters or results.
7. **Idempotency keys are stable, never random** (decision 7).
8. **Genre-neutral.** The only fixed vocabulary is the genre-neutral `action` enum and the
   generic effect atoms. All threat text, choice labels, result text, status strings, and
   item names/ids are **authored data** — no zombie/fantasy/space/mystery-specific code.
9. **Logs carry ids/counts/codes only** — never `description`, `title`, choice `label`,
   `resultText`, status strings, item `name`, `reason`, or any narrative/user content
   (ADR-0013 rule 10, [ADR-0003](./ADR-0003-logging-abstraction.md)).
10. **Determinism / no randomness in v0.** One authored outcome per choice; no PRNG. If
    randomness is added later it must flow through a seeded `Rng` port at the application
    layer (the [ADR-0010](./ADR-0010-generation-foundation-v0.md) discipline) — never
    `Math.random` in the domain.
11. **Ports + constructor injection; no new framework** (AGENTS.md rule 13).

## Scope (v0)

**In scope:**

- `domain/encounters/` (pure): the `EncounterSpec` schema (incl. `EncounterChoice`,
  `EncounterOutcome`, `EncounterEffectAtom`), the `planEncounter` function, and the
  `EncounterPlan`/`EncounterOutcomeResult` result types.
- A `RoomSpec` change: optional `encounter` on the **shared `Interaction`** object (rides
  alongside the existing `effect`). No per-object-type schema change.
- `world-session/applyCommands.ts` (application helper): the shared revision-threading
  apply loop; **`InteractionService` refactored** to use it (small, behavior-preserving).
- `encounters/` (application, headless): `EncounterService` over `WorldSession`, with its
  own lint block, plus full Vitest coverage.
- Minimal composition-root wiring (commit 3): a pure encounter-lookup helper; the
  composition routes an E/F open to the encounter panel when the object has an encounter
  (encounter wins over `effect`); `DialoguePanel` gains optional choice buttons; `App`
  constructs the `EncounterService`; the example rooms gain one encounter each (different
  genres).
- ADR + architecture-doc/boundary/failure-mode/AGENTS updates (commit 4).

**Out of scope / non-goals (must NOT be built in this slice):**

- ❌ New world-session event types (decision 6) — **stop and ask** if one seems needed.
- ❌ Real-time combat, turn loops, or any damage model beyond `health-changed`; enemy AI,
  pathfinding, enemy movement, weapon physics.
- ❌ Death / game-over / respawn / permadeath state (decision 4).
- ❌ Randomness / dice / loot tables (deterministic authored outcomes only; seeded-PRNG
  seam deferred).
- ❌ Proximity / auto-trigger volumes or any renderer trigger logic; renderer importing
  `encounters`/`world-session` or mutating state.
- ❌ Real LLM; LLM-authored encounters (encounters are authored data this slice); NPC
  dialogue trees/branching.
- ❌ Real backend, DB/SQLite/Postgres, HTTP/`apps/api`, `packages/contracts`,
  multiplayer/PvP.
- ❌ Inventory/HUD **redesign** (reuse the existing `DialoguePanel` result surface).
- ❌ GLTF/animation; first-person/free-camera; any camera/player work.
- ❌ Multi-room consequences, cross-room persistence, save/load wiring.
- ❌ Cooldowns/timers/escalation.

## Data model

Exact zod 4 calls are the implementer's choice; the constraints below are binding. Reuse
`InventoryItemSchema` from [`domain/world/worldState.ts`](../../../apps/web/src/domain/world/worldState.ts)
and the `WorldCommand` type from [`domain/world/events.ts`](../../../apps/web/src/domain/world/events.ts)
(domain → domain imports are allowed). Watch for import cycles, exactly as ADR-0014 did:
`encounterSpec.ts` imports `InventoryItemSchema` from `world/worldState.ts`; `roomSpec.ts`
imports `encounterSpec.ts`. No cycle today — keep it that way.

### `EncounterEffectAtom` (`domain/encounters/encounterSpec.ts`)

A discriminated union on `kind`, data only. Each atom maps to exactly one existing
`WorldCommand` (no new event type):

| `kind` | Payload | → `WorldCommand` |
| --- | --- | --- |
| `damage` | `{ amount: int ≥ 1 }` | `health-changed { delta: -amount }` |
| `heal` | `{ amount: int ≥ 1 }` | `health-changed { delta: +amount }` |
| `add-status` | `{ status: non-empty string }` | `status-changed { status, op: 'add' }` |
| `clear-status` | `{ status: non-empty string }` | `status-changed { status, op: 'clear' }` |
| `remove-item` | `{ itemId: non-empty string, quantity: int ≥ 1 }` | `item-removed { itemId, quantity }` |
| `add-item` | `{ item: InventoryItem }` | `item-added { item }` |

- **No `reason` is emitted** into `health-changed`. Narrative stays in `outcome.resultText`
  and never enters the event log (keeps the log free of user text by construction).

### `EncounterChoice`, `EncounterOutcome`, `EncounterSpec`

```
EncounterOutcome = {
  effects: EncounterEffectAtom[]   // default []; may be empty (e.g. 'hide' = nothing happens)
  resultText?: string              // display only; NEVER logged
}

EncounterChoice = {
  id: non-empty string             // stable; identifies the chosen option
  action: 'fight' | 'hide' | 'run' | 'distract' | 'negotiate'   // genre-neutral vocabulary
  label: non-empty string          // display, e.g. "Fight it off"; NEVER logged
  requires?: { itemId: non-empty string, quantity: int ≥ 1 }     // optional possession gate
  outcome: EncounterOutcome
}

EncounterSpec = {
  id?: string                      // stable encounter id; falls back to the object ref
  title?: string                   // display threat name; NEVER logged
  description: non-empty string    // display threat text; NEVER logged
  choices: EncounterChoice[]       // .min(1); refine: unique choice ids
}
```

- Export each schema plus inferred types (`EncounterEffectAtom`, `EncounterChoice`,
  `EncounterOutcome`, `EncounterSpec`, and a `ChoiceAction` type for the `action` enum).
- `requires` only **checks possession**; consuming the item, if desired, is an explicit
  `remove-item` atom in the same outcome (gate and consumption are separate and explicit).

### RoomSpec change (`domain/roomSpec.ts`)

- Add `encounter: EncounterSpecSchema.optional()` to the shared `Interaction` object,
  alongside the existing `effect`. Because `Interaction` is embedded in `scroll`/`npc`
  (required) and optional on `crate`/`barrel`/`debris`/`barricade`/`zombie`, **every object
  that can carry an interaction can carry an encounter** with no per-type change.
- An `Interaction` with neither `effect` nor `encounter` stays valid (presentation-only).
- No `Interactable` view-model change and no engine change (decision 3 / rule 1).

## Pure planner (`domain/encounters/planEncounter.ts`)

`planEncounter(input: { encounter, choiceId, ref, state }) → EncounterPlan`, where `ref` is
the object's stable `id` (`string | undefined`), `choiceId` is the picked choice id, and
`state` is the current `WorldState`. Pure, total, deterministic, never mutates inputs.

**Resolution idempotency key (one-shot):**
`resolvedKey = encounter.id ? \`encounter:${encounter.id}\` : (ref ? \`encounter:${ref}\` : undefined)`.
If `resolvedKey` is `undefined` → `{ status: 'rejected', reason: 'missing-id' }`
(decision 7 — never invent an id). The flag lives under
`state.roomStates[state.currentRoomId].flags[resolvedKey]`.

**Algorithm:**

1. `resolvedKey` undefined → `rejected: missing-id`.
2. flag already set → `{ status: 'already-resolved', outcome: { kind: 'nothing' } }`
   (append nothing; the panel still shows `description`).
3. `choice = encounter.choices.find(c => c.id === choiceId)`; none → `rejected: unknown-choice`.
4. `choice.requires` and held `<` `requires.quantity` → `rejected: insufficient-item`
   (held quantity read from `state.inventory`; `appendEvent` re-checks any `item-removed`
   as defense-in-depth, mirroring `use-item`).
5. Otherwise:
   - `commands = [ ...mapAtoms(choice.outcome.effects, state), roomFlagCommand(currentRoomId, resolvedKey) ]`
     — **outcome effects first, the resolution flag last** (mirrors `take-item` ordering).
   - `outcome = { kind: 'resolved', action: choice.action, choiceId: choice.id }`.
   - `{ status: 'apply', commands, outcome }`.

- `mapAtoms` produces the table above; every command includes `schemaVersion: 1`, is built
  via `WorldCommandSchema.parse(...)`, and uses `roomId = state.currentRoomId`.
- The planner returns **no narrative text** — `description`/`label`/`resultText` for the
  panel come from the `EncounterSpec` at the composition root, keeping display strings out
  of the domain and the logs.

**Result types (`domain/encounters/` — exported for the service & UI):**

```
type ChoiceAction = 'fight' | 'hide' | 'run' | 'distract' | 'negotiate'

EncounterOutcomeResult =
  | { kind: 'resolved'; action: ChoiceAction; choiceId: string }
  | { kind: 'nothing' }                       // already-resolved / no-op

EncounterPlan =
  | { status: 'apply'; commands: WorldCommand[]; outcome: EncounterOutcomeResult }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' } }
  | { status: 'rejected'; reason: 'missing-id' | 'unknown-choice' | 'insufficient-item' }
```

`missing-encounter` is produced by the **caller/service** when the object has no encounter
attached (the planner is only called with an encounter); document it as a service-level
rejection.

## Shared apply helper (`world-session/applyCommands.ts`)

Extract the revision-threading loop currently inlined in `InteractionService.resolve` into
one small application helper both services use (decision 1):

```
applyCommands(
  session: Pick<WorldSession, 'appendEvent'>,
  sessionId: string,
  commands: WorldCommand[],
  fromState: WorldState,
) → Promise<
  | { ok: true; state: WorldState }
  | { ok: false; reason: 'conflict' | 'not-found' | 'partial' }
>
```

- Start `revision = fromState.revision`. For each command in order:
  `res = await session.appendEvent(sessionId, command, revision)`.
  - On failure: if it's the **first** command, map `res.error.code`
    (`conflict`/`not-found`/other → `'conflict'`/`'not-found'`/`'partial'`); if a **later**
    command, return `partial`. Do not retry.
  - On success: `revision = res.state.revision`; keep `res.state` as latest.
- All committed → `{ ok: true, state: latest }`.
- **`InteractionService` refactor must be behavior-preserving**: its existing typed results
  and its current test suite stay unchanged and green. The helper lives in
  `world-session/` because both `interactions/` and `encounters/` already depend on
  `world-session` and the domain (no new cross-layer dependency).

## Application service (`encounters/EncounterService.ts`)

Headless application layer, constructor-injected with a `WorldSession` (or the same
`Pick<WorldSession, 'getWorldState' | 'appendEvent'>` shape `InteractionService` uses) and a
`Logger` (DI = constructor params). One method:

`resolve(input: { sessionId, encounter?, choiceId, ref }) → Promise<EncounterResult>`:

1. `encounter` absent → `{ status: 'rejected', reason: 'missing-encounter' }`.
2. `session.getWorldState(sessionId)` → not ok → `{ status: 'failed', reason: 'not-found' }`.
3. `plan = planEncounter({ encounter, choiceId, ref, state })`.
   - `already-resolved` → `{ status: 'already-resolved', outcome, state }`.
   - `rejected` → `{ status: 'rejected', reason }`.
4. `apply`: `result = await applyCommands(session, sessionId, plan.commands, state)`.
   - `ok` → `{ status: 'applied', outcome: plan.outcome, state: result.state }`.
   - not ok → `{ status: 'failed', reason: result.reason }`.

```
EncounterResult =
  | { status: 'applied'; outcome: EncounterOutcomeResult; state: WorldState }
  | { status: 'already-resolved'; outcome: { kind: 'nothing' }; state: WorldState }
  | { status: 'rejected'; reason: 'missing-id' | 'missing-encounter' | 'unknown-choice' | 'insufficient-item' }
  | { status: 'failed'; reason: 'conflict' | 'not-found' | 'partial' }
```

**Logging:** `sessionId`, the chosen `action`, command count, and result `status`/`reason`
**codes** only — never `description`, `title`, `label`, `resultText`, status strings,
`item.name`, or `health` deltas beyond what a code conveys (rule 9).

## Composition-root wiring (commit 3)

Keep it small; the renderer stays import-clean.

- **Engine / `Interactable`:** **no change** — the engine already passes `target.id`
  through `onRequestOpenInteraction` (rule 1).
- **Pure encounter-lookup helper (`app/encounters.ts`):** build
  `interactableId → EncounterSpec` from `room.objects` (objects whose
  `interaction.encounter` is present and that have an `id`; dedup first-wins, mirroring
  `buildInteractionEffectLookup`). Add an `encounterResultMessage(result)` mapper for the
  panel's result line (display strings live here, not in the domain). Keep both in a small
  **pure helper** so they are unit-testable without the DOM.
- **Composition root (`App.tsx` + `RoomViewer.tsx`):**
  - `App` constructs the `EncounterService` once (reusing the existing `WorldSession`),
    alongside the existing `InteractionService`, and passes it to `RoomViewer`.
  - On room load, build the encounter lookup next to the existing effect lookup.
  - On `onRequestOpenInteraction(target)`: **if `target.id` resolves to an encounter, open
    the encounter panel** (show `description` + choice buttons) and route a chosen choice to
    `encounterService.resolve({ sessionId, encounter, choiceId, ref: target.id })`;
    **otherwise** fall through to today's effect path. **Encounter wins over `effect`** when
    both exist (decision 3). Apply the typed `EncounterResult` to the panel result line and
    update the tracked `revision`/state, exactly as the interaction path does.
- **`DialoguePanel.tsx`:** accept optional presentational props
  `choices?: { id: string; label: string }[]` and `onChoose?(id: string)`, rendering one
  button per choice when present (and not yet resolved), and reusing the existing
  `resultMessage` line for the outcome. **No redesign, no new HUD, no inventory UI.** (A
  dedicated `EncounterPanel` is an acceptable alternative if it stays presentational and
  imports no Three.js/world-session; the default is the minimal `DialoguePanel` extension.)
- **Example rooms — one encounter each, different genres (data only):**
  - `ruinedRoom.ts` (survival): an existing `zombie` gains an `encounter` — e.g.
    `fight` → `damage` + `add-status` (`infected`); `hide` → empty effects; `run` →
    resolution flag only. Demonstrates damage + status.
  - `throneRoom.ts` (fantasy/mystery): the `npc` Malik gains an `encounter` — e.g.
    `negotiate` → `remove-item` (a bribe); `distract` → `requires` an item; `fight` →
    `damage`. Demonstrates inventory + gating across a different genre.

Session lifecycle is **ephemeral**, exactly as ADR-0014: one in-memory session per room
load; resolution flags reset on reload; no cross-room persistence.

## Failure modes (to add to [FAILURE-MODES.md](../FAILURE-MODES.md))

New case **13 — Encounter resolution** (peer of case 12):

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Re-trigger a resolved encounter | room-state flag already set | `already-resolved`; no event appended; panel still shows `description` | code only |
| Object has no `encounter` | service step 1 | `rejected: missing-encounter`; effect path or plain panel | code only |
| Encounter has no stable id/ref | planner | `rejected: missing-id`; no event (decision 7) | code only |
| Choice id not in encounter | planner | `rejected: unknown-choice`; no event | code only |
| Choice gate not met (too few items) | planner held-check (+ `appendEvent` guard) | `rejected: insufficient-item`; nothing appended | code only |
| Stale `expectedRevision` | `appendEvent` → `conflict` | `failed: conflict`; caller may re-read state | code, revision |
| Mid-sequence append failure | `applyCommands` later index | `failed: partial`; no retry | code, count |
| Lethal damage | `applyEvent` clamp | health clamps to `0`; **no death state** (decision 4) | code only |

**Single-writer atomicity (consistency rule):** v0 has a single in-process writer and
`applyCommands` threads each command's `expectedRevision` from the previous append, so a
mid-sequence `conflict` cannot occur in practice; an encounter's outcome effects + the
resolution flag are therefore effectively atomic. Ordering is **effects first, flag last**
(matches `take-item`). Should any append still fail, the service returns `failed: partial`
and does not retry. True cross-event atomicity (a multi-event unit-of-work or a compound
event) is deferred and would require a new event type — **stop and ask**
([ADR-0013](./ADR-0013-world-state-event-log-v0.md), [ADR-0014](./ADR-0014-object-interactions-v0.md)).

## Boundaries (encoded with the shipped code)

- `domain/encounters/**` is covered by the existing `src/domain/**` lint block (zod only;
  no React/Three/renderer/UI/platform). No lint change needed there.
- A `src/encounters/**` `no-restricted-imports` block in
  [`eslint.config.js`](../../../apps/web/eslint.config.js) **mirroring the
  `src/interactions/**` block**: it may import domain contracts/ports, `world-session`, and
  the `Logger` interface, but must **not** import `react`, `react-dom`, `three`, `three/*`,
  or `**/renderer/**`. `no-console` stays enforced (the service logs via `Logger`).
- `world-session/applyCommands.ts` stays inside the existing `src/world-session/**` block.
- The engine keeps its existing block forbidding `react`/`react-dom`,
  `**/world-session/**`, and `**/interactions/**`; **add `**/encounters/**`** to that same
  forbidden list so the renderer cannot gain encounter application/domain dependencies.
- No engine objects ever enter `EncounterSpec`, the plan, or the result
  ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

## Commit plan

Small, independently buildable/testable commits (AGENTS.md rule 12). Codex implements; the
maintainer commits manually. Each commit must leave `npm run build`, `npm run lint`, and
`npm run test` (in `apps/web`) passing.

1. **`feat(domain): add encounter contracts and planner`** —
   `domain/encounters/encounterSpec.ts`, `domain/encounters/planEncounter.ts` (+ result
   types), optional `encounter` on the shared `Interaction` in `roomSpec.ts`, and unit
   tests. Pure domain; no wiring.
2. **`feat(encounters): add encounter service over world session`** —
   `world-session/applyCommands.ts` (+ `InteractionService` refactored to use it,
   behavior-preserving), `encounters/EncounterService.ts`, the `src/encounters/**` lint
   block, and tests (fake `Clock`/`IdGenerator` + `InMemoryWorldStore`). Headless.
3. **`feat(app): wire encounters into the session`** — the pure encounter-lookup +
   result-message helper (`app/encounters.ts`); `DialoguePanel` choice extension;
   `App`/`RoomViewer` route encounter triggers (encounter wins over `effect`) and construct
   `EncounterService`; example encounters in `ruinedRoom.ts`/`throneRoom.ts`; helper test.
4. **`docs(architecture): record encounter-system-v0`** — flip this ADR's status to
   *implemented*; add the encounter layer to [ARCHITECTURE.md](../ARCHITECTURE.md),
   [BOUNDARIES.md](../BOUNDARIES.md) (layer row + lint note),
   [FAILURE-MODES.md](../FAILURE-MODES.md) (case 13), and the
   [AGENTS.md](../../../AGENTS.md) module table.

## Files likely to change

- **New:** `apps/web/src/domain/encounters/encounterSpec.ts`,
  `apps/web/src/domain/encounters/planEncounter.ts` (+ result types),
  `apps/web/src/domain/encounters/planEncounter.test.ts`,
  `apps/web/src/world-session/applyCommands.ts`,
  `apps/web/src/world-session/applyCommands.test.ts` (optional if covered indirectly),
  `apps/web/src/encounters/EncounterService.ts`,
  `apps/web/src/encounters/EncounterService.test.ts`,
  `apps/web/src/app/encounters.ts`, `apps/web/src/app/encounters.test.ts`, this ADR.
- **Edited (core):** `apps/web/src/domain/roomSpec.ts`, `apps/web/eslint.config.js`,
  `apps/web/src/interactions/InteractionService.ts` (refactor to the shared helper).
- **Edited (wiring, commit 3):** `apps/web/src/renderer/ui/DialoguePanel.tsx`,
  `apps/web/src/renderer/RoomViewer.tsx`, `apps/web/src/App.tsx`,
  `apps/web/src/domain/examples/ruinedRoom.ts`,
  `apps/web/src/domain/examples/throneRoom.ts`.
- **Docs (commit 4):** `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`, `AGENTS.md`.
- **Not changed:** `apps/web/src/renderer/engine/Engine.ts`,
  `apps/web/src/domain/ports/interaction.ts`, `apps/web/src/domain/world/**` (no new event
  type).

## Tests (Vitest; co-located; no browser/e2e)

- **Encounter schema:** valid encounters parse per `action` and per effect-atom `kind`;
  malformed rejected; `choices.min(1)` and unique-choice-id refine; non-empty
  `description`/`label`; an `Interaction` without `encounter` still valid; an `Interaction`
  with both `effect` and `encounter` parses.
- **Planner (`planEncounter.test.ts`):** each `action` → exact `WorldCommand[]`; every atom
  → correct command (`damage`→negative delta, `heal`→positive, add/clear-status,
  remove/add-item); resolution flag is **always last**; `already-resolved` when the flag is
  set (no commands); `missing-id` when no `encounter.id` and no `ref`; `unknown-choice`;
  `insufficient-item` (held `<` qty, and the held `==` qty boundary passes); empty-effects
  outcome (e.g. `hide`) emits only the flag; purity / no input mutation; determinism;
  stable flag-key derivation (explicit `id` and `encounter:<ref>` fallback).
- **Shared helper / service (fake ports + `InMemoryWorldStore`):** `applyCommands` applied/
  conflict/not-found/partial threading; **`InteractionService` tests stay green unchanged**
  after the refactor (regression guard); `EncounterService` applied path appends the
  expected events and bumps `revision`; `already-resolved` appends nothing; a multi-effect
  outcome threads revision across events and `projectWorldState(log) deepEquals snapshot`;
  `insufficient-item` → rejected, nothing appended; `missing-encounter` → rejected; stale
  revision → `failed: conflict`; missing session → `failed: not-found`; **log-safety**
  (assert `description`/`title`/`label`/`resultText`/status strings/`item.name`/`reason`
  never reach the logger — mirrors the ADR-0013/0014 prompt-safety tests).
- **Composition (commit 3):** unit-test the **pure** encounter-lookup helper
  (`interactable id → EncounterSpec`, dedup first-wins, skips id-less/encounter-less
  objects) and `encounterResultMessage`; do **not** add WebGL/DOM e2e tests (consistent
  with `RoomViewer` having no unit test).

## Consequences

- E/F interactions can now open a genre-neutral threat encounter whose chosen outcome
  produces real, append-only world-state effects through the unchanged ADR-0013 write path,
  fully unit-tested headless, with the renderer still emitting only intent.
- The event union and the world-session write path are untouched (no new event type), so
  this slice adds no domain risk to the authoritative-truth layer.
- Extracting `applyCommands` removes the duplicated revision-threading loop and gives both
  interactions and encounters one tested apply path (SRP/DRY).
- The pure planner makes "what an encounter choice does" a deterministic, testable domain
  decision; the LLM could later emit `EncounterSpec` **data** (validated at the boundary)
  with no new code path to execution ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- Multi-effect outcomes rely on single-writer sequencing for consistency; a future
  multi-event unit-of-work or compound event would harden this if concurrency is ever
  introduced.

## Alternatives considered

- **Extend `InteractionService`/`planInteraction` to also handle encounters** — rejected
  (Q1): an encounter is two-phase (present choices, then resolve one) and carries a choice
  vocabulary an effect does not; folding them conflates two responsibilities. A separate
  pure planner + service with a **shared apply helper** keeps SRP without duplicating the
  write loop.
- **A new `encounter-resolved` event type** for first-class resolution/idempotency —
  rejected (decision 6): expands ADR-0013's closed union; reusing `room-state-changed.flags`
  meets the need with no domain-union change. Revisit only with maintainer approval.
- **Per-choice probabilistic outcomes (dice)** — deferred (rule 10): v0 is deterministic
  authored outcomes; randomness, if ever added, flows through a seeded `Rng` port at the
  application layer, never `Math.random` in the domain.
- **Proximity / trigger-volume encounters** — rejected for v0 (Q3): would add renderer
  trigger logic and break "renderer emits intent only". Riding the existing E/F interaction
  needs zero engine change.
- **A separate `EncounterPanel` component** — acceptable but not the default: the minimal
  `DialoguePanel` choice extension reuses the existing result surface with less code and no
  HUD redesign. A presentational `EncounterPanel` (no Three.js/world-session imports) is a
  fine substitute if preferred.
- **Add death/game-over on health 0** — rejected (Q4): out of scope; health clamps to `0`
  as today, and a `downed`/`dead` status with its own handling is a future slice.
- **Let `requires` auto-consume the gating item** — rejected: keeping the possession gate
  and an explicit `remove-item` atom separate is clearer and more flexible (some choices
  gate without consuming).
```

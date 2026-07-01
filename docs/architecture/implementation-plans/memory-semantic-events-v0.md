# Implementation Plan — `feature/memory-semantic-events-v0`

> Status: **Implemented.**
>
> **This is Slice D** of the reconciled adoption of the external *Memory & DB Design
> v1* doc — but **scoped down** from the full six-slice Slice D description. It adds
> exactly one new committed `WorldEvent` type (`item-discovered`) needed to make the
> memory demo's discovery moment promotable and trustworthy-attributed to a room, and
> it evaluates (and defers) `event_visibility`. It does **not** add `PLAYER_PROMISED_NPC`,
> `SECRET_REVEALED`, the `npc` promotion arm, or `npc_relationships` — those need
> structured dialogue output and/or event_visibility consumers that do not exist yet.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Builds on:
> `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)),
> `object-interactions-v0` ([ADR-0014](../decisions/ADR-0014-object-interactions-v0.md)),
> `memory-event-promotion-v0` (Slice A), `memory-context-ranking-v0` (Slice B),
> `memory-display-name-persistence-v0` (Slice C, C1–C3 all shipped).
>
> Locked architecture rule (unchanged): **the LLM/generation may propose only
> structured event/effect fields; the backend assigns confidence, authority,
> severity/caps, display names, and final memory text.** Nothing in this slice
> lets an LLM author a `WorldEvent` — dialogue-sourced events remain future work
> gated on structured provider output.

## 1. What I inspected, and what it means for this slice

- **`WorldEvent` union** (`domain/world/events.ts`): a 7-member zod
  `discriminatedUnion('type', [...])`. Every event shares an envelope
  (`schemaVersion: z.literal(WORLD_SCHEMA_VERSION)`, `eventId`, `sessionId`, `seq`,
  `occurredAt`) plus a `.strict()` `payload`. `WorldCommandSchema` is a **parallel**
  discriminated union — every event type has a matching command type, and
  `WorldSession.appendEvent` validates the command, then `buildEvent`'s switch maps
  command → event. **Adding a new event type means adding matching branches to
  both unions**, not just the event side.
- **Reducer** (`domain/world/applyEvent.ts`): a `switch (event.type)` with
  `default: return assertNever(event)` — a TS exhaustiveness check. **Any new event
  type must get a `case` here or the build fails.** The existing `room-state-changed`
  case already does exactly what "durable room/object change" needs: it merges a
  `flags: Record<string, boolean>` map into `roomStates[roomId]`. **This means the
  "durable room/object change" event the task asks about is already represented —
  no new event type is needed for it.**
- **`WORLD_SCHEMA_VERSION` reuse**: the same `z.literal(1)` constant gates the event
  envelope, `WorldState`, `CanonSeed`, and `SaveGameSchema.schemaVersion`. Adding a new
  *discriminated-union member* does not change what literal value any existing field
  must hold — old event rows are completely unaffected (they still match their own
  existing variant). This is the same reasoning already used and shipped in
  `memory-display-name-persistence-v0` (C1) for additive schema change without a
  version bump. **No `WORLD_SCHEMA_VERSION` bump needed.**
- **Save/load** (`domain/world/saveGame.ts`, `world-session/saveGame.ts`): `SaveGame`
  embeds the **entire event log** (`log: z.array(WorldEventSchema)`) plus the
  snapshot, and `hasValidIntegrity` re-derives `projectWorldState(saveGame.log)` and
  deep-equals it against the stored snapshot. A save written by an **older** app
  version (no `item-discovered` events) loads fine under the new, larger union — a
  discriminated union with more members is a superset. A save written by a **newer**
  app version and loaded by **older** app code fails `SaveGameSchema.safeParse` (the
  old union doesn't know the new `type` literal) → clean typed `invalid-schema`
  rejection at `loadSaveGame` — no crash, existing failure mode, nothing restored.
- **Persistence event-store read boundary** (`persistence/SqliteWorldStore.ts`,
  `parseStored`): unlike the memory stores, a corrupt/unrecognized stored event
  **throws** (`corrupt stored event: failed schema validation`), it is never
  skipped — this is FAILURE-MODES' existing "never mask corruption as null" rule.
  This means: **if an app is rolled back after Slice D events have been committed,
  reading that session's event log with the old (7-member) union throws.** This is
  the honest, already-precedented risk (the C-slice doc calls out the analogous
  app-downgrade caveat for memory `.strict()` records) — accepted, not solved, same
  as today.
- **No DDL needed for the new event.** `world_events` (`persistence/migrations/0001_init.ts`)
  stores `type TEXT`, `event_json TEXT` — schema-agnostic columns. A new `type`
  string needs no migration; the table already accepts any string + JSON blob.
- **Interaction → command path**
  (`domain/interactions/planInteraction.ts`, `world-session/applyCommands.ts`):
  `planTakeItem` already knows both the taken item **and** `state.currentRoomId` —
  the one place in the codebase where "item acquired, and acquired *here*" is a
  trustworthy signal (this is exactly why Slice A left `item-added` unpromoted:
  elsewhere — encounters' `add-item` reward in `domain/encounters/planEncounter.ts`
  — an item can be granted without a spatial claim). `applyCommands` already applies
  a planner's `WorldCommand[]` **array** as a sequence of appended events threading
  revision — adding a third command to `planTakeItem`'s existing 2-command array
  (`item-added`, `room-state-changed`) needs **no new service-layer code**.
  `planTakeItem`'s existing `isFlagSet`/idempotency guard already prevents
  re-triggering the whole array (including the new command) more than once per
  `ref`.
- **`isValidForState`** (`world-session/WorldSession.ts`): a plain if-chain, not a
  switch — new command types fall through to `return true` unless a guard is added.
  The existing `moved-to-room.fromRoomId === state.currentRoomId` check is the
  precedent for adding one.
- **Dialogue has no structured output yet**
  (`dialogue/NPCDialogueService.ts`): `provider.reply()` returns free-text
  `{ text: string }` only — there is no `promise`/`secretRevealed`/structured field
  a mapper could trust. This **confirms** `PLAYER_PROMISED_NPC`/`SECRET_REVEALED`
  cannot be built yet without inventing an untrustworthy text-sniffing heuristic,
  which the locked rule ("LLM proposes structured fields only") forbids. Deferred.
- **`domain/memory/promotion.ts` (Slice A/C)**: `promoteWorldEvent` currently
  special-cases only `room-state-changed` via `durableRoomStateEvent`. It needs a
  second promotable-event branch. `promotionDedupeKey` is **already generic** over
  any `WorldEvent` (keys off `eventId`) — no change needed. `PromotedMemory.target`
  stays `'room'` — an item discovery is naturally scoped to the room it happened in;
  no new memory kind is needed (`room_observation` already fits, same as durable
  room-state changes).
- **`domain/memory/displayNames.ts` (Slice C2)**: `DisplayNameResolver`'s
  `EntityKind` is **already** `'room' | 'npc' | 'item' | 'quest'` — `'item'` was
  anticipated and needs no change. `EntitySnapshotsSchema` is a bounded
  `Record<role, snapshot>` (max 8 keys) — already flexible enough to carry both
  `{ room: {...}, item: {...} }` for one memory. No memory-schema change at all in
  this slice.
- **Existing exact-array test assertions will need updating** —
  `domain/interactions/planInteraction.test.ts` (`'plans take-item in item-first
  then idempotency-flag order'`) asserts the exact 2-command array via `toEqual`.
  Adding a third command is a **required, expected** edit to that test, not scope
  creep — flagged explicitly so it isn't mistaken for an unrelated change.
- **`event_visibility` — evaluated, recommend deferring.** No code in the repo
  reads a viewer/witness scope today: NPC memory scoping is already the
  `(worldId, sessionId, npcId)` triple (structural, not a join table), the `npc`
  promotion arm doesn't exist, and the only event this slice adds promotes as a
  **room** memory with no per-viewer gating question. Adding
  `event_visibility(event_id, viewer_type, viewer_id)` now would be a table with
  **no reader and no writer** — it fails the Minimum Safe Change Rule's first
  question ("does this need to exist for the approved feature slice?"). I recommend
  deferring the table until an actual `npc`-scoped semantic event (e.g. a future,
  structured-output-gated `PLAYER_PROMISED_NPC`) needs to gate which NPCs may recall
  it. The shape below is recorded so a later slice doesn't have to re-derive it —
  see §6.

## 2. Scope (proposed for this slice)

In:

- `domain/world/events.ts` — add `ItemDiscoveredEventSchema` (event) +
  `WorldCommandSchema` variant; both `payload: { roomId, itemId }`.
- `domain/world/applyEvent.ts` — add a `case 'item-discovered'` that is a pure
  no-op on `WorldState` beyond the existing `{ ...next, revision, updatedAt }` tail
  (the event carries no state truth of its own — inventory truth stays owned by
  `item-added`; this event exists only to record *where* a known item-added moment
  happened, for memory).
- `world-session/WorldSession.ts` — add the `item-discovered` case to `buildEvent`'s
  switch; add a validity guard to `isValidForState` requiring
  `command.roomId === state.currentRoomId` (mirrors the existing
  `moved-to-room.fromRoomId` check).
- `domain/interactions/planInteraction.ts` — `planTakeItem` appends a third command,
  `item-discovered { roomId: state.currentRoomId, itemId: effect.item.itemId }`,
  ordered `item-added → item-discovered → room-state-changed`.
- `domain/memory/promotion.ts` — extend the promotion table with `item-discovered`
  (importance 3, same tier as durable room-state changes); generic id-free fallback
  text plus named text using the resolver for both `room` and `item` roles.
- Co-located tests for all of the above (see §5).

Out (explicit non-goals for this slice):

- **No** `event_visibility` table/migration (see §1, §6 — deferred).
- **No** `PLAYER_PROMISED_NPC`, **no** `SECRET_REVEALED` (need structured dialogue
  output that does not exist yet).
- **No** `npc` promotion arm, **no** `npc_relationships`.
- **No** facts/`fact_visibility`, **no** Chroma, **no** FTS5, **no**
  rumor/hearsay/certainty modeling.
- **No** `WORLD_SCHEMA_VERSION` bump; **no** migration for `world_events`/
  `world_sessions` (schema-agnostic columns already accept the new `type`).
- **No** change to `item-added`, `room-state-changed`, or any existing event's
  payload/reducer behavior.
- **No** change to encounters (`domain/encounters/planEncounter.ts`) — encounter
  item rewards are not a trustworthy "found in this room" signal and must not emit
  `item-discovered`.
- **No** browser/UI/renderer/backend-API change.

## 3. The new event (proposed shape)

```ts
// events.ts — naming follows the existing kebab-case convention
// ('moved-to-room', 'item-added', 'room-state-changed'), not the design doc's
// SCREAMING_SNAKE_CASE (open question 1, §7).
const ItemDiscoveredEventSchema = z.object({
  ...eventEnvelope,
  type: z.literal('item-discovered'),
  payload: z.object({
    roomId: z.string().min(1),
    itemId: z.string().min(1),
  }).strict(),
}).strict()
```

Reducer (`applyEvent.ts`):

```ts
case 'item-discovered':
  next = { ...state } // no WorldState truth of its own; revision/updatedAt bump only
  break
```

`planTakeItem` (`planInteraction.ts`), only the new line:

```ts
commands: [
  WorldCommandSchema.parse({ schemaVersion: 1, type: 'item-added', item }),
  WorldCommandSchema.parse({
    schemaVersion: 1,
    type: 'item-discovered',
    roomId: state.currentRoomId,
    itemId: item.itemId,
  }),
  roomFlagCommand(state.currentRoomId, flagKey),
],
```

## 4. Promotion mapper changes (Slice A/C extension)

```ts
// generalize the current single-branch dispatch
function promotableEvent(event: WorldEvent): RoomStateChangedEvent | ItemDiscoveredEvent | null {
  if (event.type === 'room-state-changed') return durableRoomStateEvent(event)
  if (event.type === 'item-discovered') return event
  return null
}
```

- `importanceFor`: add `case 'item-discovered': return 3`.
- Text: generic fallback `"You discovered something here."` (id-free, mirrors
  `ROOM_STATE_MEMORY_TEXT`); named variant
  `` `You found the ${itemName} in the ${roomName}.` `` when the resolver knows
  **both** `item` and `room` — if only one resolves, fall back to the generic text
  (never a half-named sentence with one raw id showing through).
- `entitySnapshots`: `{ room: {...}, item: {...} }` when both resolve — reuses the
  existing bounded `EntitySnapshotsSchema`, no schema change.
- `roomId` for scoping comes from `event.payload.roomId` (same convention as
  `room-state-changed`); `dedupeKey`/`importance` flow onto `input` exactly as
  Slice C3 already does (no change to that mechanism).

## 5. Test plan (Vitest, co-located, deterministic)

- **`domain/world/events.ts`** (new cases in existing/new test coverage): valid
  `item-discovered` event/command parse; missing `roomId`/`itemId` rejected;
  `.strict()` rejects extra payload keys; existing 7 event types are byte-identical
  (regression guard that the union enlargement changed nothing about them).
- **`applyEvent.test.ts`**: `item-discovered` bumps `revision`/`updatedAt` and
  changes nothing else in `WorldState` (deep-equal the rest); applying it when
  `state === null` still throws the existing "first event must be session-started"
  error (no special-case bypass).
- **`WorldSession.test.ts`**: `appendEvent` accepts a valid `item-discovered`
  command and rejects one whose `roomId` does not match `state.currentRoomId`
  (`invalid-command`) — proves the new guard.
- **`planInteraction.test.ts`**: update the existing take-item exact-array
  assertion to the new 3-command order; add a case proving the emitted
  `item-discovered.roomId` always equals `state.currentRoomId`, and that repeating
  the same `ref` after resolution short-circuits to `already-resolved` (no event
  triple emitted twice) — reusing the existing idempotency guard.
- **`InteractionService.test.ts`**: end-to-end take-item still commits successfully
  through `applyCommands` with the extra event; a partial-failure case (second or
  third command rejected) still maps to `partial` per the existing
  `applyCommands` contract — no new failure path invented.
- **`promotion.test.ts`**: `item-discovered` promotes at importance 3; generic
  fallback text when no resolver / only one of room-or-item resolves; named text +
  two-entry `entitySnapshots` when both resolve; text stays ≤280 chars and free of
  raw ids; dedupe key ties to `eventId` exactly like `room-state-changed`
  (reuses `promotionDedupeKey` unchanged — no new dedupe test needed beyond one
  smoke case).
- **Save/load regression** (`world-session/saveGame.test.ts` or
  `SqliteWorldStore.test.ts`): a log containing an `item-discovered` event
  round-trips through `saveSession`/`loadSession`/`restoreSession` and passes
  `hasValidIntegrity`; an **old-shaped** save (no `item-discovered` events, 7-type
  union only) still loads under the new schema unchanged (no-regression guard for
  the "old logs still parse" requirement).
- **Compatibility note test, not a fix**: no test can assert the reverse
  direction (new event + old binary) because that requires two different builds;
  the plan instead documents that failure mode as accepted/known (§1), matching
  existing project precedent.

## 6. `event_visibility` — recorded for later, not built now

If/when a future slice needs to gate which NPCs may recall a semantic event
(e.g. `PLAYER_PROMISED_NPC` witnessed only by NPCs present in the room), the
minimal V1 shape would be:

```sql
CREATE TABLE event_visibility (
  event_id    TEXT NOT NULL REFERENCES world_events(event_id),
  viewer_type TEXT NOT NULL,  -- 'npc' | 'player' | 'room' (closed enum)
  viewer_id   TEXT NOT NULL,
  PRIMARY KEY (event_id, viewer_type, viewer_id)
)
```

Non-unique beyond its own composite key; append-only (mirrors `world_events`); no
`UPDATE`/`DELETE` path. **Not created in this slice** — see §1/§7 for the
rationale and the approval question.

## 7. Decisions (locked by the maintainer)

1. **Naming**: `item-discovered` (kebab-case) — confirmed.
2. **`event_visibility` timing**: deferred entirely — not built in this slice; the
   §6 shape is recorded for whenever a real consumer exists.
3. **`isValidForState` guard**: add the `roomId === state.currentRoomId` check.
4. **Scope of "discoverable"**: `planTakeItem` only — encounter item rewards are
   not wired to emit `item-discovered`.

## 8. Minimum Safe Change Check

- **Reused:** the existing `room-state-changed`/`flags` mechanism for durable
  room/object change (no new event needed there); the existing `WorldCommand[]` →
  `applyCommands` sequencing (no new service code); `promotionDedupeKey` (generic,
  unchanged); `DisplayNameResolver`'s already-present `'item'` `EntityKind`; the
  already-bounded, already-generic `EntitySnapshotsSchema`; the
  `moved-to-room.fromRoomId` validity-guard precedent; `WORLD_SCHEMA_VERSION`
  staying `1` (same additive-schema reasoning as Slice C1, already shipped).
- **Minimum new code:** one new event/command variant + one reducer `case`
  (no-op beyond revision bump) + one `WorldSession` guard line + one new command
  in `planTakeItem` + one new branch in the promotion mapper. No new files except
  tests-in-existing-files; no new module.
- **Safety boundaries unchanged:** event log stays append-only and authoritative;
  no new `WorldState` field; no memory-schema change; no migration; memory firewall
  unchanged (promotion still consumes `WorldEvent`, still returns only a memory
  draft, still exports no event/command producer); logging rules unchanged (no raw
  item/room names, only ids/counts/codes as today).
- **Tests prove it:** §5.

## 9. Verification (from `apps/web`, once approved and implemented)

```bash
npm run test -- applyEvent        # reducer no-op + exhaustiveness
npm run test -- planInteraction   # updated take-item command order + guard
npm run test -- WorldSession      # isValidForState guard
npm run test -- promotion         # new promotable event branch
npm run test -- saveGame          # old/new log round-trip regression
npm run lint                      # firewall/boundary imports intact
npm run build                     # tsc exhaustiveness check + browser bundle
```

## 10. Files added / changed (proposed)

- **Edited:** `domain/world/events.ts`, `domain/world/applyEvent.ts`,
  `world-session/WorldSession.ts`, `domain/interactions/planInteraction.ts`,
  `domain/memory/promotion.ts`; co-located tests for each
  (`applyEvent.test.ts`, `planInteraction.test.ts`, `InteractionService.test.ts`,
  `promotion.test.ts`, and a `WorldSession.test.ts`/`saveGame.test.ts` addition).
- **Deliberately NOT changed:** `domain/world/worldState.ts` (no `WorldState`
  field), `domain/world/saveGame.ts` / `SaveGameSchema` (no version bump),
  `persistence/migrations/**` (no new migration), `domain/memory/{contracts,
  roomContracts,firewall,roomFirewall,recallMetadata,displayNames}.ts` (no memory
  schema change), `domain/encounters/**`, `dialogue/**`, `server/**`, `renderer/**`,
  `App.tsx`, `eslint.config.js`, `package.json`.

## 11. Implementation closeout

- `item-discovered` event and matching `WorldCommand` variant implemented in
  `domain/world/events.ts`.
- Event payload is `{ roomId, itemId }`, matching §3 exactly.
- The command shape follows the existing **flat** `WorldCommand` convention (fields
  directly on the command object, e.g. `{ schemaVersion, type: 'item-discovered',
  roomId, itemId }`), the same shape as `moved-to-room`/`item-added`/etc. — not a
  nested `payload` (the flat shape is `WorldCommand`'s existing convention; only
  `WorldEvent` wraps fields in `payload`).
- Reducer (`applyEvent.ts`): `item-discovered` is a no-op on `WorldState` beyond the
  shared `{ ...next, revision, updatedAt }` tail, exactly as planned in §3.
- `WorldSession.isValidForState` validates both that the command's `roomId` equals
  `state.currentRoomId` and that the referenced `itemId` is actually present in
  inventory (the itemId check was an addition beyond the original §2/§7 guard
  description, tightening the guard so a discovery can't be forged for an item the
  player doesn't hold).
- `planTakeItem` emits the three commands in the planned order:
  `item-added` → `item-discovered` → `room-state-changed`.
- `domain/memory/promotion.ts`: `item-discovered` promotes to a **room** memory at
  **importance 3**. Text is third-person (`'The player discovered something here.'`
  generic fallback; `'The player found the {item} in the {room}.'` named form) —
  the named form and `entitySnapshots` (`{ room, item }`) are only produced when
  **both** the room and item names resolve via `DisplayNameResolver`; if only one
  resolves, the generic id-free fallback is used (no half-named sentence, no
  snapshot), matching §4.
- `event_visibility` remains deferred — not built in this slice (§6/§7 unchanged).
- No migration, no `WORLD_SCHEMA_VERSION` bump, and no changes to
  `domain/encounters/**`, any UI/renderer, `server/**`, or `App.tsx`.

### Verification (from `apps/web`)

```
npm.cmd run test -- applyEvent        # 1 file, 6 passed
npm.cmd run test -- planInteraction   # 1 file, 11 passed
npm.cmd run test -- WorldSession      # 1 file, 8 passed
npm.cmd run test -- InteractionService # 1 file, 7 passed
npm.cmd run test -- promotion         # 1 file, 35 passed
npm.cmd run test -- saveGame          # 1 file, 8 passed
npm.cmd run test -- worldState        # 1 file, 5 passed
npm.cmd run lint                      # clean, no errors/warnings
npm.cmd run build                     # tsc -b + vite build succeeded
git diff --check                      # no whitespace/conflict-marker errors
                                       # (only benign LF→CRLF autocrlf notices)
```

All nine checks passed.

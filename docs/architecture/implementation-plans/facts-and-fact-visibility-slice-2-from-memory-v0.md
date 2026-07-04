# Implementation Plan — Slice 2: `deriveFactsFromMemory` (pure memory→fact classifier)

> Status: **IMPLEMENTED — Slice 1 and Slice 2 committed. Runtime wiring remains
> deferred/gated.** This is Slice 2 of `feature/facts-and-fact-visibility-v0`
> (parent plan:
> [facts-and-fact-visibility-v0](./facts-and-fact-visibility-v0.md)). Slice 1
> (pure `Fact`/`FactVisibility` contracts + `filterVisibleFacts`) is committed and
> unwired. Slice 2 adds a pure classifier that maps existing validated memory
> records into non-authoritative `Fact` records with conservative default
> visibility. Still **no runtime wiring, no persistence, no dialogue/prompt/App/UI
> change**.
>
> **Closeout note.** Implemented: Slice 1 (pure `Fact` contracts +
> `filterVisibleFacts`) and Slice 2 (pure `deriveFactsFromMemory` classifier).
> Deferred: Slice 3 runtime/dialogue/prompt wiring; persistence/store/migration;
> a world-derived projector/validator; relationship state; semantic dialogue
> events; structured dialogue effects. No runtime wiring, no provider/LLM calls,
> no UI, no persistence/schema changes, no authority path exist as of this
> closeout. `player_claim` defaults to `player-known` visibility. Facts remain
> supporting metadata, not world truth.

## 0. Locked decisions (maintainer-approved, this slice)

- **Q1 — Four-function split**, mirroring the existing `firewall.ts`/
  `roomFirewall.ts` parallel-not-unified precedent (no synthetic union type over
  the two structurally different memory record shapes):
  - `deriveFactFromNpcMemory(record: NpcMemoryRecord): Fact`
  - `deriveFactsFromNpcMemories(records: readonly NpcMemoryRecord[]): Fact[]`
  - `deriveFactFromRoomMemory(record: RoomMemoryRecord): Fact`
  - `deriveFactsFromRoomMemories(records: readonly RoomMemoryRecord[]): Fact[]`
- **Q2 — `room_note` maps to fact `kind: 'observed'`** (ambient/narrator room
  text present in the room), not `'summary'`.
- **Q3 — Defense-in-depth output validation, fail-closed.** The classifier
  validates its own output with `FactSchema.safeParse` before returning. If
  validation fails, it does **not** throw and does **not** return the invalid
  value — it degrades to a valid `hidden`/`unverified`/`low`-confidence fact
  (same shape as the unknown-kind fallback, §7). A mapper bug can only ever
  shrink visibility, never widen it or crash the caller.
- **Q4 — `rumor` is not produced in Slice 2.** No current memory `kind` (NPC or
  room) corresponds to a rumor; the mapping table never emits `kind: 'rumor'`.
  Intentional, not an oversight — deferred to a future memory-kind addition or
  provenance heuristic.
- **Q5 — `subjectRef`/`objectRef` stay `undefined`.** Slice 2 does not infer or
  backfill entity references from memory `text` or `entitySnapshots`. No new
  derived data beyond what the record structurally carries.

## 1. Function name and file location

New files only, mirroring the existing pure-domain + parallel-firewall style:

- `apps/web/src/domain/facts/fromMemory.ts`
- `apps/web/src/domain/facts/fromMemory.test.ts`

No existing file needs an edit: `domain/facts/` currently has only
`contracts.ts`/`visibility.ts` (+ tests) and no barrel/index file. No
`eslint.config.js` change — `domain/facts/**` already sits inside the existing
`domain/**` lint block, and this module only imports sibling `domain/memory` and
`domain/facts` contracts (an already-permitted `domain → domain` import per
`BOUNDARIES.md`).

## 2. Inputs and outputs

- Input: a single already-validated `NpcMemoryRecord` or `RoomMemoryRecord` (or a
  readonly array of one, via the plural wrapper).
- Output: a single `Fact` (or `Fact[]`, same order, 1:1 — every input record
  produces exactly one output fact; the fail-closed cases (§7, §3 Q3) still
  produce a `hidden` fact rather than dropping the record silently).
- Pure, total, deterministic: no `Date.now`, no `Math.random`, no I/O, no
  mutation of the input record.
- Output is passed through `FactSchema.safeParse` before returning (Q3); on
  failure, the function substitutes the fail-closed fallback fact instead of the
  invalid value.

## 3. Mapping table

**NPC memory → Fact** (`fact.provenance.npcId` always set to `record.npcId`;
`fact.provenance.roomId`/`turnIndex` copied from `record.provenance` when
present):

| Memory `kind` | Fact `kind` | `authority` | `visibility` (default) | `confidence` |
| --- | --- | --- | --- | --- |
| `player_claim` | `player-claim` | `unverified` | `{ scope: 'player-known' }` **always**, regardless of `npcId` | passthrough |
| `npc_belief` | `npc-belief` | `unverified` | `{ scope: 'npc-known', npcIds: [record.npcId] }` | passthrough |
| `npc_observation` | `observed` | `unverified` | `{ scope: 'npc-known', npcIds: [record.npcId] }` | passthrough |
| `dialogue_summary` | `summary` | `unverified` | `{ scope: 'npc-known', npcIds: [record.npcId] }` | passthrough |

**Room memory → Fact** (`fact.provenance.roomId` always set to `record.roomId`;
`fact.provenance.npcId`/`turnIndex` copied from `record.provenance` when
present):

| Memory `kind` | Fact `kind` | `authority` | `visibility` (default) | `confidence` |
| --- | --- | --- | --- | --- |
| `player_claim` | `player-claim` | `unverified` | `{ scope: 'player-known' }` **always**, regardless of `roomId` | passthrough |
| `room_observation` | `observed` | `unverified` | `{ scope: 'room-known', roomId: record.roomId }` | passthrough |
| `room_note` | `observed` (Q2) | `unverified` | `{ scope: 'room-known', roomId: record.roomId }` | passthrough |
| `room_summary` | `summary` | `unverified` | `{ scope: 'room-known', roomId: record.roomId }` | passthrough |

Common to both:

- `source`: direct passthrough of `record.provenance.source`
  (`player|npc|game|llm` — identical enum on both memory types and on `Fact`).
- `authority`: **always `unverified`** in Slice 2 — no exceptions, no
  per-source logic (locked by parent-plan Q5: no validator/projector exists yet,
  so nothing can earn `world-derived`).
- `confidence`: direct passthrough of `record.confidence` (identical enum),
  except in the fail-closed path (§7, §3 Q3), where it is forced to `'low'`.
- `subjectRef` / `objectRef`: `undefined` (Q5) — not inferred from `text` or
  `entitySnapshots`.
- `text`: copied verbatim (§8, unchanged from design review — `MAX_MEMORY_CHARS`
  / `MAX_ROOM_MEMORY_CHARS` / `MAX_FACT_TEXT_CHARS` are all `280`, no truncation
  surprise; memory text already carries the same inertness guarantee as fact
  text).
- `factId`: derived deterministically from the record (§9).

## 4. NPC memory vs room memory differences

- **Scope field differs**: `npcId` vs `roomId` — changes which
  `visibility.scope` variant is targeted (`npc-known` vs `room-known`) and which
  id populates it.
- **Provenance is mirrored, not identical**: NPC records optionally carry
  `provenance.roomId` (where the memory formed); room records optionally carry
  `provenance.npcId` (who formed it). Both carry optional `turnIndex`. The
  classifier copies whichever optional field is present, and always fills in the
  record's own scope id (`npcId` for NPC memory, `roomId` for room memory),
  which is never missing.
- **Kind vocabularies differ** entirely except for the shared `player_claim`
  kind, handled identically and restrictively in both (§5).
- Per Q1, no shared code path is forced between the two beyond identical
  `player_claim`/`llm`/unknown-kind/invalid-output handling — kept as two
  parallel function pairs.

## 5. Player claims

`player_claim` **always** maps to `kind: 'player-claim'`, `authority:
'unverified'`, `visibility: { scope: 'player-known' }` — **regardless of which
`npcId`/`roomId` the record happens to be scoped under**. This is the
load-bearing invariant for the whole feature (parent plan §0 Q3). The classifier
must check `kind === 'player_claim'` **before** falling into the generic
"scope id → visibility target" branch, so a future refactor cannot accidentally
wire a room-scoped or NPC-scoped player claim into `room-known`/`npc-known`
visibility. This gets its own named test (§13), not just the general mapping
table.

## 6. `source: 'llm'` handling

No special-cased branch is needed because `authority` is unconditionally
`'unverified'` for every record in Slice 2 regardless of `kind`/`source` (§3).
Locked with an explicit regression test (§13): a record with `source: 'llm'` on
every memory `kind` still yields `fact.authority === 'unverified'` — guarding
against a future maintainer giving `game`-sourced records `world-derived` and
forgetting `llm` must never follow.

## 7. Unknown / ambiguous memory kinds, and invalid mapper output (Q3)

Unknown future memory kinds currently fail closed to hidden/unverified/low.
Compile-time exhaustive checking may be added later, but v0 prioritizes
runtime fail-closed behavior.

At runtime, two distinct fail-closed paths converge on the same fallback shape:

1. **Unknown `kind`** (e.g. an unvalidated caller bypasses the type system with
   an out-of-enum string).
2. **Invalid mapper output** (Q3): the classifier's own `FactSchema.safeParse`
   check on the constructed fact fails (defense-in-depth against a bug in the
   mapping logic itself).

In both cases the function does **not** throw and does **not** return the
original/invalid value. It returns:

```
{ kind: 'hidden', visibility: { scope: 'hidden' }, authority: 'unverified', confidence: 'low' }
```

with `worldId`/`sessionId`/`source`/`text`/`provenance`/`factId` still populated
normally from the record (those fields are structurally independent of `kind`
and already trusted). This fact is real (not `null`/dropped) but is guaranteed
excluded by `filterVisibleFacts` for every viewer, present and future — matching
"hidden — never enters any dialogue context, for any viewer." The fallback
fact is itself constructed to satisfy `FactSchema` by inspection, so the
fail-closed path cannot itself recurse into failure.

## 8. Fact `text`: copied verbatim

Copied as-is from `record.text`. `MAX_MEMORY_CHARS` / `MAX_ROOM_MEMORY_CHARS`
are both `280`, identical to `MAX_FACT_TEXT_CHARS` — no truncation surprise.
Memory `text` is already inert (never parsed/`eval`'d/logged); `Fact.text` has
the identical contract. No re-encoding, no re-single-lining performed by this
classifier (room memory text is already normalized to one line at write time by
`normalizeRoomMemoryTextForWrite`; NPC memory text has no equivalent
normalization pass today — unchanged by this slice, since Slice 2 does not touch
memory writing).

## 9. Deterministic `factId` derivation

No hashing library, no new dependency. Prefix the already-unique `memoryId`
with a fixed, source-disambiguating literal:

```
npc memory:  `npc-memory:${record.memoryId}`
room memory: `room-memory:${record.memoryId}`
```

Deterministic (same record → same `factId`), pure (no `Math.random`/
`Date.now`), and collision-safe across the two independent memory id spaces even
if an NPC memory and a room memory happen to share a bare `memoryId` value.

## 10. Safety/authority analysis

- **No new path to `WorldState`.** The module imports only
  `domain/facts/contracts` and `domain/memory/contracts`/`roomContracts` (types
  only) — no `world-session`, no `WorldCommand`/`WorldEvent`.
- **`authority` cannot be earned in this slice.** Every output fact is
  `unverified`; no branch produces `world-derived` (deferred, parent-plan Q5).
- **The player-claim invariant (§5) is the load-bearing safety property** —
  covered by a dedicated test, not just the general mapping table.
- **Fail-closed on unknown/invalid output (§7, Q3)** extends the "never widen on
  doubt" discipline from Slice 1's visibility filter into the classifier itself:
  a bug in the mapper degrades to `hidden`, never to a wider-than-intended
  visibility, and never throws.
- **Still fully unwired.** Nothing calls this function from `App`, dialogue, or
  any composition root in this slice — proven by tests only; Slice 3 (runtime
  wiring) remains separate and gated.
- **No logging.** The function returns data only; it never calls the logger, so
  `text`/npc/room names/ids are never logged incidentally by this module.

## 11. Files likely to change

New only:

- `apps/web/src/domain/facts/fromMemory.ts`
- `apps/web/src/domain/facts/fromMemory.test.ts`

## 12. Files that must NOT change

Same list as Slice 1 (parent plan §11), unchanged and still binding:
`domain/memory/**` (contracts, firewall, roomFirewall, ranking, ftsQuery),
`memory/**` services/stores, `domain/dialogue/**`,
`generation/llmDialoguePrompt.ts`, `app/recallRoomMemoryContext.ts`, `App.tsx`,
`RoomViewer.tsx`, dialogue providers/services, `persistence/**`,
`migrations/**`, `server/**`, renderer/engine,
`WorldState`/`WorldEvent`/`SaveGame`/`RoomSpec`/`QuestSpec`,
`eslint.config.js`, `package.json`, `evaluation/`/`redteam/` suites. Also:
`domain/facts/contracts.ts` and `domain/facts/visibility.ts` — Slice 2 only
produces `Fact` values that already satisfy the existing schema; it adds no new
`Fact` fields.

## 13. Tests to add

All in `fromMemory.test.ts`, deterministic, no I/O:

1. **Golden mapping table** — one case per NPC memory kind (`player_claim`,
   `npc_belief`, `npc_observation`, `dialogue_summary`) and per room memory kind
   (`player_claim`, `room_observation`, `room_note`, `room_summary`): assert
   exact `kind`/`authority`/`visibility`/`confidence`/`source`/`provenance`/
   `factId`. `room_note` asserted to map to `kind: 'observed'` (Q2).
2. **Player-claim invariant** — NPC-scoped and room-scoped `player_claim`
   records, with varied `npcId`/`roomId`, both yield
   `visibility: { scope: 'player-known' }`.
3. **`llm` source invariant** — every kind with `source: 'llm'` still yields
   `authority: 'unverified'`.
4. **Unknown-kind fail-closed** — a record with an out-of-enum `kind` (via an
   unsafe cast bypassing TS) yields
   `{ kind: 'hidden', visibility: { scope: 'hidden' }, confidence: 'low' }` and
   does not throw.
5. **Invalid-output fail-closed (Q3)** — simulate/force a `FactSchema.safeParse`
   failure on the constructed fact (e.g. via a deliberately malformed
   intermediate value in a white-box test) and assert the function still
   returns the same valid `hidden`/`unverified`/`low` fallback shape rather than
   throwing or returning the invalid object.
6. **`rumor` is never produced (Q4)** — running the classifier over one record
   of every defined NPC and room memory `kind` never yields
   `fact.kind === 'rumor'`.
7. **`subjectRef`/`objectRef` stay undefined (Q5)** — even when `text` contains
   entity-like tokens or the record carries `entitySnapshots`, both fields are
   `undefined` on the output fact.
8. **`factId` determinism** — same record called twice → identical `factId`;
   NPC vs room record sharing a bare `memoryId` → different `factId`s (prefix
   disambiguation); two distinct `memoryId`s never collide.
9. **Purity / no mutation** — input record is deep-equal before/after the call.
10. **Schema validity round-trip** — every produced `Fact` (including fallback
    facts) passes `FactSchema.safeParse(fact).success === true`.
11. **Text passthrough** — `fact.text === record.text` verbatim, including a
    boundary case at 280 chars.
12. **Confidence passthrough** — `low`/`medium`/`high` all pass through
    unchanged (except forced `low` in the fail-closed paths).
13. **Array wrapper** — `deriveFactsFromNpcMemories`/`RoomMemories` map 1:1,
    preserve order, empty array → empty array.

## 14. Verification commands (from `apps/web`)

```bash
npm run test -- facts     # new fromMemory classifier + existing contracts/visibility suites
npm run test -- memory    # regression: memory contracts/firewall/roomFirewall unchanged
npm run lint               # domain boundary/no-console walls (no new rule expected)
npm run build               # typecheck + browser bundle unchanged (SQLite-free)
```

`npm run test -- dialogue` is optional extra regression (still unwired, no
dialogue-path change).

## 15. Remaining open questions

None blocking — Q1–Q5 above are resolved and lock Slice 2's shaping decisions.
Any further questions (e.g. whether a future memory `kind` should feed `rumor`,
or whether `entitySnapshots` should ever map to `subjectRef`/`objectRef`) are
deferred to a later slice and do not block this one.

## Minimum Safe Change Check

- **Reused:** `Fact`/`FactVisibility` contracts and `FactSchema` from Slice 1,
  memory `source`/`confidence` enum vocabulary, the parallel
  NPC/room-file-pair pattern from `domain/memory/firewall.ts` /
  `roomFirewall.ts`, the fail-closed/restrictive-on-doubt discipline from Slice
  1's `filterVisibleFacts`. No new dependency, no new lint rule, no edit to any
  existing file.
- **New code actually necessary:** `fromMemory.ts` (four functions) + tests.
  That is all for Slice 2.
- **Safety boundaries unchanged:** world authority (event log sole truth),
  memory firewall (no truth path), no `world-derived` authority ever produced,
  player-claim visibility invariant enforced structurally, fail-closed on
  unknown/invalid input, no logging, no persistence, no wiring.
- **Tests that prove it:** §13 golden mapping table, player-claim invariant,
  llm-source invariant, unknown-kind and invalid-output fail-closed paths,
  rumor-never-produced, subjectRef/objectRef-never-inferred, determinism/purity,
  schema round-trip.

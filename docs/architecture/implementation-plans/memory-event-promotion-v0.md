# Implementation Plan — `feature/memory-event-promotion-v0`

> Status: **Direction APPROVED (2026-06-30); pre-coding nits incorporated below.
> Ready to implement.**
>
> **This is a pre-demo Slice A. It proves the pure promotion seam ONLY — it does NOT
> replace the locked six-slice memory demo (design doc §28), which remains the end
> target.** Slice A is an upstream, reconciled foundation step the six-slice demo
> builds on; it is not a substitute for any of those slices.
>
> This is **Slice A** of the reconciled adoption of the external *Memory & DB Design
> v1* doc. The reconciliation/evaluation is recorded separately (the design doc maps
> onto existing structures; see "What already exists" there). Slice A is the first
> **parallel-safe, headless, pure-domain** seam: it touches **no** event union, **no**
> schema, and **no** authoritative state, so it can land alongside the in-flight
> generated-quest / save-load work without collision.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md). Roadmap
> context: `world-state-event-log-v0` ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)),
> `npc-memory-persistence-v0` ([ADR-0024](../decisions/ADR-0024-npc-memory-persistence-v0.md)),
> `living-world-room-memory-v0` ([ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md)).
> Bundles and preserves the **memory-firewall** invariants.

## Goal

Add a **pure, deterministic memory-promotion mapper**: given a committed
`WorldEvent` and a small neutral promotion context, decide whether it deserves a
long-term memory and, if so, produce a **ready-to-`remember` draft** plus an
importance score and a deterministic dedupe key — or return `null` (ignore).

The mapper is the "should this be remembered, and as what?" discipline from the
design doc (§5, §14, §15, §17), expressed as one pure function over the **existing**
`WorldEvent` union, emitting the **existing** `RoomMemoryDraftInput` shape the shipped
`RoomMemoryService` already consumes.

The defining property is unchanged from the memory firewall: **the mapper only reads
event types and produces memory drafts — it never produces a `WorldEvent`/
`WorldCommand` and has no write path to truth.** Promotion is the safe direction
(committed truth → supporting memory), never the reverse.

## 1. Current relevant flow

- **Truth / event log** (`domain/world/`, `world-session/`). `CanonSeed` →
  `session-started` (seq 1) → append-only `WorldEvent[]` is authoritative;
  `WorldState = projectWorldState(log)` is a projection cache. The closed union today
  is **7 types**: `session-started`, `moved-to-room`, `item-added`, `item-removed`,
  `health-changed`, `status-changed`, `room-state-changed` (`domain/world/events.ts`).
  Every event carries an envelope: `eventId` (UUID), `sessionId` (UUID), `seq`,
  `occurredAt`, `type`, `payload`.
- **Memory (headless, unwired)** (`domain/memory/`, `src/memory/`). `NpcMemoryService`
  / `RoomMemoryService` expose `remember(input)` / `recall(scope)`. `remember` takes
  the firewall input type — for rooms `RoomMemoryDraftInput` (`{ worldId, sessionId,
  roomId, kind, source, text, confidence?, npcId?, turnIndex? }`) — runs
  `validateRoomMemoryDraft`, stamps `memoryId`/`createdAt`, and the store assigns
  `seq`. **There is no producer of these drafts yet** — every caller in the repo is a
  test. Slice A adds the first principled producer, still **without wiring it to live
  gameplay**.

Nothing about the live browser flow, the event union, the stores, or the services
changes in this slice.

## 2. Why this is the right first slice (and what it defers)

Slice A is parallel-safe **because** it consumes the existing union read-only and
adds no schema. That same constraint bounds what it can express today:

- **Thin event coverage is intentional.** Over the current mechanical union, only
  **durable room-state (flag) changes** carry promotable meaning (see §4). The design
  doc's rich semantic events (`PLAYER_PROMISED_NPC`, `NPC_KILLED`, `SECRET_REVEALED`,
  …) require **new event types**, which land on the **coordinated/gated** surface in a
  later slice (Slice D). Slice A proves the *promotion seam and discipline* first —
  exactly the project's "pure seam first" cadence (event-log pure → SQLite; firewall
  pure → service → SQLite).
- **Name-free text now; display names later.** Without a `DisplayNameResolver`
  (Slice C), drafts use **generic, id-free templates** ("This area changed." rather
  than "The Old Library changed."). Putting raw system ids in memory text is
  explicitly disallowed by the design doc; readable named text + `entity_snapshots`
  is a Slice C concern (and a schema bump).
- **Idempotency dedupe now; semantic anti-spam later.** Slice A delivers a
  deterministic per-event idempotency key + a pure `dedupePromotions` filter (full
  within a batch). Semantic anti-spam (collapsing different events into one memory)
  needs persisted seen-keys = a schema column, deferred to Slice C/D (see §4).

## 3. Scope (locked for this slice)

In:

- `domain/memory/promotion.ts` — pure mapper + importance + dedupe key + batch dedupe.
- Co-located `domain/memory/promotion.test.ts`.

Out (explicit non-goals):

- **No** new `WorldEvent`/`WorldCommand` type; **no** change to `domain/world/**`,
  `applyEvent`, `world-session/**`, `CanonSeed`, or save/load.
- **No** schema/migration change; **no** new column; **no** `schemaVersion` bump on
  `npc_memories` / `room_memories`.
- **No** wiring: nothing calls the mapper in `App.tsx`, `RoomViewer`, `dialogue/`,
  `server/**`, or any bootstrap. **No** browser change.
- **No** `DisplayNameResolver`, **no** persisted importance/dedupe, **no** relevance
  ranking (that is Slice B), **no** FTS/vector, **no** relationships/visibility.
- **No** new dependency.

## 4. The mapper

`promoteWorldEvent(event: WorldEvent, ctx: PromotionContext): PromotedMemory | null`

```ts
// neutral, injected by the future orchestrator; no WorldSession/WorldStore here
export type PromotionContext = {
  worldId: string          // events carry sessionId, not worldId; the caller supplies it
  minImportance?: number   // promote only if importance >= this (default 3)
}

// v0 promotes ROOM memories only. `target` is kept as a labelled field so a future
// 'npc' arm (Slice D, when npc-scoped events exist) is purely additive.
export type PromotedMemory = {
  target: 'room'
  input: RoomMemoryDraftInput
  importance: number
  dedupeKey: string
}
```

- `sessionId` comes from `event.sessionId`; `worldId` from `ctx`; **`roomId` from the
  event payload** (`room-state-changed.payload.roomId`) — not from context — so the
  memory is scoped to the room the event is actually about.
- `source` is always **`'game'`** (deterministic game-rule origin — the exact meaning
  that enum member was defined for).
- **`confidence` is a backend-assigned constant `'medium'` (nit 3)** — informational
  only in v0. It is set by this mapper's code; it is **never** read from or proposed
  by an LLM. When LLM-proposed events later feed promotion (Slice D), confidence stays
  backend-assigned here, consistent with the design doc (§10.2, §13.4: the LLM does
  not propose trusted confidence).
- The returned `input` is **exactly** the existing `RoomMemoryDraftInput`, so the
  future orchestrator just calls `roomMemory.remember(input)` with no adapter.

Event → promotion table (current union):

| `WorldEvent.type` | Decision | Target / kind | Importance |
| --- | --- | --- | --- |
| `room-state-changed` with **non-empty `flags`** (durable) | **promote** | room / `room_observation` | 3 |
| `room-state-changed` with only `visited` (or visit-count) | **ignore** (transient) | — | 0–1 |
| `item-added` | **ignore** (v0) | — | 1 |
| `item-removed` | ignore | — | 1 |
| `moved-to-room` | ignore (normal movement) | — | 0–1 |
| `health-changed` · `status-changed` | ignore (mechanical) | — | 1 |
| `session-started` | ignore | — | 0 |

- **Durable-only room state (nit 1).** Only a `room-state-changed` event carrying a
  **non-empty `flags`** map promotes (a durable consequence — opened/broken/burned).
  A bare `visited` toggle or any visit-count-style change is transient presence and is
  **never** promoted. (`visited` together with non-empty `flags` still promotes, on
  the strength of `flags`.)
- **`item-added` is ignored in v0 (nit 2).** The mechanical `item-added` event does
  not reliably mean "acquired *here*" — it can be a system grant, a load, or a
  non-spatial change. Rather than fabricate an "acquired here" claim, v0 ignores it;
  the right home is a richer, intent-bearing event (e.g. `ITEM_DISCOVERED` with a
  source room/object) in Slice D, or an explicit room-local player-action context if
  one is later wired. The mapper does **not** invent provenance it cannot trust.
- Promotion requires `importance >= ctx.minImportance` (default 3) **and** the
  required scope id present (the room target needs `payload.roomId`); otherwise `null`.
- Text comes from a **closed, hand-written template table** keyed on event type — no
  ids, no names, no raw payload strings, ≤ `MAX_ROOM_MEMORY_CHARS` (280). The mapper
  reads only safe payload booleans/enums/counts, never narrative strings.

Helpers (pure):

- `importanceFor(event): number` — fixed table above.
- `promotionDedupeKey(event, ctx): string` — an **idempotency key tied to the source
  event's identity (nit 4)**: `worldId|sessionId|type|<event.eventId>` (every
  committed `WorldEvent` carries a unique `eventId`; `event.seq` is an equally stable
  fallback). Tying the key to event identity guarantees the *same committed event* is
  never promoted twice (replay/double-run safe) and never wrongly **collapses two
  distinct** durable changes in the same room.
- `dedupePromotions(items, seenKeys): { kept: PromotedMemory[]; keys: string[] }` —
  drops items whose key is already in `seenKeys` or repeated within the batch.
- **Deferred — semantic anti-spam dedupe.** Collapsing *different* events that would
  yield the *same* memory (design doc §17, "5 inspects → 1 memory") needs persisted
  seen-keys/history (a `dedupe_key` column) and is **not** in this slice. Slice A's
  key is the per-event idempotency key only.

## 5. Boundaries / lint

- The file lives under `domain/memory/**`, governed by the existing `src/domain/**`
  ESLint block. It imports only **types** from `domain/world/events` and
  `domain/memory/{firewall,roomFirewall}` — all intra-domain.
- **Firewall preserved (verified).** The structural rule is "`domain/memory` exports
  no `WorldCommand`/`WorldEvent`-producing function." This mapper *consumes*
  `WorldEvent` as input and returns only a memory draft, so it upholds the rule.
  `apps/web/eslint.config.js` was checked: the `src/domain/**` block forbids
  React/Three/renderer/platform/persistence/server imports but places **no
  restriction on intra-domain imports**, so `domain/memory` importing `domain/world`
  *types* is allowed (`domain/world/events.ts` itself imports `domain/world/
  worldState`). A test asserts the mapper returns no event/command object (see §7).
- No engine objects, no logger (pure domain returns data; callers log later).

## 6. Failure / degrade behavior

| Situation | Handling |
| --- | --- |
| Event type not promotable | return `null` (ignore) — never throws |
| `room-state-changed` with no durable `flags` | return `null` |
| Required scope id missing (e.g. empty `payload.roomId`) | return `null` |
| Importance below threshold | return `null` |
| Duplicate within batch / already seen | filtered by `dedupePromotions` |

The mapper is total and side-effect-free: any unexpected/unknown shape degrades to
`null`. Memory never blocks play and never alters truth — unchanged.

## 7. Test plan (Vitest, co-located, deterministic)

- **Promote vs ignore** for each of the 7 event types per the §4 table — including:
  `room-state-changed` with non-empty `flags` → **promote**; with only `visited` →
  **ignore**; `item-added` → **ignore**.
- **Scope routing**: the promoted room draft's `roomId` comes from `payload.roomId`;
  `sessionId` from the event; `worldId` from `ctx`.
- **`source` is `'game'`; `confidence` is the backend constant `'medium'`** (assert it
  is set by the mapper regardless of input — there is no LLM-proposed-confidence
  path). Text is within 280 and **contains no ids/payload strings** (assert it does
  not contain the event's `roomId` or flag keys).
- **Importance threshold**: the `minImportance` gate promotes/blocks as expected.
- **Dedupe (idempotency)**: the *same* event → identical key (collapses on re-run /
  within a batch / via `seenKeys`); **two distinct** `room-state-changed` events for
  the same room (different `eventId`) → **two distinct keys → both kept** (no wrongful
  collapse).
- **Purity**: no input mutation; same input → same output.
- **Structural firewall**: assert `promoteWorldEvent` never returns an object that
  parses as `WorldEventSchema`/`WorldCommandSchema` (it returns a memory draft only),
  and that the module exports no event/command-producing function.
- **Output feeds `remember` unchanged**: pass a promoted `input` straight into
  `validateRoomMemoryDraft` and assert `ok: true` (proves the shape lines up with the
  shipped `RoomMemoryService`).

## 8. Minimum Safe Change Check

- **Reused:** `WorldEvent`/`WorldEventSchema` + the envelope `eventId`/`seq`/
  `sessionId` (`domain/world/events.ts`); `RoomMemoryDraftInput` +
  `validateRoomMemoryDraft` (`domain/memory/roomFirewall.ts`) — the emitted shape; the
  `'game'` source + `room_observation` kind + 280-char bound already shipped; the
  `RoomMemoryService.remember` path consumes the output as-is. (The NPC firewall
  `MemoryDraftInput`/`validateMemoryDraft` is referenced only by the structural test
  and the future `npc` arm.)
- **Minimum new code:** one pure module (`domain/memory/promotion.ts`) + its test.
- **Safety boundaries unchanged:** event union, `applyEvent`, world-session authority,
  all schemas/migrations, the memory firewall, logging rules, and the browser bundle.
  No authoritative state can change; no schema impact; no logging surface added (pure
  domain returns data, logs nothing).
- **Tests prove it:** §7.

## 9. Verification (from `apps/web`)

```bash
npm run test -- promotion     # the new pure mapper spec
npm run test -- memory        # confirm existing memory suites still pass
npm run lint                  # confirms no firewall/boundary import was added
npm run build                 # confirms browser bundle unaffected
```

Report results honestly; do not claim a check passed unless it was run. The
maintainer commits manually (agents do not commit).

## 10. Files added / changed

- **New:** `apps/web/src/domain/memory/promotion.ts`,
  `apps/web/src/domain/memory/promotion.test.ts`.
- **Deliberately NOT changed:** `domain/world/**`, `world-session/**`,
  `domain/memory/{contracts,firewall,roomContracts,roomFirewall}.ts`,
  `src/memory/**`, `persistence/**` (no migration, no schema bump), `server/**`,
  `renderer/**`, `App.tsx`, `RoomViewer.tsx`, `eslint.config.js`, `package.json`.

## 11. Follow-on slices (context only — not part of this approval)

- **Slice B (parallel-safe):** ContextBuilder v0 = existing recall + an **additive**
  pure relevance ranker (do not weaken `selectRecallMemories`).
- **Slice C (gated):** `DisplayNameResolver` + named text + `entity_snapshots` +
  persisted importance/dedupe (incl. semantic anti-spam) → memory `schemaVersion` v2
  (approval + migration).
- **Slice D (gated, coordinate with save/load):** richer authoritative `WorldEvent`
  types + `event_visibility`; the mapper's §4 table expands (incl. the `npc` arm).
- **Slice E (gated):** `npc_relationships` as event-sourced state + reducer caps.
- **Deferred:** FTS5 → `facts`/`fact_visibility`/rumor model → optional Chroma.

> These six-slice-aligned follow-ons are the path toward the design doc's locked
> memory demo (§28); Slice A does not implement or replace any of them.

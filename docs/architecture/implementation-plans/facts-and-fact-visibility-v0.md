# Implementation Plan — `feature/facts-and-fact-visibility-v0`

> Status: **APPROVED for docs-only save. Not implemented.** No source/test files
> changed, no commit. Slice 1 is a **pure domain fact + visibility layer** (types
> + one pure filter), headless and unwired.
>
> Scope intent: give the future dialogue/memory-retrieval wiring a principled,
> mandatory *who-may-know-this* gate. Mirrors the established v0 pattern (like
> `domain/memory/ranking.ts`): pure, deterministic, tested, and deliberately
> **not** wired into `App`/dialogue/renderer/persistence.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md). Roadmap context:
> [ADR-0024 npc-memory-persistence-v0](../decisions/ADR-0024-npc-memory-persistence-v0.md),
> [ADR-0025 living-world-room-memory-v0](../decisions/ADR-0025-living-world-room-memory-v0.md),
> [ADR-0074 long-session-memory-evaluation-v0](../decisions/ADR-0074-long-session-memory-evaluation-v0.md),
> [sqlite-fts-memory-retrieval-v0](./sqlite-fts-memory-retrieval-v0.md),
> [sqlite-fts-memory-retrieval-slice-3a-evaluation-v0](./sqlite-fts-memory-retrieval-slice-3a-evaluation-v0.md).

## 0. Locked decisions (maintainer-approved)

- **Q1 — Separate `domain/facts/` layer** (do not extend or modify memory contracts).
- **Q2 — No persistence / store / migration in v0** (facts are a pure projection).
- **Q3 — `player-claim` defaults to `player-known` visibility** (never leaks to an NPC
  on its own).
- **Q4 — Slice 1 is filter-only** (no memory→fact classifier yet).
- **Q5 — Include the `authority` field now** (`unverified | world-derived`), but build
  **no** validator/projector yet.
- **Q6 — `npc`-only viewer in v0** (a `player` viewer is deferred).
- **Q7 — Fact `text` is optional and inert** (bounded, never logged, never parsed,
  never `eval`'d; single-lining stays at the prompt boundary).
- **Fail-closed clarification (§15):** future fact-visibility wiring must **fail
  closed** — if fact filtering fails, the fact-derived context is **empty**, never
  bypassed. Existing memory behavior is unchanged until wiring; once facts are wired,
  a visibility failure must **never** expand what an NPC sees.

## 1. Feature goal

Introduce a small, pure, deterministic **fact model** and a **visibility filter** so
that any content destined for an NPC prompt must first pass an explicit
*who-may-know-this* gate. In v0 this is domain types + a filter function + tests only —
no runtime wiring, no persistence, no provider change. It gives the later
dialogue/retrieval slice a mandatory chokepoint that structurally prevents
hidden/secret/other-scope content from reaching a model.

## 2. Problem being solved

The current memory→dialogue path has an **epistemic taxonomy** (memory
`kind`/`source`/`confidence`) and a **scope-triple** firewall, plus a hedged,
single-lined `BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE` prompt section. But it has
**no explicit visibility dimension**. Concretely:

- **Room memory is recalled per room, not per NPC.** `recallRoomMemoryContext(scope, …)`
  recalls everything scoped to `(worldId, sessionId, roomId)` and every NPC in that
  room sees the same set. There is no "only NPC X knows this" concept →
  *NPCs can know facts they should not know*.
- **No "hidden/secret" marker exists.** Any record scoped to a room can flow into that
  room's dialogue. There is no way to persist/derive a fact that must **never** enter a
  prompt → *hidden/secret room info can leak*.
- **Player claims are only hedged by text prefix, not gated.** A `player_claim` is
  prefixed "Someone claimed …" but is still eligible to enter an NPC's context. There
  is no rule that a player's private claim stays **player-known** and does not become
  something an NPC "knows" → *player claims drift toward world truth in the model's
  eyes*.
- **Retrieval (FTS) has no visibility gate downstream.** `recallRelevant` proposes
  candidate records by keyword. If/when it is wired, nothing today forces those
  candidates through a visibility check before the prompt → *retrieved memory can
  bypass authority/visibility rules*.

World truth itself is already safe (`WorldState` is event-sourced; memory has no path
to it). This feature does **not** touch that; it adds the missing *visibility* and
*authority-labelling* primitives around it.

## 3. Current relevant memory / dialogue / world-state flow

- **World truth (authoritative):** `WorldState` = event-log projection —
  `player.health/status`, `inventory`, `roomStates[roomId].{visited, flags}`,
  `revision`. Mutated only by appending a validated `WorldEvent`.
  (`domain/world/worldState.ts`.)
- **Memory (supporting context, no truth path):** `NpcMemoryRecord` /
  `RoomMemoryRecord` — inert `text` (≤280) + closed enums `kind` / `source`
  (`player|npc|game|llm`) / `confidence`, scoped by the exact triple. Write firewall
  `validate*MemoryDraft`; read firewall `filter*MemoriesForScope` + bounded
  `selectRecall*Memories` (`seq` desc, `memoryId` asc). (`domain/memory/**`, `memory/**`.)
- **Dialogue context (pure projection):** `buildDialogueContext(state, npc, history,
  room?, quest?, memory?)` → `NPCDialogueContext` (authoritative player facts + room
  features + quest + `memory.entries {text, kind}`).
  (`domain/dialogue/buildDialogueContext.ts`.)
- **Recall bridge (wired, browser):** `App` → `recallRoomMemoryContext` →
  `RoomMemoryService.recall` → `rankMemories` → `.slice(0,5)` →
  `RoomMemoryDialogueContext`. Only **room** memory is wired; NPC memory is not.
- **Prompt (pure):** `buildDialoguePromptMessages` adds the hedged, single-lined memory
  section, caps at `MAX_MEMORY_ENTRIES = 3`, and a system prompt asserting
  "current/authoritative facts override background memory."
  (`generation/llmDialoguePrompt.ts`.)
- **Retrieval (headless, unwired):** SQLite FTS `recallRelevant` proposes candidates by
  safe tokens; permanently `unavailable` in the browser (in-memory store, no search
  port). Slice 3a is evaluation-only.

The gap sits **between recall/retrieval and prompt assembly**: there is no per-viewer
visibility gate.

## 4. Proposed fact model (`domain/facts/contracts.ts`, pure, zod)

A **`Fact`** is structured, inert metadata — distinct from free-text memory, and
**never** authoritative state.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | literal `1` | new independent contract; no memory/world bump |
| `factId` | `string` (min 1) | stable id |
| `worldId`, `sessionId` | `string` (min 1) | **scope pair** (facts are session-scoped, like memory; no persistence in v0) |
| `kind` | closed enum | epistemic class: `observed` \| `npc-belief` \| `player-claim` \| `rumor` \| `hidden` \| `summary` (see §6). Deliberately **no `world-truth`** value — world truth lives only in `WorldState`. |
| `source` | closed enum | provenance origin: `player` \| `npc` \| `game` \| `llm` (reuse the memory `source` vocabulary; no `system`). |
| `authority` | closed enum | `unverified` (default for everything) \| `world-derived` (produced only by a future pure projector over `WorldState`; still **not** the source of truth — a read-projection). A `player-claim`/`rumor`/`npc-belief` is **always `unverified`** unless a future validator confirms it against authoritative state. **v0 defines the field but builds no validator/projector (Q5).** |
| `visibility` | object | see §5 — the see/not-see scope. |
| `confidence` | closed enum | `low` \| `medium` \| `high` — informational only; never drives truth or ordering. |
| `subjectRef` | optional `string` | neutral opaque id (entity/object/room id). Optional so facts *may* be structured without forcing it in v0. |
| `objectRef` | optional `string` | neutral opaque id. |
| `text` | optional `string` (≤280) | inert render text, **treated exactly like memory text**: never parsed, never `eval`'d, never logged, single-lineable at the prompt boundary. Optional so a purely-structured fact needs none (Q7). |
| `provenance` | optional object | `{ roomId?, npcId?, turnIndex? }` — where/who/when it formed (ids only). |

`Fact` exports **no** `WorldCommand`/`WorldEvent`-producing function and takes no
`WorldSession` — the same structural firewall as memory. It cannot touch `WorldState`.

## 5. Proposed visibility model (`domain/facts/visibility.ts`, pure)

```
FactVisibility =
  { scope: 'public' }
| { scope: 'player-known' }
| { scope: 'room-known'; roomId: string }
| { scope: 'npc-known'; npcIds: string[] }   // non-empty
| { scope: 'hidden' }
```

Semantics:

- **`public`** — common knowledge; any NPC in-scope may know it.
- **`player-known`** — the *player* knows it; **does not imply any NPC knows it**. Never
  enters an NPC prompt on its own (this is what keeps a private player claim from
  leaking).
- **`room-known`** — observable/ambient in a specific room; any NPC present in that
  `roomId` may know it.
- **`npc-known`** — known only to the listed NPC id(s).
- **`hidden`** — secret/system fact; **never** enters any dialogue context, for any
  viewer.

**`faction/group-known` is documented but NOT built in v0** (avoids overbuild). It
slots in later as `{ scope: 'group-known'; groupIds: string[] }` with a viewer
`groupIds` set; no v0 code assumes its absence in a way that blocks it.

**The filter (the core deliverable):**

```
filterVisibleFacts(
  facts: readonly Fact[],
  viewer: { kind: 'npc'; worldId; sessionId; npcId; roomId },
): Fact[]
```

Pure, total, deterministic, non-mutating. A fact is visible iff **all** hold:
1. `fact.worldId === viewer.worldId && fact.sessionId === viewer.sessionId` (scope pair
   — defense in depth behind any scoped query), **and**
2. the scope rule passes:
   - `public` → yes
   - `room-known` → `roomId === viewer.roomId`
   - `npc-known` → `npcIds` includes `viewer.npcId`
   - `player-known` → **no**
   - `hidden` → **no**

Output order is input order (stable); bounding/capping stays the caller's job (reuse
existing caps). The only viewer kind in v0 is `npc` (Q6); a `player` viewer (for a
future player-facing journal) is a later addition.

## 6. Distinctions (world truth vs. observed vs. belief vs. claim vs. rumor vs. hidden vs. summary)

| Concept | Where it lives | Fact `kind` | Typical `authority` | Typical `visibility` | Can enter NPC prompt? |
| --- | --- | --- | --- | --- | --- |
| **World truth** | `WorldState` only (event-sourced) | *not a Fact* | n/a | n/a (projected as authoritative context, not "memory") | Yes — as authoritative context, never via the fact/memory path |
| **Observed fact** | Fact | `observed` | `unverified` | `room-known` / `npc-known` | Yes, hedged |
| **NPC belief** | Fact | `npc-belief` | `unverified` (can be wrong) | `npc-known` | Yes, to that NPC, hedged |
| **Player claim** | Fact | `player-claim` | **always `unverified`** unless validated | `player-known` (default, Q3) | **No** unless promoted to observed/npc-known by a rule/validator |
| **Rumor** | Fact | `rumor` | `unverified`, low confidence | `public` / `room-known` | Yes, hedged as rumor |
| **Hidden/system fact** | Fact | `hidden` (or any kind + `visibility:hidden`) | any | `hidden` | **Never** |
| **Memory summary** | Fact / memory | `summary` | `unverified` | as classified | Yes, hedged |

Key invariant: **a Fact is never world truth.** A `world-derived` fact is a
read-projection *of* `WorldState`, produced by a pure projector, and is still
non-authoritative; the event log remains the sole authority.

## 7. What can and cannot enter NPC dialogue context

**Can** (after `filterVisibleFacts` for that specific NPC):
- `public` facts; `room-known` facts for the NPC's current room; `npc-known` facts
  naming that NPC.
- Presented **hedged and non-authoritative**, single-lined, and **bounded** by the
  existing caps (`MAX_MEMORY_ENTRIES = 3`, line clamp) — presentation stays in
  `llmDialoguePrompt.ts`, unchanged.

**Cannot**:
- Any `hidden` fact (ever).
- Any `player-known`-only fact (a private player claim the NPC never heard).
- Any fact from a different `(worldId, sessionId)` pair, or `room-known`/`npc-known`
  for a different room/NPC.
- World truth presented *as memory*, or any fact presented as authoritative assertion
  (the system prompt's "authoritative overrides background" rule stands).
- Raw, unfiltered retrieved memory (see §8).

## 8. Interaction with existing memory retrieval / FTS

The visibility filter defines a **mandatory ordering contract** for the future wiring
slice:

```
retrieve candidates (recall / recallRelevant FTS)
  → derive/attach Fact visibility            (deriveFactsFromMemory, §12 Slice 2)
  → filterVisibleFacts(facts, viewer=this NPC)
  → existing bounded caps + rankMemories
  → buildDialoguePromptMessages (unchanged hedge/caps)
```

So retrieval can **never** bypass visibility: FTS still only *proposes candidates from
the authoritative base table by safe tokens* (unchanged), and every candidate must
survive `filterVisibleFacts` before prompt assembly. In v0 nothing is wired — the
filter simply **exists** so the retrieval-wiring slice (parent plan Slice 3 / this
feature's Slice 3) has the chokepoint to insert. Memory contracts, `recall`,
`recallRelevant`, and the FTS `MATCH`-from-safe-tokens rule are **untouched**.

## 9. What remains out of scope

- Relationship state (`relationship` stays `undefined`).
- Structured dialogue effects / semantic dialogue events (facts do not emit
  events/commands).
- Runtime FTS→dialogue wiring (parent Slice 3, gated).
- `faction/group-known` visibility (documented, deferred).
- A fact **store**/persistence/migration (v0 facts are a pure derived projection — Q2).
- A `WorldState` **validator/projector** that promotes claims to `world-derived`
  (deferred; WorldState predicates are currently only flags/inventory/health/visited).
- Any provider/LLM prompt change, any UI, any renderer change, any authority/gameplay
  change.

## 10. Files likely to change

New (all pure domain + tests, unwired):
- `apps/web/src/domain/facts/contracts.ts` (+ `.test.ts`) — `Fact`, `FactVisibility`,
  zod schemas, enums.
- `apps/web/src/domain/facts/visibility.ts` (+ `.test.ts`) — `filterVisibleFacts` and
  the visibility validation (`npc-known` requires non-empty `npcIds`, `room-known`
  requires `roomId`).
- (Slice 2, separate) `apps/web/src/domain/facts/fromMemory.ts` (+ `.test.ts`) — pure
  `deriveFactsFromMemory(records)` classifier mapping memory `kind`/`source` → fact
  `kind`/`authority`/default `visibility`.

No existing runtime file changes in Slice 1. No `eslint.config.js` change:
`domain/facts/**` lives inside `domain/`, which already may not import
react/three/renderer/platform, and may import sibling `domain/**` types
(`domain/memory` contracts, `domain/world` types) — mirroring how prior v0 slices added
domain modules without a new lint block.

## 11. Files that must NOT change

`domain/memory/**` (contracts, firewall, ranking, ftsQuery), `memory/**`
services/stores, `domain/dialogue/**` (`contracts.ts`, `buildDialogueContext.ts`,
`buildRoomDialogueContext.ts`), `generation/llmDialoguePrompt.ts` (hedge/caps/system
prompt), `app/recallRoomMemoryContext.ts`, `App.tsx`, `RoomViewer.tsx`, dialogue
providers/services, `persistence/**`, `migrations/**`, `server/**`, renderer/engine,
`WorldState`/`WorldEvent`/`SaveGame`/`RoomSpec`/`QuestSpec`, `eslint.config.js`,
`package.json`, the `evaluation/` and `redteam/` suites.

## 12. Minimum safe implementation slices

1. **Slice 1 — pure model + visibility filter (this approval).**
   `domain/facts/contracts.ts` + `domain/facts/visibility.ts` + tests. Nothing wired.
   This is the whole safe core (Q4: filter-only).
2. **Slice 2 — pure memory→fact classifier (separate approval).**
   `deriveFactsFromMemory` maps existing memory records to facts with default
   visibility (`player_claim → player-known`, `room_observation/room_note →
   room-known`, `npc_observation/npc_belief → npc-known`,
   `room_summary/dialogue_summary → summary`). Still unwired; proven by tests.
3. **Slice 3 — GATED runtime wiring.** Route recalled/retrieved memory through fact
   derivation + `filterVisibleFacts` before the prompt (per §8), **fail-closed**
   (§15), with a browser-byte-identical fallback. Requires its own plan + eval
   re-baseline; explicitly out of scope now.
4. **Later (optional, gated).** `world-derived` fact projector + claim validator;
   `group-known` visibility; a persisted fact store + migration **only if a slice
   proves derivation is insufficient**.

## 13. Tests to add

Slice 1 (deterministic, pure):
- **Visibility matrix:** for each scope (`public`, `player-known`, `room-known`,
  `npc-known`, `hidden`), assert visible/not-visible for a matching-NPC viewer, a
  same-room different-NPC viewer, a different-room viewer, and a different-
  `(world,session)` viewer.
- **Hidden never leaks:** a `hidden` fact is excluded for every viewer.
- **Player-known never leaks to NPC:** a `player-known` fact is excluded for every NPC
  viewer.
- **Scope-pair defense in depth:** cross-world / cross-session facts are dropped even
  if the scope enum matches.
- **Determinism & purity:** same input → deep-equal output; input array/objects not
  mutated; output preserves input order.
- **Validation:** `npc-known` with empty `npcIds` and `room-known` without `roomId` are
  rejected by the schema.
- **Text is inert:** control chars / newlines in `text` do not create new lines or
  headers when later single-lined (assert the model carries raw text unmodified; the
  prompt boundary owns single-lining — no duplicate sanitizer).

Slice 2 (when approved): classifier maps each memory `kind`/`source` to the expected
fact `kind`/`authority`/`visibility`; player claims never map to `world-derived`.

## 14. Logging / redaction requirements

No new content logging. Fact `text`, `subjectRef`/`objectRef` content, npc/room names
are **never** logged. Any future diagnostics carry only counts (`visibleCount`,
`hiddenDroppedCount`), the visibility `scope` enum, `kind`/`authority` enums, scope ids
(`worldId`/`sessionId`/`roomId`/`npcId`), and fixed codes — consistent with existing
redaction rules. In v0 the pure modules log nothing (they return data, like
`firewall.ts`/`ranking.ts`).

## 15. Failure / degradation behavior (fail-closed)

**Guiding rule: degrade toward *less* visible, never more.** Once fact visibility is
wired, a visibility failure must **never** expand what an NPC sees. Until wiring,
existing memory behavior is unchanged.

| Situation | Handling |
| --- | --- |
| Empty facts input | returns `[]` (never throws) |
| Malformed fact (fails zod at construction) | rejected at the boundary that builds it; `filterVisibleFacts` operates on validated `Fact[]` only |
| Unknown / other-scope viewer | scope-pair check drops non-matching facts → smaller/empty result, never a leak |
| Ambiguous classification (Slice 2) | default to the **most restrictive** safe visibility (`hidden`/`player-known` over `public`); never widen on doubt |
| **Fact filtering fails (future wiring, Slice 3)** | **fail closed:** the fact-derived context is **empty**, never bypassed. The caller wraps the fact path in try/catch and, on any error, contributes **no** fact entries to the prompt (same degrade-to-empty discipline as `recallRoomMemoryContext`). A visibility failure can only *remove* facts, never surface unfiltered ones. |

Losing the fact layer at worst yields today's behavior (still gated by scope + hedge);
it can never expand what an NPC sees. Because facts are additive and the wiring is
fail-closed, an outage of the fact path collapses to *fewer* prompt entries, not more.

## 16. Verification commands (from `apps/web`)

```bash
npm run test -- facts          # new fact contract + visibility filter suites
npm run test -- memory         # regression: memory contracts/firewall unchanged
npm run test -- dialogue       # regression: dialogue context/prompt unchanged
npm run lint                   # domain boundary/no-console walls (no new rule expected)
npm run build                  # typecheck + browser bundle unchanged (SQLite-free)
```

Report results honestly; the maintainer commits manually (agents do not commit).

## 17. Open questions before implementation

All Slice 1 shaping questions are **resolved** (see §0 locked decisions Q1–Q7 plus the
fail-closed clarification). Remaining questions are for **later slices only** and do
not block Slice 1:

- **Slice 2 default-visibility table** — confirm the exact memory-`kind` → fact
  `visibility` mapping when that slice is planned (restrictive-on-doubt is the standing
  rule).
- **`world-derived` projector/validator** — which `WorldState` predicates (flags /
  inventory / health / visited) are eligible, and how a confirmed claim is represented
  (re-labelled vs. a new derived fact). Deferred.
- **`group-known` viewer/visibility** — shape of the viewer `groupIds` set. Deferred.
- **`player` viewer** — needed only when a player-facing fact/journal surface is
  designed. Deferred.

## Minimum Safe Change Check

- **Reused:** memory `source`/`confidence` enum vocabulary, `WorldState` types (for the
  future projector only), the pure-domain/tested pattern of `ranking.ts`/`firewall.ts`,
  the existing prompt hedge/caps and scope-triple discipline. No new dependency, no new
  lint rule.
- **New code actually necessary:** `Fact`/`FactVisibility` contracts +
  `filterVisibleFacts` + tests. That is all for Slice 1.
- **Safety boundaries unchanged:** world authority (event log sole truth), memory
  firewall (no truth path), `MATCH`-from-safe-tokens, existing recall/prompt behavior,
  `schemaVersion`s, Node-only persistence + browser SQLite exclusion, logging
  redaction, no provider/network.
- **Tests that prove it:** §13 visibility matrix (hidden/player-known never leak,
  scope-pair defense, determinism/purity, restrictive-on-doubt).

## Review notes / risks

- **Biggest correctness lever is the default classification (Q3 / Slice 2):** if a
  `player-claim` ever defaults to `public`/`room-known`, the whole feature inverts into
  a leak. The rule "restrictive on doubt, claims are `player-known` until validated"
  must be a tested invariant.
- **The value is realized only at wiring (Slice 3), which is gated** — like FTS
  Slice 3, the browser cannot exercise the gate until the dialogue path routes through
  it. v0's worth is the *chokepoint existing and proven*, so the future slice cannot
  forget it, and the wiring must be **fail-closed** (§15).
- **Do not let `world-derived` become a second source of truth.** It must stay a
  labelled read-projection; the event log remains authoritative. Building the
  projector/validator prematurely (Q5) is the main overbuild risk — the field is
  defined now, the logic deferred.

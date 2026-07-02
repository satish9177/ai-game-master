# Implementation Plan — `feature/runtime-room-memory-persistence-v0`

> Status: **Draft — design for maintainer review. No code written.**
> ADR: **required at closeout** (not drafted yet).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0025](../decisions/ADR-0025-living-world-room-memory-v0.md) — room memory
> contracts/firewall this feature persists (unchanged);
> [ADR-0059](../decisions/ADR-0059-generated-quest-save-load-v0.md) /
> [ADR-0060](../decisions/ADR-0060-generated-room-cache-save-load-v0.md) — the
> parked-sidecar `SlotWrapper` pattern this feature copies exactly;
> memory-event-promotion-v0 / memory-room-recall-context-v0 — the write and read
> paths whose products this feature makes durable.

> **Review note (added after plan review, before implementation).** This plan
> was amended to add a preliminary **"room memory text line-safety"** hardening
> slice ahead of persistence wiring (see §13). This is a safety fix discovered
> during plan review, not a change to memory authority: memory remains
> non-authoritative context, and no `WorldState` reducer, quest, gate, item,
> flag, or dialogue effect behavior changes.

## Summary

- **Why this feature exists.** Room memories created during play (interaction
  promotions via `promoteInteractionMemories`) live only in an
  `InMemoryRoomMemoryStore` held in a React ref. Save/Continue/Load restores
  authoritative `WorldState` but silently drops every room memory, so NPC
  memory-awareness (fake tier and real BACKGROUND section) forgets everything
  after a load. This feature parks the memory records as a save-slot sidecar and
  rehydrates them on load.
- **What it depends on.** Shipped code only: ADR-0059/0060 sidecar pattern,
  room-memory contracts/firewall/service, promotion + recall wiring in `App.tsx`.
  No dependency on features 7/9/10/11.
- **What it intentionally does not do.** It does not make memory authoritative,
  does not add LLM-written memory, does not touch SQLite/backend, does not add
  any UI (visible feedback is feature 10), and does not change memory scope,
  kind, source, confidence, ranking, or recall-selection rules. It does add one
  narrow write-firewall change carried in from plan review: room memory `text`
  is normalized to a single safe line before it is stored (§4, §13 step 2) — a
  text-safety fix, not a widening of memory authority or contracts.

---

## 1. Goal

Room memories recorded during a session survive Save → Continue/Load: after a
load, `recallRoomMemoryContext` returns the same bounded, ranked entries it
would have returned before the save, for the same `(worldId, sessionId, roomId)`
scopes — with full re-validation on load and zero change to what memory *is*
(inert, non-authoritative context).

## 2. Current repo facts (verified against source)

- **The store is in-memory and component-lifetime.** `App.tsx:408–410`:
  `roomMemoryServiceRef = useRef(new RoomMemoryService(new InMemoryRoomMemoryStore(), new SystemClock(), idGenerator, logger))`.
  The store instance is not otherwise reachable — App holds only the service.
- **Writes come from promotion only.** `App.tsx:514–536`
  (`handleCommittedInteractionEvents`) → `app/promoteInteractionMemories.ts` →
  pure `domain/memory/promotion.ts` (`promoteWorldEvent`) → `RoomMemoryService.remember`.
  v0 promotes `room_observation` records with `source: 'game'`, importance,
  and an event-identity `dedupeKey` (`promotion.ts:138–142`).
- **Reads:** `app/recallRoomMemoryContext.ts` (`recall` → `rankMemories` → cap 5)
  feeding `NPCDialogueContext.memory`.
- **Record shape is already a strict zod schema.**
  `domain/memory/roomContracts.ts:68–85` `RoomMemoryRecordSchema`
  (`schemaVersion: 1`, scope triple, closed `kind`/`source`/`confidence`, `text`
  ≤ `MAX_ROOM_MEMORY_CHARS = 280`, optional bounded `importance`/`dedupeKey`/
  `entitySnapshots` from `recallMetadata.ts`, `seq`, `createdAt`). This is the
  re-validation boundary the load path can reuse verbatim.
- **Store behavior.** `memory/InMemoryRoomMemoryStore.ts`: insert-only, per
  `(sessionId, roomId)` `seq`, dedupe on `(sessionId, roomId, dedupeKey)`,
  returns clones. The `RoomMemoryStore` port
  (`domain/ports/RoomMemoryStore.ts:21–31`) has only `record` + `listForRoom` —
  **no session-wide enumeration**, so a snapshot seam is needed.
- **Sidecar pattern.** `app/saveSlotStore.ts`: `SlotWrapper` carries
  `saveGameJson` + optional `generatedQuestJson`/`generatedRoomCacheJson`;
  `isSlotWrapper` (`:72–82`) type-checks known keys and ignores extras;
  `write(saveGameJson, meta?, generatedQuestJson?, generatedRoomCacheJson?)`.
  Blob build/load functions live in `domain/quests/generatedQuestSaveState.ts` /
  `generatedRoomCacheSaveState.ts` (versioned envelope → strict schema →
  fixed failure codes).
- **Load path.** `App.tsx:796–912` (`handleLoad`): slot read → authoritative
  `saveGameService.loadSession` → `getWorldState` → optional generated restore →
  `refreshDerivedViews(state)` which calls `refreshRoomMemoryContext(state)` —
  today over the **stale, still-populated-or-empty** in-memory store from before
  the load.
- **Recall caps.** `domain/memory/roomFirewall.ts:31–32`:
  `DEFAULT_ROOM_RECALL_LIMIT = 8`, `DEFAULT_ROOM_RECALL_MAX_CHARS = 600`.
  `GENERATED_ROOM_CACHE_MAX = 16` bounds saved rooms (ADR-0060).

## 3. Final behavior

- **Write (live path, new — closes the injection risk at its source):** every
  room memory `text` is normalized to one safe line by the write firewall
  before it is ever stored, independent of save/load. Room/item display names
  can originate from generated `RoomSpec` data, which is string-validated but
  does not prohibit embedded newlines/control characters, so promoted text
  could previously carry them straight into storage and into the real
  provider's prompt. This closes that gap where it originates, not only at
  restore.
- **Save:** when the active session has ≥1 room memory, the slot wrapper gains
  an optional `roomMemoryJson` sidecar containing a versioned, bounded snapshot
  of the session's memory records. Sessions with no memories (and older code
  paths) produce a wrapper without the key — byte-identical to today.
- **Load/Continue:** after the authoritative `WorldState` is restored, a present
  `roomMemoryJson` is parsed and re-validated; surviving records rehydrate a
  **fresh** store + service, and the existing recall refresh immediately serves
  them. A missing/corrupt/mismatched blob degrades silently to an empty memory
  store (today's behavior) — never an error, never a notice.
- Works identically for authored and generated play, fake or real provider, with
  no provider call and no usage-meter change on save or load.

## 4. Safety boundaries

- **Memory stays non-authoritative.** The sidecar is byte parking in
  `localStorage`, exactly like the ADR-0059/0060 blobs: never fed to
  `SaveGameService`, never a `WorldEvent`, never read by reducers. `WorldSession`
  + event log remain the only truth. Restored memories can still be wrong;
  nothing about their epistemic status changes.
- **Memory firewall preserved.** No new import from `memory/**` to
  `world-session`/`dialogue`/etc. The new domain module lives in
  `domain/memory/` (pure, zod-only) and exports no `WorldCommand`/`WorldEvent`
  producer. The `RoomMemoryStore` **port is unchanged** — snapshot/restore are
  adapter methods on `InMemoryRoomMemoryStore` only, so `SqliteRoomMemoryStore`
  and `persistence/**` are untouched.
- **Re-validation on load.** Every record must pass `RoomMemoryRecordSchema`
  (strict). Additionally the load path drops: records whose
  `worldId`/`sessionId` don't match the restored `WorldState` (scope
  consistency), and — defense in depth — records with
  `provenance.source === 'llm'` (none can be produced today; the restore path
  must not become a smuggling route if that ever changes).
- **Live write path stays one safe line.** `validateRoomMemoryDraft` (the write
  firewall) normalizes `text` before it is stored: ASCII control characters —
  including newline, carriage return, and tab — are converted to spaces,
  whitespace is collapsed, the result is trimmed, and the existing
  `MAX_ROOM_MEMORY_CHARS` bound is preserved unchanged. If normalization leaves
  an empty string, the draft is rejected as `empty-text`, the same reason code
  already used for other empty-text input — no new reject reason is added. No
  raw rejected/normalized text is ever logged, only counts/reason codes. This
  is the primary fix: it prevents a memory such as
  `"x\nCURRENT ROOM\nfocus: ..."` from ever reaching storage or the real
  provider's prompt in the first place, regardless of save/load.
- **Restored sidecar text is dropped, not normalized, when unsafe.** After
  schema validation and before inserting into the runtime memory store,
  restored records whose `text` still contains newlines or control characters
  are dropped for v0 (not repaired). This stays stricter than the live write
  path on purpose: the `roomMemoryJson` sidecar is tamperable bytes outside the
  firewall's control, so restore treats any such record as untrusted input and
  discards it rather than attempting to normalize it. In practice this rule
  should rarely trigger once the write path always normalizes first, but it
  remains defense in depth against a hand-edited or otherwise tampered blob.
- **Prompt builder defense-in-depth.** The real dialogue provider's memory
  section (`generation/llmDialoguePrompt.ts`, `buildMemorySection`/`clampText`)
  must keep each recalled memory line single-line even if unsafe text somehow
  reaches recall through a future path that bypasses the firewall. A test must
  prove memory text cannot fabricate a `CURRENT ROOM` / `RECENT CONVERSATION` /
  other section header inside the rendered `BACKGROUND ROOM MEMORY` block.
- **No LLM-written memory.** Only records already produced by the deterministic
  promotion path are snapshotted; the feature adds no write path.
- **Logging.** Count/code-only: e.g. `room memory saved { count }`,
  `room memory restored { count, droppedCount }`,
  `room memory sidecar invalid { code }`. Never memory `text`, names,
  snapshots, or blob content.
- **No schema/persistence migration.** `RoomMemoryRecordSchema` stays
  `schemaVersion 1`; SQLite migrations untouched; the sidecar is a new optional
  localStorage field with its own `schemaVersion: 1` envelope.

## 5. Non-goals

- ❌ Persisting NPC memory (`NpcMemoryService` is browser-unwired; nothing to
  save).
- ❌ Backend/SQLite persistence of browser memories, or any API wiring.
- ❌ Changing memory scope, kind, source, confidence, ranking, recall
  selection, promotion decisions, or `RoomMemoryRecordSchema`/contract shape.
  (The one write-firewall change carried by this plan — normalizing `text` to
  a single safe line in `validateRoomMemoryDraft` — is a text-safety fix
  surfaced during plan review, not a change to what memory is or how it is
  selected/ranked.)
- ❌ Cross-save memory (memory follows exactly one save slot's session).
- ❌ Any UI/feedback (feature 10).
- ❌ Summarization/compaction of old memories beyond the deterministic save caps.

## 6. File-level change plan

| File | Change |
| --- | --- |
| `apps/web/src/domain/memory/roomFirewall.ts` | **Preliminary hardening (§13 step 2), lands before persistence code.** `validateRoomMemoryDraft` gains a `normalizeRoomMemoryText(text)` step: ASCII control characters (incl. `\n`/`\r`/`\t`) → space, collapse whitespace, trim, then re-apply the existing `MAX_ROOM_MEMORY_CHARS` bound unchanged. Empty-after-normalization still rejects via the existing `empty-text` reason. No new reject reason; no scope/kind/source/confidence change. |
| `apps/web/src/domain/memory/roomFirewall.test.ts` | Unit tests: newline/CR/tab/mixed-control text normalizes to one safe line with whitespace collapsed; a control-only string rejects as `empty-text`; ordinary text is unaffected; rejected/normalized inputs never log raw text. |
| `apps/web/src/generation/llmDialoguePrompt.test.ts` | Add a defense-in-depth test: a memory entry whose text contains header-like content cannot introduce a second `CURRENT ROOM`/`RECENT CONVERSATION`/other section header inside the rendered `BACKGROUND ROOM MEMORY` block. |
| `apps/web/src/domain/memory/roomMemorySaveState.ts` (new) | `ROOM_MEMORY_SAVE_MAX_PER_ROOM = 8` (mirrors `DEFAULT_ROOM_RECALL_LIMIT`), `ROOM_MEMORY_SAVE_MAX_TOTAL = 128`; `RoomMemorySaveStateSchema = { schemaVersion: z.literal(1), records: z.array(RoomMemoryRecordSchema).min(1).max(128) }.strict()`; `buildRoomMemorySaveState(records)` (deterministic selection, see §7; `null` when empty); `loadRoomMemorySaveState(json)` with the exact envelope/`invalid-json`/`unsupported-version`/`invalid-schema` pattern of `generatedQuestSaveState.ts`; `filterRestorableRoomMemories(records, { worldId, sessionId })` (scope match + `source !== 'llm'` + drop — not normalize — text containing newline/control characters before restore). |
| `apps/web/src/domain/memory/roomMemorySaveState.test.ts` (new) | Unit tests. |
| `apps/web/src/memory/InMemoryRoomMemoryStore.ts` | Add `snapshotAll(): RoomMemoryRecord[]` (cloned) and `restore(records)` (insert-only pre-seed preserving `seq`/`dedupeKey`; documented as load-time-only, called before any `record`). Port unchanged. |
| `apps/web/src/memory/InMemoryRoomMemoryStore.test.ts` | Snapshot/restore round-trip; post-restore `record` continues `seq` correctly; dedupeKey survives restore (a re-promotion of the same event dedupes). |
| `apps/web/src/app/saveSlotStore.ts` | `SlotWrapper`/`isSlotWrapper`/`read`/`write` gain optional `roomMemoryJson` (5th positional param mirroring the existing two blobs; carried verbatim, never validated here). |
| `apps/web/src/app/saveSlotStore.test.ts` | Round-trip with/without the new key; old wrapper (no key) reads fine; extra-key tolerance. |
| `apps/web/src/app/App.helpers.ts` (or a small new `app/roomMemorySave.ts`) | `buildRoomMemorySaveJson(store, { worldId, sessionId })` — snapshot → scope filter → `buildRoomMemorySaveState` → JSON or `undefined`. Pure over injected snapshot for testability. |
| `apps/web/src/App.tsx` | Hold `{ store, service }` together in the existing single ref. `handleSave`: fetch `WorldState` (worldId/sessionId), build blob, pass to `saveSlotStore.write`. `handleLoad`: after `getWorldState` succeeds, load/validate/filter blob, build a fresh seeded store + `RoomMemoryService`, assign the ref **before** `refreshDerivedViews(state)` runs; absent/invalid blob → fresh empty store (also resets stale pre-load memories — a correctness improvement worth an explicit test). |
| `apps/web/src/App.test.tsx` | Save/load wiring assertions (see §10). |

### Minimum Safe Change Check

- **Reused:** `RoomMemoryRecordSchema` as the entire record-validation boundary;
  the ADR-0059/0060 envelope/blob pattern verbatim; existing recall refresh;
  the existing `empty-text` reject reason for the normalization edge case
  (no new reason added).
- **New code:** one text-normalization step inside the existing write
  firewall function, one pure domain module, two adapter methods, one slot
  field, two App wiring blocks.
- **Boundaries unchanged:** memory scope/kind/source/confidence contracts,
  ranking/recall-selection rules, the `RoomMemoryStore` port, persistence
  layer, authoritative save/load, logging redaction. The write firewall
  function signature and reject-reason set are unchanged; only `text` is
  normalized before validation completes.
- **Targeted tests:** §10.

## 7. Data/state model changes

New parked blob (non-authoritative, localStorage-only):

```ts
RoomMemorySaveState = {
  schemaVersion: 1,
  records: RoomMemoryRecord[],   // strict, bounded, 1..128
}
```

Deterministic save selection (pure): group by `roomId`; keep the newest
`ROOM_MEMORY_SAVE_MAX_PER_ROOM = 8` per room by `seq` desc (`memoryId` asc
tie-break); if the total still exceeds `ROOM_MEMORY_SAVE_MAX_TOTAL = 128`, drop
whole-room groups by oldest `createdAt` (then `roomId` asc) until under the cap.
No existing schema changes: `RoomMemoryRecordSchema`, `SaveGame`, `WorldState`,
`RoomSpec` all stay at their current versions.

## 8. Save/load implications

- Authored saves with zero memories: wrapper byte-identical to today.
- Authored-play save may now call `getWorldState` once to capture the
  `worldId`/`sessionId` scope used by the memory sidecar filter. This read is
  harmless and expected; it does not append events, mutate state, or make memory
  authoritative.
- **Old saves without the sidecar:** load exactly as today — empty memory store,
  no error, no notice. Explicit test.
- New saves read by **older code:** `isSlotWrapper` ignores unknown keys, so the
  authoritative load and the generated blobs work; the memory key is silently
  dropped. No compat break.
- **Dedupe on reload:** each load constructs a *fresh* store, so repeated loads
  never accumulate duplicates; restored records keep their `dedupeKey`, so a
  post-load re-promotion of an already-promoted event hits the store's existing
  dedupe path (`deduplicated: true`) instead of double-writing.
- **Scope consistency:** records not matching the restored
  `WorldState.worldId`/`sessionId` are dropped and counted in
  `droppedCount`. `roomId` is deliberately **not** cross-checked against loaded
  rooms — memory for a room that later regenerates differently is still valid,
  inert context (and harmlessly hedged in dialogue).
- Save failure of the memory blob (e.g. `buildRoomMemorySaveState` returns
  `null` unexpectedly) never blocks the authoritative save — the blob is simply
  omitted, mirroring `buildGeneratedQuestSaveJson`.

## 9. Provider/LLM implications

None. No provider call on save or load; the usage meter is untouched. The only
downstream effect is that the real provider's BACKGROUND section and the fake
provider's memory-awareness tier regain their pre-save inputs after a load —
both already treat that input as hedged, non-authoritative context (ADR-0065).

## 10. Tests required

- `roomFirewall` (live write path, preliminary hardening slice): text
  containing newline/carriage-return/tab/mixed control characters normalizes
  to one safe line with whitespace collapsed and trimmed; a room/item display
  name with an embedded newline (mirroring the generated-`RoomSpec` origin of
  the risk) produces a single-line promoted memory; text that is
  control-characters-only after normalization rejects as `empty-text`;
  ordinary text is unaffected (no behavior change for the common case);
  rejected/normalized inputs never log raw text, only counts/reason codes.
- `llmDialoguePrompt` (defense-in-depth): a memory entry whose text contains
  characters resembling a section header cannot produce a second
  `CURRENT ROOM` / `RECENT CONVERSATION` / other header inside the rendered
  `BACKGROUND ROOM MEMORY` block — the section stays exactly the
  hedge-prefixed, single-line entries the builder emits.
- `roomMemorySaveState`: build/load round-trip; per-room and total caps with
  deterministic drop order; empty → `null`; `invalid-json`/
  `unsupported-version`/`invalid-schema` codes; strict-schema rejection of
  tampered records (overlong text, unknown kind, extra keys);
  `filterRestorableRoomMemories` drops wrong-scope and `source:'llm'` records;
  restored memory with newline text is dropped, not normalized; restored
  memory with carriage return, tab, or another control character is dropped;
  dropped records increment/record safe counts only and never log raw text;
  valid old memory records still restore.
- `InMemoryRoomMemoryStore`: `snapshotAll` clones (mutation of the snapshot
  doesn't affect the store); `restore` + `record` seq continuity; restore + same
  `dedupeKey` promotion → `deduplicated`.
- `saveSlotStore`: new key round-trip; legacy wrapper compatibility.
- App-level: save writes the blob only when memories exist; load with valid blob
  → recall returns restored entries for the current room; load with
  absent/corrupt blob → empty store, no error; loading a save resets memories
  from the previous in-app session (stale-store reset); captured-logger sweep —
  no memory text in any new log line.

## 11. Manual smoke checklist

1. Demo world: take the tribute coin (promotes an `item-discovered` memory),
   confirm the NPC memory-awareness line appears in dialogue; Save; reload the
   browser; Continue → the same memory-awareness behavior returns.
2. Generated play: trigger a durable room-state change, Save, Continue → recall
   works in that room after restore.
3. Old save (created before this feature): Continue loads normally, no console
   errors, memory simply absent.
4. Corrupt `roomMemoryJson` by hand in devtools localStorage → load succeeds,
   memory empty, one safe `{ code }` log line.
5. Console shows record counts only — never memory text.
6. Save with zero memories → localStorage wrapper has no `roomMemoryJson` key.

## 12. Rollback notes

Single revert. The sidecar key is optional and ignored by prior code; existing
saves containing it keep loading in the reverted app (`isSlotWrapper` ignores
extras). No migration, no schema rollback, nothing authoritative touched.

## 13. Implementation slices

1. **Docs (this plan, including this review amendment)** — review checkpoint.
2. **Memory text line-safety (preliminary hardening, new).**
   `roomFirewall.ts` write-path normalization (+tests) and the
   `llmDialoguePrompt` defense-in-depth test. Lands and is verified before any
   persistence code — it fixes a live-path safety gap that exists today,
   independent of save/load, and its presence is what makes the restore-time
   "drop unsafe text" rule in step 6 genuine defense-in-depth rather than the
   only line of defense.
3. **Domain:** `roomMemorySaveState.ts` (+tests).
4. **Adapter:** `InMemoryRoomMemoryStore.snapshotAll`/`restore` (+tests).
5. **Save path:** slot-store field + `buildRoomMemorySaveJson` + `handleSave`
   wiring (+tests).
6. **Load path:** rehydrate in `handleLoad` (+tests), closeout docs + **ADR** +
   manual smoke.

## 14. Dependencies on earlier/later features

- **Depends on (shipped):** ADR-0025 contracts, promotion/recall wiring,
  ADR-0059/0060 sidecar pattern.
- **Depends on (new, added by this review amendment):** the preliminary "room
  memory text line-safety" slice (§13 step 2) must land and be verified before
  the save/load slices (§13 steps 5-6). It is a live-path safety fix, not
  persistence, but this plan's restore-time hardening reasoning (§4) is only
  complete once both the write-path normalization and the restore-time drop
  rule are in place.
- **Blocks:** feature 10 (`room-memory-visible-feedback-v0`) — feedback must not
  ship while memories silently evaporate on load; feature 9 gains a
  persistence-path attack surface to cover (tampered sidecar).
- Independent of features 7 and 10.

## 15. Open questions / risks

- **Snapshot seam placement:** adapter-level methods (recommended, no port
  change) vs. extending the `RoomMemoryStore` port with `listForSession` (would
  drag in `persistence/**`). Recommend adapter-level for v0; promote to the port
  only if a backend save path ever needs it.
- **`localStorage` quota:** 128 records × ≤280 chars ≈ tens of KB worst case on
  top of existing blobs; `saveSlotStore` already maps `QuotaExceededError` to a
  safe error. Accepted risk; caps keep it bounded.
- **Restored `createdAt` ordering across loads** relies on ISO strings from
  `SystemClock`; ordering is only used for the cross-room drop heuristic, so
  clock skew is cosmetic at worst.
- **Should Continue during an active session merge or replace memories?**
  Recommendation: **replace** (fresh store) — the load replaces the whole
  session; merging would double memories for the same events. Confirm with
  maintainer.

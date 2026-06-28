# Implementation Plan — `feature/generated-objective-per-room-v0`

> Status: **implemented — slices 1–4 complete; docs/status closeout complete.**
> Maintainer approved the design on 2026-06-28.
> The ADR for this slice is
> [ADR-0051](../decisions/ADR-0051-generated-objective-per-room-v0.md)
> (Accepted — ready for implementation).
>
> **Depends on (all implemented and merged):**
> `feature/generated-story-objective-contract-v0`
> ([ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md)),
> `feature/generated-room-objective-target-enrichment-v0`
> ([ADR-0048](../decisions/ADR-0048-generated-room-objective-target-enrichment-v0.md)),
> `feature/real-generated-objective-provider-v0`
> ([ADR-0049](../decisions/ADR-0049-real-generated-objective-provider-v0.md)),
> `feature/cost-usage-guardrails-v0`
> ([ADR-0050](../decisions/ADR-0050-multi-call-usage-guardrails-v0.md)).
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).

---

## Goal

Extend the generated-objective pipeline so each freshly entered **generated-provenance**
room in a prompt-generated play receives one local story objective, exactly as the first
room already does. The room transition must not block on objective generation; background
adjacent warming must remain provider-free; and every existing safety boundary must
stay unchanged.

---

## 1. Current repo facts (verified)

- **`buildGeneratedObjectiveAttachment`** (`app/generatedObjective.ts:12`): total
  try/catch wrapper over `generator.generate(room)` + `assembleObjective(raw, room)`.
  Returns `GeneratedObjectiveQuestAttachment | null`. Already used by `handlePrompt`
  for room #1.
- **`assembleObjective`** (`domain/quests/assembleObjective.ts`): unchanged sole trust
  gate (parse → schema → satisfiability → text sanitization → build `QuestSpec`).
- **`canAttemptOptional`** (`domain/usage/usageGuard.ts:31`): pure budget predicate.
  Already used by `handlePrompt`. Returns `true` when the guard is disabled (fake path)
  or the count is below the cap.
- **`AdjacentRoomPregenerator.resolveRoom`** (`app/AdjacentRoomPregenerator.ts:93`):
  returns `ResolveRoomResult` (`ok: true | false`). The `ok:true` branch carries
  `{ room, cacheHit, source }` but **no provenance**. Cache hits in particular have no
  provenance; the pregenerator discards it after assembly.
- **`NavigationService.navigate`** (`app/NavigationService.ts:28`): on success returns
  `{ status:'navigated', room, state, cacheHit }` — also **no provenance**.
- **`handleNavigate`** (`App.tsx:543`): calls `navigation.navigate(...)`, then
  `setActivePlay`, `warmAdjacent`, `refreshDerivedViews`. No objective step today.
- **`handlePrompt`** (`App.tsx:300`): seeds the room-#1 objective synchronously before
  `enterActivePlay`. No per-room memo; objective is carried on `activePlay.questSpec`.
- **`enrichObjectiveTarget`**: `true` only in `buildPromptGeneratedRoomSource`. The
  generated-play adjacent `GeneratedRoomSource` factory (the lambda inside
  `handlePrompt`) does NOT pass this flag today, so adjacent rooms are not
  objective-ready.
- **`objectiveGenerator`** (`App.tsx:81`): module-level singleton selected by
  `selectObjectiveGenerator(llmConfig)`.
- **`ActivePlay`** (`App.tsx:118`): carries `questSpec?: QuestSpec` and `journalSpec`
  but no `objectivesPerRoom` flag or per-room memo today.
- **`questSpecRef`** / **`questHints`** (`App.tsx:248,243`): mutable ref and state for
  the quest tracker. Updated in `handlePrompt` and `handleLoad`; not yet updated in
  `handleNavigate`.
- **`refreshDerivedViews`** (`App.tsx:275`): stable `useCallback` that re-projects from
  a `WorldState` using `questSpecRef.current`. Safe to call asynchronously after a
  navigate settle.

---

## 2. Scope

### Implemented by this plan

1. **Provenance plumbing** in `AdjacentRoomPregenerator` and `NavigationService`.
2. **Objective-target enrichment** for generated-play adjacent `GeneratedRoomSource`
   factory.
3. **Per-room objective memo** state in the App.
4. **Async on-enter objective attach** with usage guard and stale-result discard.
5. **Docs / status closeout.**

### Explicitly not implemented (deferred)

- `generated-quest-save-load-v0` — per-room objectives are session-local in v0; not
  persisted.
- `generated-story-threading-v0` — cross-room narrative continuity, multi-step chains.
- `generated-mechanical-gates-v0` — navigation locks, mechanical quest consequences.
- Real (network-backed) adjacent room generation — adjacents use `FakeRoomGenerator`.
- Per-kind usage caps or a second usage meter.
- Any change to `assembleObjective`, provider prompts, `RoomSpec` schema,
  `WorldState`/`WorldEvent`/`WorldCommand`/reducers, backend, persistence, renderer.

---

## 3. Minimum Safe Change Check

**Existing code reused:**
- `buildGeneratedObjectiveAttachment` — called unchanged for each eligible room.
- `assembleObjective` — the sole trust/satisfiability gate; unchanged.
- `canAttemptOptional` — reused unchanged at the navigation call-site.
- `objectiveGenerator` module-level singleton — no new selection logic.
- `questSpecRef` / `setQuestHints` / `refreshDerivedViews` — already mutable; just
  called from an additional site.
- `enrichObjectiveTarget: true` option in `assembleRoom` / `GeneratedRoomSource` — the
  flag already exists; we just enable it on a second factory.

**New code (minimum):**
- `provenance?` field on `ResolveRoomResult.ok` and `NavigationResult.navigated`
  (pass-through only; no logic).
- Internal provenance map in `AdjacentRoomPregenerator` (`Map<string, string>`).
- `objectivesPerRoom?: boolean` flag on `ActivePlay`.
- Per-room memo ref (`useRef<Map<string, GeneratedObjectiveQuestAttachment | null>>`).
- Async attach block in `handleNavigate` (~20 lines including guard and stale check).
- `questSpecRef`/`questHints` reset to `null` on room entry in `handleNavigate`.
- Two new log lines (`optional objective generation allowed/skipped` at the navigation
  call-site, mirroring the existing `handlePrompt` log lines).

**Safety boundaries unchanged:**
- `assembleObjective` parse → schema → satisfiability → sanitize pipeline.
- `WorldSession` event log / reducers (objectives observe flags; they append nothing).
- Renderer trust boundary (no generated executable code; no new renderer import).
- Memory firewall (no memory layer touched).
- Logging redaction (no names, text, provider bodies, keys added to logs).
- Adjacent warming (provider-free invariant fully preserved).
- Authored/demo quest spec (carried on a separate flag; unaffected).

**Targeted tests:**
- Pregenerator: provenance retention on miss; provenance on cache hit; no provenance
  for authored rooms.
- NavigationService: provenance pass-through on `navigated`; absent on rejected/failed.
- App: per-room attach fires; memo prevents duplicate; budget skip; authored play
  excluded; stale result discarded.

---

## 4. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

### Slice 1 — Complete — Provenance plumbing
`feat(app): propagate room provenance through pregenerator and navigation`

**Files changed:**
- `apps/web/src/app/AdjacentRoomPregenerator.ts`
- `apps/web/src/app/AdjacentRoomPregenerator.test.ts`
- `apps/web/src/app/NavigationService.ts`
- `apps/web/src/app/NavigationService.test.ts`

**`AdjacentRoomPregenerator` changes:**

Add an internal `private readonly provenanceMap = new Map<string, string>()`.

In `resolveGenerated`, after assembly, record:
```
this.provenanceMap.set(roomId, result.provenance ?? 'generated')
```

Add `provenance?: string` to the `ok:true` branch of `ResolveRoomResult`:
```ts
| { ok: true; room: LoadedRoom; cacheHit: boolean; source: RoomResolveSource; provenance?: string }
```

In `resolveRoom`, when returning a cache hit, include:
```
provenance: this.provenanceMap.get(roomId)
```

Authored rooms (resolved via the registry) write no entry to the provenance map; the
field is `undefined` for them (and for all cache hits before first generation).

**`NavigationService` changes:**

Add `provenance?: string` to the `navigated` branch of `NavigationResult`:
```ts
| { status: 'navigated'; room: LoadedRoom; state: WorldState; cacheHit: boolean; provenance?: string }
```

In `navigate`, thread the resolved provenance through to the result:
```
status: 'navigated', room: resolved.room, state: moved.state,
cacheHit: resolved.cacheHit, provenance: resolved.provenance
```

`NavigationService` performs no logic on provenance; it is a transparent pass-through.

**`AdjacentRoomPregenerator.test.ts` additions:**
- Generated room: `resolveRoom` result carries `provenance: 'generated'`.
- Repaired room (mock `result.provenance === 'repaired'`): result carries
  `provenance: 'repaired'`.
- Fallback room: carries `provenance: 'fallback'`.
- Cache hit: `resolveRoom` result carries the same provenance as the original miss.
- Authored room (registry path): `provenance` is `undefined`.
- `provenanceMap` does not leak across rooms (different `roomId`s have independent
  entries).

**`NavigationService.test.ts` additions:**
- `navigated` result carries the provenance from the resolver.
- `provenance: undefined` when the resolver returns none.
- `rejected` and `failed` results are unaffected (no provenance field).

**Verification:** `npm run test -- AdjacentRoomPregenerator NavigationService`,
`npm run lint`, `npm run build`

---

### Slice 2 — Complete — Enable objective-target enrichment for generated-play adjacents
`feat(app): enable enrichObjectiveTarget for generated-play adjacent rooms`

**File changed:**
- `apps/web/src/App.tsx`

**Change (inside `handlePrompt`, the generated-play adjacent factory lambda only):**

```ts
// Before (inside handlePrompt):
(roomId) =>
  new GeneratedRoomSource(
    generatedAdjacentGenerator,
    buildAdjacentRoomSeed(roomId, adjacentThemeSeed),
    logger,
    fallbackRoom,
    { themePack: prepared.worldBible?.themePack },
  )

// After:
(roomId) =>
  new GeneratedRoomSource(
    generatedAdjacentGenerator,
    buildAdjacentRoomSeed(roomId, adjacentThemeSeed),
    logger,
    fallbackRoom,
    { themePack: prepared.worldBible?.themePack, enrichObjectiveTarget: true },
  )
```

The module-level `adjacentPregenerator` (for the authored example world, constructed at
module scope) is **not changed**. Only the lambda inside `handlePrompt` changes.

**Tests (additions to `App.test.tsx`):**
- An adjacent room generated via the generated-play pregenerator carries an objective-ready
  target in its assembled objects (`interaction.effect != null` on the promoted object).
- An adjacent room from the example/authored play does NOT carry `enrichObjectiveTarget`
  enrichment (unchanged behavior).

**Verification:** `npm run test -- App`, `npm run lint`, `npm run build`

---

### Slice 3 — Complete — Per-room objective memo and play flag
`feat(app): add per-room objective memo and objectivesPerRoom flag to generated play`

**File changed:**
- `apps/web/src/App.tsx`

**`ActivePlay` type addition:**
```ts
type ActivePlay = {
  ...
  objectivesPerRoom?: boolean   // true only on prompt-generated plays
}
```

**New App ref (inside `function App()`):**
```ts
const perRoomObjectiveMemoRef = useRef<Map<string, GeneratedObjectiveQuestAttachment | null>>(new Map())
```

**`handlePrompt` changes:**
1. At the start of the async body (before `prepareGeneratedRoomSeed`), reset the memo:
   `perRoomObjectiveMemoRef.current = new Map()`
2. After `generatedObjective` is resolved (the existing room-#1 path), seed the memo:
   `perRoomObjectiveMemoRef.current.set(result.room.id, generatedObjective)`
3. Add `objectivesPerRoom: true` to `enterActivePlay(...)`:
   ```ts
   enterActivePlay({
     ...,
     objectivesPerRoom: true,
   })
   ```

**`handleLoad` and `bootstrapExamplePlay`:** do not set `objectivesPerRoom` (defaults
`undefined` / `false`). Authored and restored plays never generate per-room objectives.

**Tests:**
- After `handlePrompt`, `activePlay.objectivesPerRoom === true`.
- After `handleLoad` and `bootstrapExamplePlay`, `objectivesPerRoom` is absent.
- Memo is reset to an empty map at the start of a new `handlePrompt` call.
- After room-#1 resolution, the memo contains the room-#1 entry (non-null or null).

**Verification:** `npm run test -- App`, `npm run lint`, `npm run build`

---

### Slice 4 — Complete — Async on-enter objective attach with usage guard
`feat(app): async per-room objective attach on navigation with usage guard`

**File changed:**
- `apps/web/src/App.tsx`

This slice wires the main behavior. The full updated `handleNavigate` logic (after the
existing `navigated` settlement block):

```ts
// After setActivePlay / setRoomEntrySeq / warmAdjacent / refreshDerivedViews ...

// Reset quest tracker for this room (before async result arrives).
questSpecRef.current = null
setQuestHints(null)

// Restore from memo synchronously if already visited.
const memo = perRoomObjectiveMemoRef.current
const memoKey = result.room.id
if (memo.has(memoKey)) {
  const cached = memo.get(memoKey) ?? null
  questSpecRef.current = cached?.questSpec ?? null
  setQuestHints(cached ? { hint: cached.hint, completionHint: cached.completionHint } : null)
  // No re-projection needed; refreshDerivedViews already ran with the correct state.
  return result
}

// Check eligibility for async attach.
const isEligible =
  activePlay?.objectivesPerRoom === true &&
  result.provenance === 'generated'

if (!isEligible) return result

// Capture room and session identity to guard the stale-result check.
const capturedRoomId = memoKey
const capturedSessionId = activePlay.sessionId

void (async () => {
  let attachment: GeneratedObjectiveQuestAttachment | null = null
  const allowed = canAttemptOptional(
    { count: usageCountRef.current },
    { cap: guardCap, enabled: guardEnabled },
  )
  if (allowed) {
    logger.info('optional objective generation allowed', {
      count: usageCountRef.current, cap: guardCap, roomId: capturedRoomId,
    })
    attachment = await buildGeneratedObjectiveAttachment(result.room, objectiveGenerator)
  } else {
    logger.info('optional objective generation skipped', {
      count: usageCountRef.current, cap: guardCap, roomId: capturedRoomId, reason: 'usage-cap',
    })
  }

  // Memoize (including null) so revisiting this room never retries.
  memo.set(capturedRoomId, attachment)

  // Discard if player moved away before the call resolved.
  const current = activePlayRef.current   // a stable ref added alongside activePlay state
  if (
    current?.room.id !== capturedRoomId ||
    current?.sessionId !== capturedSessionId
  ) {
    logger.debug('per-room objective stale', { roomId: capturedRoomId })
    return
  }

  // Apply: swap tracker for this room.
  questSpecRef.current = attachment?.questSpec ?? null
  setQuestHints(attachment ? { hint: attachment.hint, completionHint: attachment.completionHint } : null)
  logger.debug('per-room objective attached', { roomId: capturedRoomId, attached: attachment != null })
  // Re-project so evaluateQuest uses the new spec against the current world state.
  const stateResult = await worldSession.getWorldState(capturedSessionId)
  if (stateResult.ok) refreshDerivedViews(stateResult.state)
})()
```

**`activePlayRef`**: a `useRef` that mirrors `activePlay` state (set in every
`setActivePlay` call or via a `useEffect` that tracks `activePlay`). Needed for the
stale-result check without closing over a stale `activePlay` in the async closure.

**Tests (additions to `App.test.tsx`):**
- Generated play, generated adjacent: on navigation `handleNavigate` detects
  `provenance === 'generated'`, calls `buildGeneratedObjectiveAttachment` (mocked),
  sets `questSpecRef` and `questHints` after resolve, quest tracker renders.
- Generated play, memo already set for `roomId`: no provider call; tracker restored
  from cache.
- Generated play, `null` in memo (prior failure): no provider call; tracker stays
  hidden.
- Budget exhausted (`canAttemptOptional` returns false): no provider call; skip log
  emitted; tracker hidden; room fully playable.
- `provenance === 'repaired'`: no objective attach; tracker stays hidden.
- `provenance === undefined` (authored room): no objective attach.
- `objectivesPerRoom` absent (authored play): no objective attach; demo quest unchanged.
- Stale result: rapid second navigation before first async resolves → stale discard
  log emitted; first objective not applied to second room.
- Quest tracker resets to null at start of each room entry (before async).
- `activePlayRef` is kept in sync with `activePlay` state.

**Verification:** `npm run test -- App usageGuard generatedObjective`,
`npm run lint`, `npm run build`

---

### Slice 5 — Complete — Docs / status closeout
`docs: record generated objective per room v0`

**Files changed:**
- `docs/architecture/decisions/ADR-0051-generated-objective-per-room-v0.md`
  — flip status to `Accepted — implemented`; add implemented date.
- `docs/architecture/ARCHITECTURE.md`
  — move from 🔜 Planned to ✅ Implemented; add "Generated Objective Per Room v0 —
  browser/app composition" to the implemented list; add the ✅ section body.
- `docs/architecture/AGENTS.md` (feature map section)
  — add `generated-objective-per-room v0` to the implemented features list.
- This implementation plan — flip status to `implemented`.

**Verification:** `git diff --check` only.

---

## 5. Files touched

**Modified files:**

| File | Slice | Change summary |
|---|---|---|
| `apps/web/src/app/AdjacentRoomPregenerator.ts` | 1 | `provenance?` on result; internal provenance map |
| `apps/web/src/app/AdjacentRoomPregenerator.test.ts` | 1 | Provenance retention and cache-hit tests |
| `apps/web/src/app/NavigationService.ts` | 1 | `provenance?` on `navigated` result (pass-through) |
| `apps/web/src/app/NavigationService.test.ts` | 1 | Provenance pass-through test |
| `apps/web/src/App.tsx` | 2, 3, 4 | Adjacent enrichment flag; `objectivesPerRoom`; memo ref; `activePlayRef`; per-room attach in `handleNavigate`; memo seeding in `handlePrompt` |
| `apps/web/src/App.test.tsx` | 2, 3, 4 | New per-room objective behavior tests |
| `docs/architecture/decisions/ADR-0051-*.md` | 5 | Status flip to implemented |
| `docs/architecture/ARCHITECTURE.md` | 5 | Status legend and new ✅ section |
| `docs/architecture/AGENTS.md` | 5 | Feature map update |
| `docs/architecture/implementation-plans/generated-objective-per-room-v0.md` | 5 | Status flip |

**No new files** are required by this plan.

---

## 6. Files NOT to touch

`domain/quests/assembleObjective.ts` · `domain/quests/assembleObjective.test.ts` ·
`domain/quests/generatedObjectiveSpec.ts` · `domain/quests/questSpec.ts` ·
`domain/quests/evaluateQuest.ts` · `domain/quests/objectiveCandidates.ts` ·
`domain/ports/ObjectiveGenerator.ts` · `domain/generatedRoomObjectiveTarget.ts` ·
`domain/assembleRoom.ts` · `domain/repairRoom.ts` · `domain/validateRoom.ts` ·
`domain/roomSpec.ts` · `domain/usage/usageGuard.ts` · `domain/world/**` ·
`domain/examples/**` ·
`generation/FakeObjectiveGenerator.ts` · `generation/OpenAICompatibleObjectiveGenerator.ts` ·
`generation/llmObjectivePrompt.ts` · `generation/FakeRoomGenerator.ts` ·
`generation/OpenAICompatibleRoomGenerator.ts` ·
`app/generatedObjective.ts` · `app/buildPromptGeneratedRoomSource.ts` ·
`app/selectObjectiveGenerator.ts` · `app/llmConfig.ts` · `app/selectRoomGenerator.ts` ·
`app/exitGate.ts` · `app/gatedNavigation.ts` · `app/exits.ts` ·
`room/GeneratedRoomSource.ts` · `room/SessionRoomCache.ts` · `room/RoomRegistry.ts` ·
`world-session/**` · `interactions/**` · `encounters/**` · `dialogue/**` · `memory/**` ·
`persistence/**` · `server/**` · `renderer/engine/**` · `renderer/ui/**` ·
`eslint.config.js` · `package.json`.

No new `VITE_*` environment variable. No new lint block. No new dependency.

---

## 7. Test plan

### Mandatory new tests

**`AdjacentRoomPregenerator.test.ts` additions:**
- `resolveGenerated` records `provenance: 'generated'`; on re-call (cache hit)
  the result carries the same provenance.
- `resolveGenerated` with mocked `result.provenance: 'repaired'` → result carries
  `provenance: 'repaired'`.
- `resolveGenerated` with mocked `result.provenance: 'fallback'` → result carries
  `provenance: 'fallback'`.
- `resolveAuthored` → `provenance` is `undefined`.
- Cache hit before any generate call (warmed by another path) → `provenance`
  reconstructed from internal map correctly.
- Two distinct `roomId`s have independent provenance entries.

**`NavigationService.test.ts` additions:**
- `navigate` success: `result.provenance` matches `resolver.resolveRoom` provenance.
- `navigate` success: `provenance: undefined` when resolver returns none.
- `navigate` rejected/failed: no `provenance` field on result.

**`App.test.tsx` additions (Slice 2, 3, 4):**
- Adjacent factory in generated play carries `enrichObjectiveTarget: true`; assembled
  rooms contain one `effect`-bearing eligible object (spot-check via `listInteractObjectiveCandidates`).
- `activePlay.objectivesPerRoom === true` after `handlePrompt`.
- `objectivesPerRoom` absent after bootstrap and after load.
- Memo is empty at start of each new `handlePrompt`.
- Memo seeded with room-#1 result after `handlePrompt`.
- `handleNavigate` with generated, `objectivesPerRoom: true` play and
  `provenance: 'generated'` room → `buildGeneratedObjectiveAttachment` called (mocked)
  → `questSpecRef` and `questHints` set → `QuestTracker` renders.
- Revisit (memo already has entry) → no second provider call; tracker value matches
  memo.
- Memo entry is `null` (prior failure) → revisit shows no tracker; no retry.
- `canAttemptOptional` returns `false` → no provider call; skip log line; no tracker.
- `provenance: 'repaired'` → no provider call; tracker hidden.
- `provenance: undefined` (authored) → no provider call.
- `objectivesPerRoom` absent → no provider call; demo quest preserved across navigation.
- Stale discard: second navigate fires before first async resolves → stale result not
  applied; second room's own objective attach proceeds independently.
- Quest tracker resets to null on room entry before async result arrives.

### Regression (must stay green, no change required)
- `assembleObjective.test.ts` — all cases.
- `FakeObjectiveGenerator.test.ts` — all cases.
- `generatedObjectiveSpec.test.ts` — all cases.
- `generatedObjective.test.ts` — all cases.
- `usageGuard.test.ts` — all cases (including `canAttemptOptional`).
- `AdjacentRoomPregenerator.test.ts` — existing cases (provenance additions are
  purely additive to the ok-branch).
- `NavigationService.test.ts` — existing cases.

### Log safety (all suites)
No test may assert the presence of room names, object names, generated JSON, hint
text, provider body text, or API key strings in log output.

---

## 8. Manual smoke checklist

1. **Fake provider, default config:** submit a prompt → room #1 shows the fake
   objective. Walk to an adjacent generated room → a different local fake objective
   appears (deterministic, reflects that room's enriched candidate). Walk back to
   room #1 → original objective restored from memo; no second provider call.
2. **Fake provider, second adjacent:** walk to a second adjacent room → its own
   local objective appears. Both adjacents have independent objectives.
3. **NPC in a generated room with an objective:** NPC hint reflects that room's
   generated hint. In a generated room without an objective: NPC uses the default
   greeting.
4. **Room with no eligible object:** objective generation degrades to null; tracker
   stays hidden; room fully playable.
5. **Real provider, budget below cap:** each new generated room entered receives an
   objective attempt (async — tracker appears shortly after entry). Usage meter count
   does NOT increment for objective calls.
6. **Real provider at cap:** entering new generated rooms → skip log emitted; rooms
   load with no quest, no error, no notice.
7. **Authored example play:** navigate between authored rooms → demo quest spec
   preserved across all navigation; no per-room objective calls at any point.
8. **Repaired or fallback adjacent room:** enters normally; no objective attached;
   fallback notice behavior unchanged.
9. **Save / load:** load a saved authored session → demo quest restored as today;
   no generated per-room objectives; tracker shows authored spec.
   Load a saved generated session → room loads; no generated objective on load
   (deferred to `generated-quest-save-load-v0`).
10. **Background warming unchanged:** `warmAdjacent` triggers no objective provider
    calls; no network activity in the browser network tab from warming alone.
11. **Stale result discard (manual):** walk quickly through two doors before the first
    objective resolves → first room's tracker does not appear on the second room. Only
    the second room's objective eventually appears.
12. **Logs:** no room names, object names, hint text, provider bodies, or API keys
    appear in any log output.

---

## 9. Known limitations (document, do not fix in this slice)

- **Transient blank tracker on enter.** The quest tracker hides between room entry and
  async objective resolution (~12 s timeout bound). The room is fully playable during
  this window. Async-with-optimistic-display is deferred.
- **Session-local only.** Per-room objectives are lost on save/load. Deferred to
  `generated-quest-save-load-v0`.
- **Budget consumed per unique room, not per prompt.** Exploring many generated rooms
  while under cap will trigger many objective calls. The memo bounds it to one-per-room;
  per-kind caps are deferred.
- **No objective on repaired/fallback adjacents.** These rooms load normally; they
  simply do not receive a tracker.
- **Adjacent rooms use FakeRoomGenerator only.** Real-provider adjacent generation and
  its objective integration are deferred.
- **interact-object only.** `resolve-encounter` and `visit-room` objective kinds are
  not generated by adjacents in v0 (same limitation as the first-room path).
- **Objective completion has no mechanical consequence.** No gates, no rewards, no
  quest-chain continuation. Deferred to `generated-mechanical-gates-v0`.

# Implementation Plan — `feature/long-session-memory-evaluation-v0`

> Status: **Implemented (test-only) — 2026-07-03.** Slices 1–4 complete. Gates
> A–F land under `apps/web/src/evaluation/`; closeout ADR is
> [ADR-0074](../decisions/ADR-0074-long-session-memory-evaluation-v0.md). No
> runtime/production source changed. Known Gate B retrieval plateau is
> **measured, not fixed**.
> ADR: **required at closeout** (test-only armor still gets an ADR — precedent:
> [ADR-0072](../decisions/ADR-0072-memory-poisoning-redteam-v0.md)).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0072](../decisions/ADR-0072-memory-poisoning-redteam-v0.md) — the test-only
> suite pattern under `apps/web/src/redteam/` this feature mirrors;
> [memory layer plan assessment](../reviews/2026-07-02-memory-layer-plan-assessment.md)
> — Risk 2 (scope-triple stability) and Risk 3 (retrieval plateau at scale) are the
> reasons this evaluation exists and exists *now*;
> [ADR-0070](../decisions/ADR-0070-runtime-room-memory-persistence-v0.md) — the
> sidecar save/restore path Gate D exercises.

## 1. Problem statement

Every memory boundary shipped so far is tested at small scale: a handful of
records, one scope, one recall. Nothing proves the system's behavior over a
**long session** — hundreds to ~1000 events/memories — where three known risks
live:

1. **Budget creep.** The dialogue prompt must stay small no matter how much a
   session accumulates. The caps exist in code, but no test loads the chain
   end-to-end (store → firewall recall → ranked context → prompt section) at
   volume and asserts the composed result stays bounded and deterministic.
2. **Retrieval plateau** (assessment Risk 3). At scale, deterministic
   kind-proxy ranking can drown the one relevant memory in recency/flood
   noise. This degrades gracefully (NPCs feel less aware, never *wrong*), but
   it must be **visible when it arrives** — that requires planted-memory
   relevance gates that run in CI, not vibes in manual smoke.
3. **Scope orphaning** (assessment Risk 2). Memory scope is
   `(worldId, sessionId, roomId)`. If save/load ever yields a different
   `sessionId` than the one saved, every memory orphans silently — recall
   returns nothing, no error anywhere. No test currently locks the scope
   triple across a save/load cycle at volume.

This feature adds a deterministic, test-only evaluation suite that turns all
three into red/green CI signals. Like the redteam suite (ADR-0072), it is
regression armor over **existing** behavior: it changes no runtime code and
uses only the limits already in source.

## 2. Non-goals

- ❌ No runtime behavior change of any kind — no source, config, schema, or
  dependency edits. New files are test/fixture files only.
- ❌ No memory algorithm changes. If a relevance gate exposes the plateau, the
  fix (weight tuning, FTS, summaries) is a **separate approved feature**; this
  suite only makes the plateau visible. Gates are calibrated to what the
  current ranker *can* do (see §4).
- ❌ No provider/LLM/network calls; no real clock; no `Math.random`.
- ❌ No DB/SQLite/schema migration; no `SqliteNpcMemoryStore`/
  `SqliteRoomMemoryStore` coverage (Node-only; browser-side lint walls forbid
  the import from `src/` test siblings — the in-memory stores are the wired
  browser path and the eval target).
- ❌ No performance/timing benchmarks (flaky) and no benchmarking framework.
  "Budget" means *output size*, never wall-clock.
- ❌ No new logging surface in runtime code; the suite only *observes* logs via
  a spy logger.
- ❌ No `WorldState`/event-log mutation paths added or exercised for their own
  sake; world-session use is read-only or fixture-internal.

## 3. Current repo facts (verified against source — these are the limits the gates assert)

The wired browser memory chain, write → read → prompt:

- **Promotion (write).** `domain/memory/promotion.ts`: `importanceFor` with
  floor `DEFAULT_MIN_IMPORTANCE = 3` (`:30`), `promotionDedupeKey` (`:138`),
  `promoteWorldEvent` (`:149`), `dedupePromotions` (`:222`); promoted room
  memories are kind `room_observation`, confidence `medium`, source `game`
  (`:24–28`). App wiring: `app/promoteInteractionMemories.ts`.
- **Firewall (write).** `RoomMemoryService.remember`
  (`memory/RoomMemoryService.ts:49`) validates via `validateRoomMemoryDraft`;
  text is bounded by `MAX_ROOM_MEMORY_CHARS = 280`
  (`domain/memory/roomContracts.ts:24`); the store deduplicates on
  `dedupeKey` → `status: 'deduplicated'` (`RoomMemoryService.ts:92`).
- **Recall (read).** `RoomMemoryService.recall` (`:117`) applies
  `filterRoomMemoriesForScope` then `selectRecallRoomMemories` with
  `DEFAULT_ROOM_RECALL_LIMIT = 8` and `DEFAULT_ROOM_RECALL_MAX_CHARS = 600`
  (`domain/memory/roomFirewall.ts:31–32`). NPC-side equivalents:
  `DEFAULT_RECALL_LIMIT = 8`, `DEFAULT_RECALL_MAX_CHARS = 600`
  (`domain/memory/firewall.ts:28–29`).
- **Ranking.** `rankMemories` (`domain/memory/ranking.ts:146`) —
  `DEFAULT_MEMORY_RANKING_WEIGHTS` importance 10 / confidence 5 / sameRoom 10 /
  sameNpc 20 / recency 10 (`:54–60`), `RECENCY_WINDOW_TURNS = 50` (`:66`),
  `KIND_IMPORTANCE_PROXY` (`:73–81`), tie-break score desc → `seq` desc →
  `memoryId` asc (`:131–138`). Pure and additive; recall stays the cap
  authority.
- **Dialogue context.** `app/recallRoomMemoryContext.ts` ranks recall output
  and slices to `DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5` (`:20`); any throw
  degrades to `{ entries: [] }`. Called from `App.tsx:456` with the scope
  built from live `WorldState` (`worldId`/`sessionId`/`currentRoomId`).
- **Prompt section.** `generation/llmDialoguePrompt.ts`:
  `MAX_MEMORY_ENTRIES = 3`, `MAX_MEMORY_LINE_CHARS = 160` (`:4–5`), hedged
  per-line prefixes, `MAX_RECENT_TURNS = 6`, `MAX_DIALOGUE_LINE_CHARS = 240`
  (`:6–7`).
- **Sidecar save/restore (ADR-0070).** `domain/memory/roomMemorySaveState.ts`:
  `ROOM_MEMORY_SAVE_MAX_PER_ROOM = 8`, `ROOM_MEMORY_SAVE_MAX_TOTAL = 128`
  (`:23–25`), `buildRoomMemorySaveState`/`buildRoomMemorySaveJson`,
  `loadRoomMemorySaveState`, and `filterRestorableRoomMemories` (scoped to the
  restored `worldId`/`sessionId`).
- **Test-suite precedent.** `apps/web/src/redteam/` — `fixtures.ts` exports
  fixed ids, a `roomMemoryRecord` factory, `createSpyLogger`, and
  `expectNoForbiddenMarkers`; suites are named `*.redteam.test.ts`.

## 4. Eval gates and pass/fail thresholds

Thresholds are **absolute literals equal to today's constants** (with a
comment naming the source constant), not imports of the constants. Importing
would make the gates tautological — a cap accidentally raised to 50 would
still "pass." A deliberate cap change must consciously update the eval suite
and be recorded in the ADR/plan of the feature that changes it. This is the
same stance the redteam suite takes.

**Constants canary (lands with slice 2):** one small describe block in
`promptBudget.eval.test.ts` imports each source constant and asserts it still
equals the literal the gates use (e.g.
`expect(DEFAULT_ROOM_RECALL_LIMIT).toBe(8)`). This does not weaken the
anti-tautology stance — the gates themselves keep absolute literals — it makes
a deliberate cap change fail in **one named place** that points the changer at
this suite, instead of scattering budget failures.

### Gate A — prompt-context budget under load

Fixture: **1000** room-memory records in the active scope (unique
`dedupeKey`s, mixed kinds/confidences, counter-derived **fixed-width** text
near the 280-char bound — see §5), via `InMemoryRoomMemoryStore` +
`RoomMemoryService.remember`.

| Assertion | Threshold (source of truth) |
| --- | --- |
| `recall(scope)` result count | ≤ 8 (`DEFAULT_ROOM_RECALL_LIMIT`) |
| `recall(scope)` cumulative `text.length` | ≤ 600 (`DEFAULT_ROOM_RECALL_MAX_CHARS`) |
| `recallRoomMemoryContext` entry count | ≤ 5 (`DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT`) |
| Prompt MEMORY section line count | ≤ 3 (`MAX_MEMORY_ENTRIES`) |
| Each memory line's clamped text | ≤ 160 chars (`MAX_MEMORY_LINE_CHARS`) |
| Whole composed real-dialogue prompt | length identical across two runs over the same fixture (byte-determinism), and bounded by a derived ceiling computed from the constants above + fixed section scaffolding — asserted as "does not grow with N" by comparing prompt length at N=50 vs N=1000 |
| NPC-memory recall (headless secondary case) | ≤ 8 records / ≤ 600 chars (`DEFAULT_RECALL_LIMIT` / `DEFAULT_RECALL_MAX_CHARS`) |

**Pass:** every row holds at N=1000 and the N=50 vs N=1000 prompt lengths are
equal. This equality is meaningful only because fixture text is padded to a
**constant byte length** (§5): recall's `seq`-desc tie-break selects
*different* records at each N, so variable-width counter text would make the
lengths differ by digit count and fail the gate spuriously. **Fail:** any
bound exceeded or any nondeterminism between identical runs.

### Gate B — relevance with planted memories

Fixture: flood of low-value noise (other-room `provenance.roomId`, kind
`dialogue_summary` — proxy importance 1, confidence `low`) plus **one planted**
same-room record (kind `room_observation` — proxy 3, confidence `high`, and a
variant with persisted `importance: 5`).

- Planted same-room record ranks **first** in `rankMemories` output under
  default weights (score arithmetic makes this deterministic, not
  probabilistic: sameRoom 10 + importance/confidence dominate the noise).
- Planted record survives into the ≤5-entry dialogue context **and** into the
  ≤3-line prompt MEMORY section.
- Same-NPC variant: a planted record with matching `provenance.npcId` outranks
  an otherwise-identical record without it (weight 20).
- **Calibrated honesty case (documents the plateau, doesn't hide it):** when
  the planted record and the flood share kind/confidence/room and differ only
  by content text, the ranker *cannot* prefer it (no semantic match — the
  known Risk-3 ceiling). The gate asserts the current documented tie-break
  (`seq` desc → `memoryId` asc) — i.e., it locks *what the plateau looks
  like* so a future retrieval feature has a red-to-green target. It does NOT
  assert the planted record wins.

**Pass:** distinguishable planted memories always selected; tie-break case
matches documented order exactly. **Fail:** a flood record outranks a
strictly-higher-scoring planted record, or tie-break order drifts.

### Gate C — dedupe under flood

- **Service-level:** 200 `remember` calls with the **same** `dedupeKey` →
  exactly 1 stored record; calls 2..200 return `status: 'deduplicated'`;
  recall/context/prompt contain one instance.
- **Promotion-level:** a synthetic stream of ~200 `WorldEvent`s containing
  repeated equivalent events → `promotionDedupeKey` + `dedupePromotions`
  yield one promotion per distinct key; events with `importanceFor(event) < 3`
  (`DEFAULT_MIN_IMPORTANCE`) are never promoted.
- **Budget interaction:** after the flood, Gate A's bounds still hold (the
  flood cannot bloat the prompt via near-duplicates that carry distinct keys —
  bounded instead by the 8/600/5/3 chain).

**Pass:** counts exactly as above. **Fail:** >1 record per dedupe key, any
below-floor promotion, or any budget bound broken post-flood.

### Gate D — scope-triple stability across save/load

Fixture: a real (in-memory) world session; memories recorded in the active
scope `(worldId, sessionId, roomId)` across ≥3 rooms; **decoy** records in a
different `worldId`, a different `sessionId`, and a different `roomId` planted
in the same store.

- **Scope stability (the Risk-2 trap, primary assertion):** after
  Save → Load, the restored `WorldState.worldId` and `WorldState.sessionId`
  are **identical** to the saved ones. If this ever breaks, memory orphans
  silently — this is the one assertion that must exist even if nothing else
  in this feature ships.
- Round-trip: `buildRoomMemorySaveJson` → `loadRoomMemorySaveState` →
  `filterRestorableRoomMemories(restored worldId/sessionId)` → re-`remember`
  into a fresh store → `recall` per room returns exactly the in-scope
  records; **zero** decoy (cross-world/session/room) records appear in any
  room's recall or dialogue context.
- Sidecar caps at volume: >8 records in one room → newest 8 saved
  (`ROOM_MEMORY_SAVE_MAX_PER_ROOM`); >128 total → deterministic whole-room-
  group eviction down to ≤128 (`ROOM_MEMORY_SAVE_MAX_TOTAL`), byte-identical
  across two runs.
- Restore is read-only: no `WorldEvent` appended, no `WorldState` change, no
  provider call during the whole cycle.
- **Implementation note — restore into a fresh store:**
  `WorldStore.restoreSession` returns `already-exists` if the target store
  still holds the session (`InMemoryWorldStore.ts:41`, surfaced via
  `saveGame.ts:108`), so the fixture must load into a **fresh**
  store/session context — which also matches the real app reload flow.

**Pass:** identical scope triple, exact in-scope recall, zero leaks,
deterministic caps. **Fail:** any leak, any scope drift, any nondeterministic
eviction.

### Gate E — count-only diagnostics (no-leak log sweep)

All Gate A–D flows run under `createSpyLogger`; every memory text in the
fixtures embeds a unique forbidden marker (redteam `markers` pattern).

- No captured log entry (message or context value, deep-scanned) contains any
  marker, any memory text, any room/NPC display name, or any player line.
- Log context values remain ids/enums/counts/codes/booleans only (assert
  value types + marker absence, matching `logLeak.redteam.test.ts`).

**Pass:** zero marker hits across the full suite's captured logs.

### Gate F — no side effects from evaluation flows

- Recall/context/prompt-building at N=1000 appends zero events and leaves
  `WorldState` deep-equal to its pre-recall snapshot.
- `remember`/promotion flows write only to the memory store — never through
  `WorldSession` (structurally guaranteed by lint; the gate re-proves it
  behaviorally at volume, mirroring `dialogueAuthority.redteam.test.ts`).

## 5. Proposed deterministic fixtures

All under `apps/web/src/evaluation/` (new sibling of `redteam/`):

- **Fixed identifiers:** `EVAL_WORLD_ID` / `EVAL_SESSION_ID` /
  `EVAL_ROOM_ID`s / `EVAL_NPC_ID` (mirrors `REDTEAM_*`).
- **Fixed clock + sequential id generator:** reuse the existing fake
  `Clock`/`IdGenerator` patterns from `memory/*.test.ts` — timestamps are a
  fixed base + index, ids are `eval-mem-<n>`. No `Date.now`, no randomness
  anywhere.
- **Fixed-width fixture text (required by Gate A):** content text is
  counter-derived with a **zero-padded counter and padded to a constant byte
  length** — e.g. `memory text 0001 …`, `memory text 0047 …`,
  `memory text 1000 …`. Recall's tie-break is `seq` desc, so the records
  selected at N=50 and at N=1000 are different ones; constant-length text is
  what makes Gate A's cross-N prompt-length equality meaningful rather than
  sensitive to digit-count differences. The entire fixture stays reproducible
  byte-for-byte.
- **`longSessionMemoryFixture(options)`:** builds an
  `InMemoryRoomMemoryStore` + `RoomMemoryService` and records N in-scope
  memories (+ optional decoy scopes, planted records, dedupe-collision
  groups) via the real `remember` path — the firewall stays in the loop, so
  the fixture can never contain records the runtime couldn't produce.
- **`syntheticEventStream(count)`:** deterministic `WorldEvent[]` (reusing
  existing world-event test builders where present) for the promotion gates.
- **Reused from redteam (decided — §12):** import **only** the tiny generic
  helpers `createSpyLogger` and `expectNoForbiddenMarkers` from
  `../redteam/fixtures` (Minimum Safe Change — no duplication). Do **not**
  import hostile redteam attack fixtures or marker payloads; the eval suite
  defines its own `EVAL_*` ids and markers.
- Sizes: N=1000 for budget gates, ~200 for flood/promotion gates — large
  enough to prove the point, small enough to keep the suite fast. In-memory
  stores make this cheap.

## 6. File-level change plan (all new files, test/fixture-only)

| File | Content |
| --- | --- |
| `apps/web/src/evaluation/fixtures.ts` | Fixed ids, fake clock/id-gen, `longSessionMemoryFixture`, `syntheticEventStream`, planted-marker helpers. No runtime imports beyond what tests already legally import (domain, memory services, in-memory stores, generation prompt builder, app orchestrators). |
| `apps/web/src/evaluation/promptBudget.eval.test.ts` | Gate A. |
| `apps/web/src/evaluation/relevance.eval.test.ts` | Gate B (incl. the calibrated plateau/tie-break case). |
| `apps/web/src/evaluation/dedupeFlood.eval.test.ts` | Gate C. |
| `apps/web/src/evaluation/scopeStability.eval.test.ts` | Gate D. |
| `apps/web/src/evaluation/logSafety.eval.test.ts` | Gate E (log sweep across the suite's recall/context/prompt/promotion/save-load flows). |
| `apps/web/src/evaluation/noSideEffects.eval.test.ts` | Gate F (side-effect snapshot checks + no-network guard). |
| `docs/architecture/decisions/ADR-0074-long-session-memory-evaluation-v0.md` | Closeout ADR (slice 4). |
| `docs/architecture/ARCHITECTURE.md` | One status-list entry at closeout (slice 4), same shape as the ADR-0072 entry. |

> As-built note (2026-07-03): Gates E and F ship as two files
> (`logSafety.eval.test.ts`, `noSideEffects.eval.test.ts`) rather than the single
> `evalSideEffects.eval.test.ts` sketched above, and Gate B's file is
> `relevance.eval.test.ts`. The shared Slice-2 `fixtures.ts` was extended
> (test-only) with the Gate B/D/E/F harnesses, scopes, and log-sweep helpers.

**Not changed:** any file under `src/` outside `src/evaluation/`; any config
(`tsconfig`, ESLint, Vite, `package.json`); any schema; any doc other than the
two closeout entries. Zero overlap with the in-flight
`generated-per-room-objective-save-load-v0` diff (`App.helpers.ts`,
`generatedRoomCacheSaveState.*`).

### Minimum Safe Change Check

- **Reused:** `InMemoryRoomMemoryStore`/`InMemoryNpcMemoryStore`, the real
  `RoomMemoryService`/`NpcMemoryService`, `rankMemories`,
  `recallRoomMemoryContext`, `buildDialoguePromptMessages` (real prompt
  builder, `generation/llmDialoguePrompt.ts:32`),
  promotion helpers, ADR-0070 save-state functions, redteam fixture helpers,
  existing fake clock/id-gen test patterns.
- **New code:** one fixtures module + five test files. No new runtime code,
  no new abstractions, no new dependencies.
- **Safety boundaries unchanged:** memory firewall, recall caps, prompt caps,
  logging redaction, authority rules — all merely *asserted*, never touched.
- **Targeted tests:** the feature *is* its tests (§4).

## 7. Slice breakdown

1. **Slice 1 — this docs plan.** ✅ Done. Review/approval checkpoint. No code.
2. **Slice 2 — fixtures + budget/dedupe core.** ✅ Done. `fixtures.ts`,
   `promptBudget.eval.test.ts` (Gate A), `dedupeFlood.eval.test.ts` (Gate C).
   The volume machinery lands here and everything else reuses it.
3. **Slice 3 — relevance + scope stability.** ✅ Done.
   `relevance.eval.test.ts` (Gate B),
   `scopeStability.eval.test.ts` (Gate D — including the Risk-2 primary
   assertion).
4. **Slice 4 — sweeps + closeout.** ✅ Done. `logSafety.eval.test.ts` (Gate E),
   `noSideEffects.eval.test.ts` (Gate F), closeout
   [ADR-0074](../decisions/ADR-0074-long-session-memory-evaluation-v0.md), one
   `ARCHITECTURE.md` status entry.

Each slice is independently green and independently revertable.

## 8. Verification commands

From `apps/web`:

```bash
npm run test -- evaluation     # the new suite only (targeted-first)
npm run test -- memory         # prove no regression in existing memory tests
npm run lint
npm run build                  # tsc -b covers test files; proves no runtime reach
```

Full `npm run test` once at each slice's end (the suite is additive; the full
run guards against fixture imports accidentally disturbing shared test state).

## 9. Risks / overbuilding traps

- **Tautological thresholds.** Asserting `x <= IMPORTED_CONSTANT` proves
  nothing. Mitigation: absolute literals mirroring today's values (§4 stance),
  each annotated with the constant name it mirrors.
- **Fixing the plateau instead of measuring it.** Gate B will show the ranker
  can't distinguish same-kind/same-room flood from a planted record. The trap
  is "just tweak a weight while we're here" — that is a runtime algorithm
  change and out of scope. The calibrated case documents the ceiling; a
  future retrieval feature flips it.
- **Perf-benchmark creep.** "1000 events → prompt still small" is a *size*
  gate. Adding timing assertions makes CI flaky on slow runners; adding a
  bench framework violates the dependency guardrail. Explicit non-goal.
- **Fixture realism drift.** Hand-built records that bypass the firewall could
  assert bounds the runtime never sees. Mitigation: fixtures write through the
  real `remember` path (§5); direct store seeding is allowed only for decoy
  scopes where the firewall would rightly reject cross-scope drafts.
- **Suite runtime bloat.** N=1000 through in-memory stores is milliseconds,
  but nested N×M matrices are not. Keep one large-N case per gate; everything
  else runs at small N.
- **Cross-suite coupling.** Decided (§12): only the two tiny generic helpers
  (`createSpyLogger`, `expectNoForbiddenMarkers`) are imported from
  `redteam/fixtures` — never attack fixtures or marker payloads. If those two
  helpers ever churn, copy them locally instead.
- **False confidence on SQLite.** This suite covers the wired browser path
  (in-memory stores). The headless SQLite memory stores are exercised by their
  own existing tests; long-session eval over SQLite/FTS is future work tied to
  the retrieval feature that would need it.

## 10. Manual smoke needs

**None.** The feature is deterministic tests only; there is no runtime surface
to drive. (Precedent: ADR-0072 shipped without a manual smoke checklist.) The
verification commands in §8 are the complete acceptance check.

## 11. Dependencies and relationship to in-flight work

- **Depends on (shipped):** ADR-0065 (memory-aware dialogue prompt), ADR-0070
  (runtime room-memory persistence), ADR-0071 (feedback — incidental),
  ADR-0072 (suite pattern), the memory ranking/recall/promotion modules.
- **No dependency on** `generated-per-room-objective-save-load-v0` (in flight,
  Codex) and no file overlap with its diff; the two can merge in either order.
- **Feeds forward:** Gate B's calibrated plateau case is the red-to-green
  target for any future retrieval-quality feature (FTS/summaries/weights);
  Gate D is the permanent guard the memory assessment (Risk 2) called for.

## 12. Open questions — resolved (maintainer review, 2026-07-03)

1. **Suite location/naming — decided:** `apps/web/src/evaluation/` with
   `*.eval.test.ts` (separate sibling of `redteam/`; keeps "adversarial" vs
   "at-scale" armor legible).
2. **N for the big fixture — decided:** N=1000 (matches the assessment's
   "1000 events" phrasing; milliseconds on in-memory stores).
3. **Cross-import of redteam fixtures — decided:** import only the tiny
   generic helpers `createSpyLogger` and `expectNoForbiddenMarkers`. Do not
   import hostile redteam attack fixtures or marker payloads (see §5, §9).

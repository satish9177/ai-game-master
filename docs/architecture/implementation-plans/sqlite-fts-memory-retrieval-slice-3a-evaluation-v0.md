# Implementation Plan — `sqlite-fts-memory-retrieval` Slice 3a (evaluation-only)

> Status: **APPROVED for docs-only save. Not yet implemented.**
>
> Scope: **Slice 3a only** — an **evaluation-only** FTS Gate B proof. This slice
> adds a Node-side (vitest/evaluation) demonstration that FTS keyword retrieval
> (`recallRelevant`) surfaces a keyword-distinct planted room memory above a
> token-lacking flood **through the dialogue-context → prompt MEMORY chain**,
> flipping the documented ADR-0074 Gate B / Risk-3 retrieval plateau from a
> locked-red target to a green FTS gate. It adds **no** runtime, browser,
> dialogue, provider, or gameplay wiring.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md).
> Parent plan: [sqlite-fts-memory-retrieval-v0](./sqlite-fts-memory-retrieval-v0.md)
> (Slice 1 + Slice 2 complete; Slice 3 gated). Roadmap context:
> [ADR-0024 npc-memory-persistence-v0](../decisions/ADR-0024-npc-memory-persistence-v0.md),
> [ADR-0025 living-world-room-memory-v0](../decisions/ADR-0025-living-world-room-memory-v0.md),
> [ADR-0074 long-session-memory-evaluation-v0](../decisions/ADR-0074-long-session-memory-evaluation-v0.md)
> (the Gate B / Risk-3 plateau this gate targets).

## 0. The one architectural fact that shapes this slice

FTS lives **only** in SQLite (`persistence/**`, Node-only). The
`SqliteRoomMemoryStore` / `SqliteNpcMemoryStore` already
`implements ...SearchStore` (`searchForRoom`/`searchForNpc`, `MATCH ? …
bm25(...) ASC, m.seq DESC, m.memory_id ASC`). The **wired browser gameplay path
uses the in-memory stores**, which do **not** implement the search port, and the
browser must never touch SQLite (hard boundary, reciprocal lint walls).

**Consequence:** `recallRelevant` in the browser is *permanently*
`{ status: 'unavailable' }` until a Node-side memory/dialogue API exists
(guardrailed, out of scope). FTS therefore cannot change any runtime browser
outcome today — the **only** place FTS retrieval can demonstrably beat the
seq-desc plateau is **Node-side (vitest/evaluation)**. This makes
"evaluation-only" not merely the safest option but the *only* one that produces
observable value now.

## 1. Goal of this slice

Prove, in the **Node-side evaluation suite only**, that FTS keyword retrieval
(`recallRelevant`) surfaces a keyword-distinct planted room memory above a
same-kind / same-confidence / same-importance flood **through the
dialogue-context → prompt MEMORY chain** — i.e., flip the documented ADR-0074
Gate B / Risk-3 retrieval plateau from a locked-red target to a green FTS gate.

Non-goals (explicit): no runtime browser/dialogue/provider behavior change;
existing `recall()` and the browser dialogue path stay byte-identical; the
existing `relevance.eval.test.ts` plateau cases remain unchanged.

## 2. Approved framing / constraints

- **Slice 3a only** — evaluation-only FTS Gate B proof.
- **No** runtime / browser / dialogue / provider / gameplay wiring.
- **No** `App.tsx` changes.
- **No** `recallRoomMemoryContext.ts` changes.
- **No** provider / LLM calls (deterministic prompt builder only).
- **No** raw query / memory / player / generated / provider text logging.
- **Closed / test-owned query tokens only** (no player utterance).
- **Room-memory gate only.**
- **NPC memory FTS gate deferred.**
- **Player-utterance tokens deferred** to a later redteam/runtime slice.
- Existing `relevance.eval.test.ts` **plateau remains unchanged**.
- The new FTS evaluation gate is **additive**.

## 3. Current call graph (context)

- **Browser dialogue context (runtime, wired — NOT touched here):**
  `App.tsx` → `recallRoomMemoryContext(scope, RoomMemoryService, logger,
  {activeNpcId, limit})` → `RoomMemoryService.recall(scope)` (seq-desc +
  `selectRecallRoomMemories` cap) → `rankMemories(...)` (pure re-order:
  importance/confidence/sameRoom/sameNpc/recency — **no semantic signal**) →
  `.slice(0, DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5)` →
  `RoomMemoryDialogueContext.entries {text, kind}` →
  `buildDialoguePromptMessages` (`MAX_MEMORY_ENTRIES = 3`, hedged `BACKGROUND
  ROOM MEMORY - NON-AUTHORITATIVE`) → real/fake `NPCDialogueProvider`.
- **Store injected in browser:** `InMemoryRoomMemoryStore` — **no** search port.
- **`recallRelevant` (Slice 2, complete):** returns `unavailable` when no
  `searchStore` injected; otherwise builds the branded `MemoryFtsQuery` via
  `createMemoryFtsQueryFromTokens`, calls `searchForRoom`, re-filters scope,
  applies `limit`/`maxChars` in incoming FTS (bm25) order.
- **FTS proof today:** `persistence/memoryFts.test.ts` proves
  relevance-over-flood at the *store* level only — not through the
  context/prompt chain.
- **Evaluation harness:** `evaluation/fixtures.ts` uses **in-memory** stores;
  `relevance.eval.test.ts` (Gate B) documents the plateau against the pure
  `rankMemories`.

## 4. Design (evaluation-only)

Add a **Node-eval-only orchestrator** that mirrors `recallRoomMemoryContext` but
drives the FTS path, plus a **SQLite-backed eval harness** that injects the real
search store. Concretely:

1. **SQLite eval harness helper** (in `evaluation/fixtures.ts` or a new
   `evaluation/ftsFixtures.ts`): build a temp-DB `SqliteRoomMemoryStore` (which
   already satisfies both `RoomMemoryStore` and `RoomMemorySearchStore`), run
   migrations incl. `0005_memory_fts`, and construct
   `RoomMemoryService(store, clock, ids, logger, store /* as searchStore */)`.
   This mirrors the established `persistence/memoryFts.test.ts` pattern — test
   files importing `persistence/**` is existing, lint-clean practice.
2. **Eval-only orchestrator** — `recallRelevantRoomMemoryContext(scope, service,
   logger, { tokens, activeNpcId, limit })`:
   - build safe tokens → `service.recallRelevant(scope, { tokens })`;
   - if `unavailable` **or** empty → fall back to `service.recall()` +
     `rankMemories` (identical to today's `recallRoomMemoryContext`);
   - map to `RoomMemoryDialogueContext.entries {text, kind}`, feed the
     **unchanged** `buildDialoguePromptMessages`.
   - **Location:** lives under `evaluation/` (or a clearly test-scoped helper
     used only by eval) so the runtime `recallRoomMemoryContext.ts` and
     `App.tsx` stay untouched.
3. **New Gate B-FTS test**: keyword-distinct planted record + token-lacking
   flood → planted ranks first in the bounded dialogue context and is the first
   prompt MEMORY line. This is the red-to-green flip of the Risk-3 plateau,
   proven end-to-end but **only in Node/eval**.

The existing `relevance.eval.test.ts` plateau tests stay **as-is** (they
honestly document that the *pure ranker* has no semantic signal). The new gate
proves the *FTS retriever* closes that gap — the two coexist without
contradiction.

## 5. Query-source design

- **Query is `{ tokens: readonly string[] }`** fed to the existing branded
  `createMemoryFtsQueryFromTokens`, which filters to `^[A-Za-z0-9]+$`, quotes
  each token, `OR`-joins, and returns `null` on empty. **This is the only value
  ever bound to `MATCH`** — the parent plan's hard rule holds unchanged.
- **v0 token source: closed / test-owned tokens only.** The gate uses an
  explicit planted keyword (and/or neutral closed room/theme/objective enum
  tokens) that the flood lacks — deterministic and non-player-controlled.
- **Player utterance: deferred** to a later redteam/runtime slice. Tokenizing
  utterance is *safe* (the builder strips to `[A-Za-z0-9]+`, neutralizing FTS
  operators and SQL risk), but retrieval-steering by raw player text is a
  memory-poisoning *surface* that warrants its own review and is out of scope
  here.
- **Raw text never reaches logs/SQL:** SQL sees only the branded expression;
  logs carry ids/enums/counts/codes only. No new content log surface.

## 6. Fallback behavior

- **FTS unavailable** (no search store): `recallRelevant` →
  `{status:'unavailable'}`; orchestrator falls back to `recall()` +
  `rankMemories` (today's exact path). Never worse than today.
- **No safe tokens** (empty/punctuation/emoji-only): builder → `null` →
  `recallRelevant` returns `{status:'recalled', memories:[]}`; orchestrator falls
  back to `recall()` (context is never emptied by a bad query).
- **No matches:** `[]` from FTS; orchestrator falls back to `recall()` — FTS is
  strictly additive, so a keyword miss degrades to seq-desc, not empty context.
- **Fall back to `recall()`? Yes**, at the orchestrator layer, explicitly —
  never silently blended inside `recallRelevant`.

## 7. Ranking / selection behavior

- **Compose, don't merge.** FTS supplies the *candidate set + bm25 order*;
  `rankMemories` is not modified and not fed an FTS score. Two clean modes:
  (a) FTS path → keep FTS/bm25 order as `recallRelevant` returns it → bound;
  (b) fallback path → `recall()` + `rankMemories` exactly as today.
- **Caps preserved.** `recallRelevant` already applies `limit`/`maxChars`
  (`selectBoundedInIncomingOrder`, defaults `DEFAULT_ROOM_RECALL_LIMIT`/
  `MAX_CHARS`). The orchestrator then `.slice(0,
  DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5)`, and the prompt builder re-caps at
  `MAX_MEMORY_ENTRIES = 3`. All three existing caps stay in force; no cap
  constant changes.

## 8. Safety and authority analysis

- **No authority change.** FTS is a derived read-index over inert memory text;
  no `WorldEvent`/`WorldCommand`/`WorldState`/`roomStates`/`SaveGame`/quest/cost
  surface is touched. `source:'llm'` records still cannot apply state changes.
- **Firewall intact.** Records come from the base table via `parseStoredMemory`
  (schema re-parse + scope re-assertion); scope stays the exact
  `(worldId, sessionId, roomId)` triple at all layers. No cross-world / session
  / room path.
- **MATCH from safe tokens only** — unchanged branded-query rule; raw text never
  reaches SQL or logs.
- **No provider / network / LLM.** Eval uses the deterministic prompt builder;
  no real provider call, no wall-clock, no `Math.random`.
- **Browser stays SQLite-free.** All new code is Node-eval/persistence-side;
  reciprocal lint walls unchanged; `App.tsx`/renderer/UI untouched.

## 9. Files likely to change (all additive, Node/test-only)

New:

- `apps/web/src/evaluation/relevanceFts.eval.test.ts` — the Gate B-FTS flip and
  degradation gates.
- Eval-only orchestrator `recallRelevantRoomMemoryContext` (in `evaluation/` or
  a test-scoped helper) + a SQLite-backed eval harness (new
  `evaluation/ftsFixtures.ts` or an additive helper in
  `evaluation/fixtures.ts`).

Possibly touched (test infra only):

- `apps/web/src/evaluation/fixtures.ts` — add a SQLite + search-store harness
  builder, mirroring `memoryFts.test.ts`.

## 10. Files that must NOT change

`recallRoomMemoryContext.ts`, `App.tsx`, `RoomViewer.tsx`,
`NpcMemoryService.ts` / `RoomMemoryService.ts` (`recall`, `recallRelevant`,
caps), `domain/memory/ranking.ts`, `domain/memory/ftsQuery.ts`, the search
ports, the SQLite stores/adapters, migrations,
`generation/llmDialoguePrompt.ts` (caps/hedge/header),
`contracts.ts` / `roomContracts.ts` / `firewall.ts` / `roomFirewall.ts`, the
existing `relevance.eval.test.ts` plateau cases, `eslint.config.js`,
`package.json`, renderer, `server/**`,
`SaveGame` / `WorldState` / `RoomSpec` / `QuestSpec`.

## 11. Existing code to reuse

- `SqliteRoomMemoryStore` (already implements `RoomMemorySearchStore`), the
  migration runner + `0005_memory_fts`, `createTestDb`/temp-DB harness from
  `persistence/memoryFts.test.ts`.
- `RoomMemoryService.recallRelevant` + `createMemoryFtsQueryFromTokens`
  (Slice 2).
- `rankMemories` (fallback path), `buildDialoguePromptMessages` +
  `MAX_MEMORY_ENTRIES`, `RoomMemoryDialogueContext`.
- Eval fixtures/log-safety helpers: `createSpyLogger`,
  `expectNoRawMemoryTextInLogs`, `expectNoEvalMarkersInLogs`,
  `expectSafeLogContextValues`, `memorySectionLines`, `evalDialogueRequest`,
  the real `remember` firewall path.

## 12. Minimum new code needed

- 1 SQLite-backed eval harness helper.
- 1 eval-only orchestrator (`recallRelevantRoomMemoryContext`) with explicit
  `recall()` fallback.
- 1 new eval test file (Gate B-FTS flip + degradation gates).

No new runtime dependency; no runtime source file touched.

## 13. Tests to add

- **Gate B-FTS (new):** planted keyword-distinct record + N-record
  token-lacking flood, recorded via the real `remember` firewall into a SQLite
  store → `recallRelevantRoomMemoryContext` → planted is the first context entry
  and the first prompt MEMORY line. Red-to-green plateau flip, Node-only.
- **Degradation gates:** empty/punctuation tokens → fallback to `recall()`
  (context not emptied); no-match → fallback; `unavailable` (in-memory store) →
  identical to today's `recallRoomMemoryContext`.
- **Log-safety:** reuse `expectNoRawMemoryTextInLogs` /
  `expectNoEvalMarkersInLogs` / `expectSafeLogContextValues` over the new path.
- **Do not touch:** existing `relevance.eval.test.ts` plateau assertions,
  `promptBudget` constants canary, `memoryFts.test.ts`.

## 14. Verification commands (from `apps/web`)

```bash
npm run test -- relevanceFts     # new Gate B-FTS end-to-end flip
npm run test -- evaluation       # full long-session suite (plateau gates stay green)
npm run test -- memoryFts        # store-level FTS (regression)
npm run test -- memory           # services incl. recallRelevant (regression)
npm run lint                     # boundary/firewall/no-console walls; browser stays SQLite-free
npm run build                    # typecheck + browser bundle SQLite-free
```

Report results honestly. The maintainer commits manually (agents do not commit).

## 15. Implementation sub-slices

1. **3a.1 — SQLite eval harness:** temp-DB + migrations + `RoomMemoryService`
   with injected search store; log-safe.
2. **3a.2 — eval orchestrator:** `recallRelevantRoomMemoryContext` (FTS-first,
   `recall()` fallback) feeding the unchanged prompt builder.
3. **3a.3 — Gate B-FTS test + degradation gates**; confirm existing suite stays
   green.

## 16. Deferred (out of this slice)

- **NPC memory FTS gate** — a fast follow once the room gate lands.
- **Player-utterance tokens** — deferred to a later redteam/runtime slice under
  the memory-poisoning lens.
- **Runtime-gated wiring** (`recallRelevant`-first in `recallRoomMemoryContext`,
  browser byte-identical via fallback) — only after a Node-side memory/dialogue
  API exists; in the browser it can never activate today (no backend →
  `unavailable` → fallback), so it would add fallback-regression risk for zero
  behavior change.

## 17. Open questions before implementation

- **Q1 — Location of the eval orchestrator:** under `evaluation/` (keeps runtime
  `app/` fully untouched — recommended) vs. a test-scoped `app/` helper.
  Recommend `evaluation/`.
- **Q2 — Query token source for the gate:** an explicit planted keyword the
  flood lacks (recommended) vs. neutral closed room/theme/objective enum tokens.
  Recommend an explicit planted keyword.
- **Q3 — FTS ordering into the gate:** assert on bm25 order as returned by
  `recallRelevant` (recommended, isolates the retrieval win) vs. re-passing
  through `rankMemories`. Recommend bm25 order.
- **Q4 — Confirm no runtime file touch this slice** (`recallRoomMemoryContext.ts`,
  `App.tsx` frozen). Recommend yes.

## Minimum Safe Change Check

- **Reused:** `SqliteRoomMemoryStore`/search port, migration `0005_memory_fts`,
  the temp-DB harness pattern, `recallRelevant` + `createMemoryFtsQueryFromTokens`,
  `rankMemories` (fallback), `buildDialoguePromptMessages`, the eval
  fixtures/log-safety helpers, the real `remember` firewall.
- **New code actually necessary:** 1 SQLite eval harness helper, 1 eval-only
  orchestrator with `recall()` fallback, 1 new eval test file.
- **Safety boundaries unchanged:** firewall (no truth path), single
  firewall-validated ingestion, MATCH-from-safe-tokens-only, existing
  recall/write path, record schemas + `schemaVersion=1`, Node-only persistence +
  browser SQLite exclusion, logging redaction, no provider/network. No runtime
  source file touched.
- **Tests that prove it:** §13 (Gate B-FTS flip, degradation/fallback,
  log-safety), with the existing plateau + constants canary left green.

## Review notes / risk

The most important boundary call is **not** wiring FTS into
`recallRoomMemoryContext`/`App.tsx` this slice — in the browser it can never
activate (no backend) and would only add fallback-regression risk. Keeping
Slice 3a evaluation-only proves the retrieval win where it can actually run,
leaves existing `recall()` and the browser dialogue path byte-identical, and
gives the future backend slice a green, tested target. The existing
`relevance.eval.test.ts` plateau stays unchanged; the new FTS gate is strictly
additive.

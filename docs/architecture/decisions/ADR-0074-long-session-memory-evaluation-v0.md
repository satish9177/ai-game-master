# ADR-0074: Long-Session Memory Evaluation v0

- **Status:** Accepted - Implemented
- **Date:** 2026-07-03
- **Deciders:** Project owner
- **Extends:**
  [ADR-0024](./ADR-0024-npc-memory-persistence-v0.md),
  [ADR-0025](./ADR-0025-living-world-room-memory-v0.md),
  [ADR-0065](./ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md),
  [ADR-0070](./ADR-0070-runtime-room-memory-persistence-v0.md),
  [ADR-0072](./ADR-0072-memory-poisoning-redteam-v0.md).

> Full implementation closeout lives in
> [`long-session-memory-evaluation-v0`](../implementation-plans/long-session-memory-evaluation-v0.md).

---

## Context

Every memory boundary shipped so far is tested at small scale: a handful of
records, one scope, one recall. Nothing proved the system's behavior over a
**long session** — hundreds to ~1000 events/memories — where three known risks
live: prompt-budget creep, the deterministic retrieval plateau (assessment
Risk 3), and silent scope orphaning across save/load (assessment Risk 2).

This feature adds a deterministic, test-only evaluation suite that turns those
risks into red/green CI signals. Like the redteam suite (ADR-0072), it is
regression armor over **existing** behavior. It changes no runtime code and
asserts only the limits already in source.

---

## Decision

Add a dedicated `apps/web/src/evaluation/` suite (sibling of `redteam/`) whose
`*.eval.test.ts` files pin the at-scale memory boundaries. Only the two generic
helpers `createSpyLogger` and `expectNoForbiddenMarkers` are reused from
`redteam/fixtures`; no hostile attack fixtures or marker payloads are imported.

Gates covered:

- **Gate A — prompt-context budget under load.** At N=1000, room recall stays
  ≤ 8 records / ≤ 600 chars, dialogue context ≤ 5 entries, the prompt MEMORY
  section ≤ 3 lines × 160 chars, and the composed prompt length is byte-identical
  at N=50 vs N=1000; NPC recall holds ≤ 8 / ≤ 600 as the headless secondary case.
- **Gate B — relevance with planted memories.** `rankMemories` ranks a
  distinguishable planted record (higher importance/confidence, same-room, or
  same-NPC) first, and that record survives recall → context → the prompt MEMORY
  section. The **calibrated honesty case** locks the retrieval plateau: when the
  planted record and the flood share kind/confidence/importance and differ only
  by content text, the ranker *cannot* prefer it (no semantic match), and the
  documented tie-break (`seq` desc → `memoryId` asc) is asserted exactly. The
  gate does **not** pretend semantic matching exists; it makes the plateau a
  red-to-green target for a future retrieval feature.
- **Gate C — dedupe under flood.** 200 same-`dedupeKey` `remember` calls store
  one record; repeated promotion events collapse to one promotion per distinct
  key; below-floor events never promote; post-flood the Gate A bounds still hold.
- **Gate D — scope-triple stability across save/load.** The world-session
  save/load round-trip keeps `worldId`/`sessionId` identical into a fresh store
  (the Risk-2 primary assertion). The ADR-0070 memory sidecar round-trip restores
  exactly the in-scope records and leaks zero cross-world / cross-session /
  cross-room decoys; the deterministic caps (8/room, 128 total) hold
  byte-identically; and the whole cycle is read-only (no `WorldEvent`, no
  `WorldState` change).
- **Gate E — count-only diagnostics / no-leak log sweep.** All flows run under
  spy loggers with unique markers embedded in memory text, player-like input, and
  provider-looking strings; no captured log string contains a marker or raw
  memory text, and every logged context value is a primitive
  (id/enum/count/code/boolean).
- **Gate F — no side effects.** Recall/context/prompt at N=1000 append zero
  `WorldEvent`s, leave `WorldState` deep-equal, cause zero memory writes, and make
  no provider/network call (a stubbed `fetch` is never hit).

Per §4 of the plan, gate thresholds are **absolute literals equal to today's
constants**, not imports of the constants (importing would make the gates
tautological). A single **constants canary** in `promptBudget.eval.test.ts`
imports each source constant and asserts it still equals the literal the gates
use, so a deliberate cap change fails in one named place that points the changer
at this suite.

---

## Findings

No runtime behavior gap was found. All gates pass against the current
implementation, so this feature records the existing boundaries as regression
armor rather than introducing fixes.

One measured limitation is **recorded, not fixed**: Gate B's calibrated case
demonstrates the deterministic retrieval plateau (assessment Risk 3). Recall
orders by `seq` desc and ranking has no semantic signal, so an
indistinguishable planted record cannot be preferred over recency/flood — the
gate locks *what the plateau looks like* today. Closing it (weight tuning, FTS,
summaries) is a separate, maintainer-approved retrieval feature and is
explicitly out of scope here.

---

## Files

- `apps/web/src/evaluation/fixtures.ts` (extended in this slice)
- `apps/web/src/evaluation/promptBudget.eval.test.ts` (Gate A, prior slice)
- `apps/web/src/evaluation/dedupeFlood.eval.test.ts` (Gate C, prior slice)
- `apps/web/src/evaluation/relevance.eval.test.ts` (Gate B)
- `apps/web/src/evaluation/scopeStability.eval.test.ts` (Gate D)
- `apps/web/src/evaluation/logSafety.eval.test.ts` (Gate E)
- `apps/web/src/evaluation/noSideEffects.eval.test.ts` (Gate F)

No production source file changed; the only edits outside `src/evaluation/` are
this ADR, the implementation plan, and the ARCHITECTURE.md status entry.

---

## Verification

Automated verification performed:

```bash
npm.cmd run test -- evaluation
npm.cmd run test -- memory
npm.cmd run lint
npx.cmd tsc --noEmit -p tsconfig.app.json
```

The evaluation (26 tests), memory (310 tests), and lint runs passed. The
`tsconfig.app.json` typecheck failed only on the pre-existing baseline errors in
`assembleRoom.test.ts`, `ensureGeneratedNpcPresence.ts`, and
`OpenAICompatibleNPCDialogueProvider.test.ts`; no error referenced any
`src/evaluation/` file.

---

## Consequences

Future memory, ranking, recall, prompt, save/load, and logging changes now have
a named at-scale evaluation suite that fails loudly if they weaken the budget,
scope-stability, or logging boundaries. Gate B's calibrated plateau case is the
permanent red-to-green target for a future retrieval-quality feature; Gate D is
the permanent guard the memory assessment (Risk 2) called for. Any confirmed gap
should be handled as its own maintainer-approved fix feature, not patched
opportunistically inside this test suite.

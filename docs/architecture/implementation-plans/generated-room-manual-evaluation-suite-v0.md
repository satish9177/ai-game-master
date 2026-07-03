# Implementation Plan — `feature/generated-room-manual-evaluation-suite-v0`

> Status: **Docs-only design plan. No implementation approved yet.**
> This file is the whole deliverable for this slice: a *design* for a manual
> evaluation suite for generated rooms. It changes **no** runtime code, edits
> **no** runtime files, adds **no** tests, and makes **no** provider/LLM call.
> It is the gate we run generated rooms through *before*
> `generated-room-demo-polish-pass-v0` and open-source launch.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md).
>
> Direct precedents this plan mirrors:
> - [`long-session-memory-evaluation-v0`](./long-session-memory-evaluation-v0.md) /
>   [ADR-0074](../decisions/ADR-0074-long-session-memory-evaluation-v0.md) — the
>   test-only `apps/web/src/evaluation/` suite pattern (sibling of `redteam/`)
>   that the *optional automated backing* here would extend.
> - [`npc-local-wander-v0`](./npc-local-wander-v0.md) — the last-shipped NPC
>   movement feature whose §8 manual smoke this suite folds into a standing
>   rubric; its "no regression to movement-stack safety" is a hard invariant below.
>
> Global invariants for THIS slice: docs-only; no runtime behavior change; no
> provider/LLM call during design; no `RoomSpec`/`LoadedRoom`/`WorldState`
> mutation; no `WorldEvent` outside an existing tested gameplay flow; no
> save/load schema change; no memory writes; no gameplay-authority change; no
> generated-room behavior change; no visual-polish implementation.

---

## 1. Goal and non-goals

### Goal

Give the maintainer a **repeatable, low-effort way to inspect, score, and
smoke-test generated-room quality** before demo polish and open-source launch,
so "the generated rooms are good enough to show" becomes a checklist result
instead of a vibe. The suite must cover both the **objective** properties the
pipeline already guarantees (no fatal room, exits ensured, budgets held) and
the **subjective** properties only a human can judge (does the room *read* as a
place, is the NPC believable, is the objective clear).

The suite evaluates, per generated room:

- generated room visual quality
- object placement quality
- room composition (readable zones / focal anchor)
- NPC presence
- NPC idle / wander behavior
- objective clarity
- interaction availability
- exits / navigation
- save/load persistence where relevant
- generated-room consistency after reload / return
- no broken or overlapping critical objects
- no blocked exits
- no unreachable NPC / interactable
- no provider / log / memory leakage
- no unsafe mutation of `RoomSpec` / `WorldState`
- no regression to the NPC movement-stack safety contract

### Non-goals

- ❌ No fix to any quality problem the suite surfaces. The suite *finds and
  scores*; every fix belongs to `generated-room-demo-polish-pass-v0` or a later
  feature. Finding "the throne overlaps the altar" here does not authorize
  editing composition here.
- ❌ No new runtime behavior, config, schema, dependency, or logging surface.
  Any code that ships from later slices is **test/fixture/docs only**, living
  under `apps/web/src/evaluation/` exactly like ADR-0074.
- ❌ No real provider/LLM/network call *inside the automated backing*. The
  deterministic `FakeRoomGenerator` is the automated evaluation target; the
  **real** provider is exercised only by the human, manually, using a dev-only
  BYOK `.env.local` they already own (never in CI, never committed).
- ❌ No benchmark/timing gate (flaky; forbidden by ADR-0074 precedent). "Budget"
  means object/exit/skip *counts*, never wall-clock.
- ❌ No screenshot-diff / pixel-regression tooling, no headless-browser harness,
  no Playwright/Puppeteer dependency. Screenshots are human-captured evidence,
  not an automated oracle.
- ❌ No scoring dashboard, DB, or telemetry. Scores live in a markdown template
  the maintainer fills in per run.

---

## 2. Current repo facts to verify before implementation

Verified against source while writing this plan; **re-verify at implementation
time** because the generated-room pipeline moves quickly.

- **Assembly pipeline & safe diagnostics.** `domain/assembleRoom.ts` runs the
  full generated-room pipeline (`assembleRoom(rawText, fallbackRoom, options)`)
  and returns `{ room: LoadedRoom, diagnostics: RoomDiagnostics }`. Every
  objective property this suite scores already has a **safe boolean/count/enum**
  diagnostic — no new observability is needed:
  - `provenance` (`generated` | `repaired` | `fallback`) + optional `failedStage`
  - `objectsRepaired`, `spawnRepaired`, `exitsRepaired`, `exitNavigationEnsured`
  - `composed`, `lacksAnchor`, `lacksInteractable`
  - `npcInserted`, `npcDialogueNormalizedCount`
  - `objectiveTargetEnriched`, `mechanicalGateAvailable`
  - `skippedObjectCount`, `skippedObjectReasonCounts`, `warningCount`
  - `displayTextSanitized` / `displayTextSanitizationCount`
  These are already documented as *safe to log/surface* and **never** carry raw
  JSON, prompt/story text, object names, or free-form errors (`assembleRoom.ts`
  header + per-field docs).
- **Semantic playability boundary.** `domain/validateRoom.ts` (`validateRoom`)
  is the fatal/warning oracle; `assembleRoom` guarantees a zero-fatal room. The
  automated backing asserts `validateRoom(assembled.room).ok === true` and reads
  warning codes, never re-implementing playability rules.
- **Deterministic generator.** `generation/FakeRoomGenerator.ts` is pure: seed
  string → seeded PRNG (`generation/prng.ts`) → RoomSpec data, byte-identical
  per seed. This is the automated evaluation target (no network, no key).
- **Real generator (manual only).** `generation/OpenAICompatibleRoomGenerator.ts`
  behind the unchanged `RoomGenerator` port, selected by
  `app/selectRoomGenerator.ts` only when `app/llmConfig.ts` reads a complete
  dev-only/BYOK config. Manual evaluation of *real* rooms uses `npm run dev` with
  the maintainer's own `.env.local`.
- **Composition & anchors.** `domain/generatedRoomComposition.ts`
  (`composeGeneratedRoom`) derives the single story anchor from validated
  `RoomObject.type` only; `lacksAnchor` / `lacksInteractable` are the readable
  diagnostics.
- **NPC presence & dialogue.** `domain/ensureGeneratedNpcPresence.ts`
  (`ensureGeneratedNpcPresence`, `ensureGeneratedNpcDialogue`) guarantees a
  talkable generated NPC with a collision-safe id and closed-table dialogue.
- **NPC movement stack (must not regress).**
  `domain/npcMovementContract.ts` (frozen rules),
  `renderer/engine/npc/wanderStep.ts` (pure step advance),
  `renderer/engine/npc/WanderMotor.ts` (engine motor). Presentation-only: writes
  THREE transforms + the engine `Interactable.position` view-model, **never**
  `LoadedRoom.objects[].position` / `WorldState` / events / save blobs. The
  contract already guarantees "never blocks exit arches" via exclusion discs +
  ≤0.4 m segment sampling. This suite *observes* that guarantee; it does not
  re-implement or weaken it.
- **Notice UI.** `app/fallbackNotice.ts` (`FALLBACK_NOTICE`,
  `shouldShowFallbackNotice`) — `App.tsx` shows the static prompt-free notice for
  `repaired`/`fallback`, nothing for `generated`. A clean room shows no notice;
  this is an evaluation signal, not something to change.
- **Existing test-only evaluation home.** `apps/web/src/evaluation/` already
  exists (`fixtures.ts` + six `*.eval.test.ts` from ADR-0074). Any automated
  backing slots in here as new `*.eval.test.ts` files; **do not** disturb the
  memory eval files.
- **Run/verify.** `apps/web/package.json`: `dev` = `vite`, `test` =
  `vitest run --passWithNoTests`, `lint`, `build` = `tsc -b && vite build`.
  Targeted tests: `npm run test -- <name>`.

**To confirm at implementation time:** exact current `RoomDiagnostics` field set
(fields are added often); the current fake generator's seed → vocabulary
coverage (so the curated seed list actually exercises anchors/NPC/exit paths);
whether `objectivesPerRoom`/objective enrichment is on the path the human runs;
and that no in-flight branch is mid-change to `assembleRoom`.

---

## 3. Manual evaluation rubric

One row per dimension. The human scores each **0 / 1 / 2** (fail / weak / good)
against the observation. Objective rows also have an **automated backstop**
(§7) that must be green before a room is worth human scoring; subjective rows
are human-only. A room's run is recorded in the §6 template.

| # | Dimension | What "good" (2) looks like | Type |
| --- | --- | --- | --- |
| R1 | Visual quality | Objects read as intentional props, not placeholder cubes; no stray mystery-markers dominating the view | Subjective |
| R2 | Object placement | No overlapping/interpenetrating props; nothing clipping walls or floating; footprints look sane | Subjective + backstop (`objectsRepaired` observed, no skipped-critical) |
| R3 | Room composition | A clear focal anchor; clutter reads as zones; central path walkable | Subjective + backstop (`composed`, `lacksAnchor=false`) |
| R4 | NPC presence | Exactly the expected NPC(s) present, on the floor, not in a wall/exit | Subjective + backstop (`npcInserted` / NPC count) |
| R5 | NPC idle/wander | NPC breathes and takes slow tethered steps; pauses; never darts or blocks the exit | Subjective + backstop (contract sweep already covers safety) |
| R6 | Objective clarity | The room's objective/purpose is legible from what's on screen + objective UI | Subjective + backstop (`objectiveTargetEnriched` where expected) |
| R7 | Interaction availability | At least one usable interactable; talk prompt appears near the NPC | Subjective + backstop (`lacksInteractable=false`) |
| R8 | Exits / navigation | At least one exit, wall-mounted, reachable; walking into it navigates | Subjective + backstop (`exitNavigationEnsured=true`) |
| R9 | Save/load persistence | Save → Load restores the same generated room/objective; no error, no notice churn | Subjective + backstop (existing save/load tests) |
| R10 | Reload/return consistency | Re-entering or reloading yields the same room (determinism); wander restart is expected | Subjective + backstop (fake determinism assertion) |
| R11 | No broken/overlapping critical objects | NPC, objective target, exit arch, and interactables all present and distinct | Backstop-primary (skipped-critical = 0) + Subjective |
| R12 | No blocked exits | No prop or NPC standing on/inside an exit arch footprint | Backstop-primary (contract exclusion) + Subjective |
| R13 | No unreachable NPC/interactable | Player can walk adjacent to every NPC/interactable and trigger it | Subjective + backstop (spawn/placement in bounds) |
| R14 | No provider/log/memory leakage | No prompt text, room/object/NPC names, generated JSON, or memory text in console/logs | Backstop-primary (log sweep) + Subjective |
| R15 | No unsafe RoomSpec/WorldState mutation | Objective properties come only from diagnostics; the run appends no unexpected events | Backstop-primary (side-effect snapshot) |
| R16 | No movement-stack regression | Wander stays inside the safety contract; exits never blocked; talkability follows the NPC | Backstop-primary (contract + motor tests) + Subjective |

**Scoring roll-up:** a room **passes** the run only if every backstop-primary
row (R11, R12, R14, R15, R16) is green **and** no subjective row scores 0 (see
§6 pass/fail). Weak (1) rows are logged as demo-polish candidates.

---

## 4. Evaluation scenarios / prompts

Two tiers. The **deterministic tier** is the automated backstop input and the
reproducible manual baseline; the **exploratory tier** is human-only real-provider
inspection.

### Tier 1 — Deterministic seed set (fake generator, reproducible)

A small, curated, **fixed** list of prompt strings / world-bible seeds chosen to
exercise each dimension. Because `FakeRoomGenerator` is seed-deterministic, each
entry always yields the same room, so both the human and CI look at the same
thing. Proposed coverage (finalize against actual fake-generator vocabulary at
implementation):

1. **Baseline keep** — `fantasy-keep` theme, expects anchor + NPC + exit +
   interactable (exercises R1–R8 happy path).
2. **Post-apoc** — `post-apoc` theme, expects `machine`/`corpse` anchor bias
   (exercises theme vocabulary + composition).
3. **Anchor-light** — a seed that lands `lacksAnchor=true` (benign) to confirm
   the suite scores "no focal anchor" as a *weak*, not a *fail*.
4. **Objective-per-room** — a seed run with objective enrichment on, to score R6.
5. **NPC-request** — a seed with `requestsNpc` true, to score R4/R5/R7.
6. **Multi-room** — a seed plus one adjacent generated room, to score R8–R10 and
   bidirectional return.

The exact seed strings live in the suite's fixture module (Tier-1 is data, not
prose) and are enumerated in the §6 template so a run is traceable.

### Tier 2 — Exploratory real-provider prompts (human, dev-only)

A short hand-run list the maintainer types into the PromptBar under `npm run dev`
with their BYOK `.env.local`. These are **not** in CI and **not** committed with
keys. Example intents (not fixed): "a flooded throne room", "an abandoned
research lab", "a shrine with a single guardian". Purpose: catch quality issues
the fake generator can't produce (odd real-model object mixes, long names,
overlapping props) and score the subjective rows against real output.

---

## 5. Screenshot / observation checklist

Human evidence captured per room during a manual run. Screenshots are stored by
the maintainer alongside the filled §6 template (their choice of location — not
committed to the repo unless the maintainer decides). Each numbered item maps to
rubric rows:

1. **Entry view** — the room as first seen at spawn (R1, R2, R3).
2. **Anchor close-up** — the focal object, if any (R3, R6).
3. **NPC at rest** — NPC idle, floor ring visible (R4, R5).
4. **NPC mid-wander** — NPC stepped away from home; talk ring/prompt still on it
   (R5, R7, R13, R16).
5. **Exit(s)** — each exit arch, wall-mounted, unobstructed (R8, R12).
6. **Objective UI** — objective/journal panel for the room (R6).
7. **Interaction open** — one interactable panel open (R7).
8. **Notice state** — presence/absence of `FALLBACK_NOTICE` (a clean generated
   room shows none; a repaired/fallback room shows the static notice) (R11).
9. **Save→Load** — same room after a reload cycle (R9, R10).
10. **Console tail** — the dev console showing only safe count/enum/boolean log
    lines, no names/prompt/JSON (R14).

Non-screenshot observations to note in the template: wander felt calm vs. darty;
any flicker in the nearest-interactable prompt; any prop that looked broken.

---

## 6. Pass/fail criteria

Recorded per room in a markdown run template (proposed
`docs/evaluation/generated-room-run-<date>.md`, or a scratch file — the template
shape ships with the suite; individual runs are the maintainer's artifacts, not
required commits).

A single room-run result is one of:

- **PASS** — every backstop-primary row (R11, R12, R14, R15, R16) is green **and**
  no subjective row scored 0 **and** `validateRoom(room).ok === true` **and**
  provenance is `generated` or a *benign* `repaired` (spawn/budget) with the
  expected notice. Weak (1) rows are allowed and are logged as polish candidates.
- **WEAK** — all backstops green but one or more subjective rows scored 0 (e.g.
  visually placeholder-heavy). Not launch-ready; feeds `demo-polish-pass`.
- **FAIL** — any backstop-primary row red: a skipped *critical* object, a blocked
  exit, an unreachable NPC/interactable, any leakage in the log sweep, any
  unexpected `WorldState`/event mutation, or any movement-contract violation.
  A FAIL is a **bug**, escalated immediately — not a polish item.

**Suite-level gate for launch readiness:** the Tier-1 deterministic set produces
**zero FAIL** and the maintainer judges the WEAK count acceptable for demo. This
is the human sign-off `generated-room-demo-polish-pass-v0` builds on.

---

## 7. Whether this is docs checklist / test fixture / manual harness / combination

**Combination — a docs checklist as the primary deliverable, with a thin
test-only automated backstop, and a manual dev run for the subjective/real
tier.** Rationale via the Minimum Safe Change ladder (AGENTS.md):

- **Docs checklist (primary, this feature's core).** The rubric (§3), scenarios
  (§4), observation checklist (§5), pass/fail (§6), and run template. This is
  where the human-only dimensions (visual quality, believability, clarity) live
  — no code can score them. Pure markdown, zero runtime risk.
- **Test-only automated backstop (secondary, optional slice).** A small set of
  `*.eval.test.ts` files under the **existing** `apps/web/src/evaluation/` that
  drive `FakeRoomGenerator → GeneratedRoomSource/assembleRoom` over the Tier-1
  seeds and assert the *objective* rows (no fatal, exits ensured, no
  skipped-critical, budgets held, determinism, log-sweep, no side effects). This
  reuses the ADR-0074 pattern exactly (fake clock/id, spy logger,
  `expectNoForbiddenMarkers`) and is deterministic, offline, and adds no runtime
  code. It makes the objective rubric rows a red/green CI signal so the human
  only spends attention on the subjective rows.
- **Manual dev harness (thin, no new tooling).** "Run `npm run dev`, type the
  Tier-2 prompts, capture the §5 screenshots" — an *instruction sequence*, not a
  built harness. **No** headless browser, screenshot-diff, or new dependency.

**Rejected (overbuild):** a screenshot-diff pipeline, a Playwright harness, a
scoring DB/dashboard, a dev-only in-app diagnostics overlay (a runtime change,
explicitly deferred — see §13), and importing the pipeline constants into the
backstop assertions (tautological — literals mirror the constants, per ADR-0074).

---

## 8. Smallest safe implementation slices

Each slice is independently reviewable, independently revertable, and green on
its own. Slice 1 is this document.

- **Slice 1 — Docs plan (this file).** Design/approval checkpoint. No code.
  Commit: `docs: plan generated room manual evaluation suite v0`.
- **Slice 2 — Rubric + run template (docs).** Add the standing rubric, scenario
  list, observation checklist, pass/fail, and a fill-in run template as
  committed docs (proposed `docs/evaluation/`). Pure markdown. This is the
  minimum shippable manual suite — usable with zero test code.
  Commit: `docs: generated room manual evaluation rubric + run template`.
- **Slice 3 — Deterministic backstop fixtures + happy-path gate (test-only).**
  Under `apps/web/src/evaluation/`: a `generatedRoomEval` fixture (Tier-1 seeds
  → fake generator → `assembleRoom`) and one `*.eval.test.ts` asserting the
  objective happy-path rows (zero fatal, `exitNavigationEnsured`, NPC present,
  no skipped-critical, budgets held) across the seed set. No runtime change.
  Commit: `test(evaluation): generated room objective backstop v0`.
- **Slice 4 — Safety backstops + closeout (test-only + docs).** Add the
  log-sweep (R14), side-effect/no-mutation snapshot (R15), determinism/reload
  (R10), and a movement-stack-regression re-assertion pointer (R16) as further
  `*.eval.test.ts`; wire the backstop results into the rubric's "backstop"
  column; add closeout status to this plan and (if the maintainer wants one, per
  ADR-0074 precedent for test-only armor) an ADR + one `ARCHITECTURE.md` status
  line. Commit: `test(evaluation): generated room safety backstops + closeout`.

Slices 3–4 are **optional relative to Slice 2**: the manual suite is complete
and usable after Slice 2. 3–4 exist to turn the objective rows into CI signal.

---

## 9. Files likely to be touched per slice

All new files. **No existing runtime file is edited by any slice.**

| Slice | Files |
| --- | --- |
| 1 | `docs/architecture/implementation-plans/generated-room-manual-evaluation-suite-v0.md` (this file) |
| 2 | `docs/evaluation/generated-room-evaluation-rubric.md` (new); `docs/evaluation/generated-room-run-template.md` (new) — location TBD at approval |
| 3 | `apps/web/src/evaluation/generatedRoomEvalFixtures.ts` (new); `apps/web/src/evaluation/generatedRoomObjective.eval.test.ts` (new) |
| 4 | `apps/web/src/evaluation/generatedRoomSafety.eval.test.ts` (new); `apps/web/src/evaluation/generatedRoomDeterminism.eval.test.ts` (new); this plan (status blockquote); optionally `docs/architecture/decisions/ADR-00XX-generated-room-manual-evaluation-suite-v0.md` + one `ARCHITECTURE.md` status line |

**Explicitly NOT touched:** `domain/assembleRoom.ts`, `domain/validateRoom.ts`,
`domain/generatedRoom*.ts`, `domain/ensureGeneratedNpcPresence.ts`,
`domain/npcMovementContract.ts`, `renderer/**`, `app/**`, `App.tsx`,
`generation/**`, `world-session/**`, `interactions/**`, `encounters/**`,
`dialogue/**`, `memory/**`, `persistence/**`, `server/**`, save/load modules,
the ADR-0074 memory `evaluation/*.eval.test.ts` files, `eslint.config.js`,
`tsconfig*.json`, `package.json`, any schema.

### Minimum Safe Change Check

- **Reused:** `FakeRoomGenerator`, `GeneratedRoomSource`/`assembleRoom`,
  `validateRoom`, the full `RoomDiagnostics` surface, the existing
  `apps/web/src/evaluation/` home + its spy-logger/marker helpers (ADR-0074), the
  npc-local-wander §8 smoke items, the movement contract's own sweep tests, the
  existing save/load tests. Nothing new is invented that the pipeline doesn't
  already expose.
- **New code:** two docs files (Slice 2) + up to four test/fixture files
  (Slices 3–4). Zero runtime code, zero new abstraction, zero dependency.
- **Safety boundaries unchanged:** validation, trusted renderer, generation
  trust boundary, memory firewall, authoritative-state rules, logging redaction
  — all merely *observed/asserted*, never touched.
- **Targeted tests:** the automated backstop *is* its own test (§7, §12); the
  manual rubric is verified by running it once (§11).

---

## 10. Tests required per slice

- **Slice 1 (docs):** none. Report build/test as *skipped* (docs-only).
- **Slice 2 (docs):** none (markdown). Optional: a spell/lint pass on docs only.
- **Slice 3:** `generatedRoomObjective.eval.test.ts` — over the Tier-1 seed set,
  assert per room: `validateRoom(room).ok === true`; `provenance` in
  {`generated`,`repaired`}; `exitNavigationEnsured === true`; NPC present when
  requested; `skippedObjectReasonCounts` contains **no critical-object** skips;
  object count ≤ generated-room cap; `lacksInteractable === false` on seeds that
  should have one. Thresholds are **absolute literals** mirroring the pipeline
  constants (with a one-line comment naming each), per ADR-0074 anti-tautology
  stance.
- **Slice 4:**
  - `generatedRoomSafety.eval.test.ts` — run the seed set under a spy logger;
    assert no captured log entry contains a planted marker, memory text, room/
    object/NPC name, prompt, or generated JSON (reuse
    `expectNoForbiddenMarkers`); assert assembly appends **no** `WorldEvent` and
    leaves any world-session snapshot deep-equal (R15); assert `assembleRoom`
    does not mutate its `rawText`/`fallbackRoom` inputs (reference-identity/
    deep-equal check).
  - `generatedRoomDeterminism.eval.test.ts` — the same seed assembled twice
    yields deep-equal rooms + identical diagnostics (R10).
  - **Movement-stack regression (R16):** reference/re-run the existing
    `npcMovementContract` / `wanderStep` / `WanderMotor` suites rather than
    duplicating them; add at most one thin assertion that a Tier-1 generated
    room with an NPC + exit yields a contract-valid wander field (no exit
    blocked). No engine or contract edit.

Every automated test is deterministic, offline, and adds `--passWithNoTests`-safe
files under `evaluation/`.

---

## 11. Manual smoke procedure

The suite's *own* dogfood: run the manual rubric once end-to-end to prove it's
usable (this is the acceptance check for the docs slices).

1. `cd apps/web && npm run dev`.
2. **Tier-1 (deterministic):** for each Slice-3 seed, generate via the PromptBar
   (or the documented seed entry), walk the room, and fill the §5 checklist +
   §3 rubric in the run template. Confirm each objective row matches its backstop
   result from `npm run test -- generatedRoom` (Tier-1 human and CI agree).
3. **NPC behavior:** confirm the ensured NPC breathes, takes slow tethered steps,
   pauses, never blocks the exit, and stays talkable while moving (npc-local-
   wander §8, items 1–7). Freeze-on-panel and resume-on-close still hold.
4. **Save/Load & reload:** Save, Load — same room/objective restored, no error,
   correct notice state; reload the page — deterministic room repeats, wander
   restarts from spec position (expected, non-authoritative).
5. **Leakage spot-check:** watch the dev console during the whole run — only
   safe count/enum/boolean lines; no names/prompt/JSON/memory text.
6. **Tier-2 (real, optional):** with a BYOK `.env.local`, type the §4 Tier-2
   prompts and score the subjective rows against real output. Never commit keys.
7. Record PASS/WEAK/FAIL per room (§6); file any FAIL as a bug, any WEAK as a
   `generated-room-demo-polish-pass-v0` candidate.

For the **docs-only Slice 1** there is nothing to run — report checks skipped.

---

## 12. Safety / boundary checklist

Every item holds for this slice and for the optional automated backing:

- ✅ Docs-only for Slice 1; no runtime behavior change in any slice.
- ✅ No provider/LLM/network call in design or in the automated backstop (fake
  generator only); real provider is human/dev-only, never in CI, keys never
  committed.
- ✅ No `RoomSpec` mutation — `assembleRoom` is pure; the backstop asserts input
  non-mutation rather than performing any.
- ✅ No `LoadedRoom` mutation — the suite reads the assembled room, never writes.
- ✅ No `WorldState` mutation and no `WorldEvent` outside existing tested flows —
  R15 backstop snapshots and re-asserts this.
- ✅ No save/load schema change — R9/R10 use the existing save/load path and its
  existing tests; no `SaveGame`/sidecar shape change.
- ✅ No memory writes — the suite touches no memory layer; log sweep proves no
  memory-text leakage.
- ✅ No gameplay-authority change — authority stays with `WorldSession`/event log;
  the suite only observes derived diagnostics.
- ✅ No generated-room behavior change — the pipeline is *evaluated*, never edited;
  finding a defect does not authorize a fix in this feature.
- ✅ No visual-polish implementation — deferred wholesale to §13.
- ✅ No new logging surface — the backstop *observes* logs via a spy logger; it
  adds none.
- ✅ No movement-stack regression — R16 leans on the frozen contract + existing
  motor tests; the contract file is consumed, never edited.
- ✅ Lint walls intact — new files live in `evaluation/` (test-only, already-legal
  imports) and `docs/`; no boundary rule is added or relaxed.

---

## 13. Deferred to `generated-room-demo-polish-pass-v0`

Everything this suite *finds* but must **not** fix:

- Any visual-quality improvement: better props, materials, lighting, mystery-
  marker replacement, placeholder cleanup (R1).
- Object-placement / overlap fixes beyond what the pipeline already normalizes;
  de-cluttering, spacing, anti-interpenetration polish (R2, R11).
- Composition tuning: focal-anchor selection changes, zone layout, path clarity
  (R3).
- NPC believability polish: walk-cycle/leg-swing, facing, greeting behavior,
  richer idle (R5) — note npc-local-wander already flagged these as follow-ups.
- Objective-clarity presentation: clearer objective UI, in-world signposting
  (R6).
- Interaction affordance polish and exit/arch visual treatment (R7, R8).
- Any **in-app dev diagnostics overlay** (a runtime surface to view
  `RoomDiagnostics` live). Attractive for manual runs, but it *is* a runtime
  change and out of scope here; if wanted, it is its own small approved feature.
- Screenshot-diff / visual-regression automation, if ever desired, is a separate
  tooling feature — not this suite.
- Fixing the composition/anchor "weak" cases the rubric surfaces (e.g.
  `lacksAnchor` rooms that read as purposeless).

The suite's output is the **prioritized input** to that polish pass: the WEAK
rows, ranked, become its backlog.

---

## 14. Closeout checklist

Marked complete at the end of the final shipped slice:

- [ ] Rubric, scenarios, observation checklist, pass/fail, and run template
      committed (Slice 2) and dogfooded once via §11.
- [ ] Tier-1 deterministic seed set finalized against the actual current fake-
      generator vocabulary; each seed traceably exercises its intended rows.
- [ ] (If Slices 3–4 shipped) objective + safety backstops green:
      `npm run test -- generatedRoom` / `npm run test -- evaluation`, `npm run
      lint`, `npm run build` all pass; results honestly reported.
- [ ] No runtime file changed; `git diff --stat` shows only `docs/**` and
      `apps/web/src/evaluation/**` (test/fixture) additions.
- [ ] No schema, config, dependency, or logging-surface change; boundary
      checklist (§12) re-verified.
- [ ] Movement-stack safety re-confirmed green (contract + motor suites).
- [ ] One full Tier-1 run recorded with zero FAIL; WEAK count reviewed and
      accepted (or explicitly deferred) as the demo-polish backlog.
- [ ] Status blockquote at the top of this plan updated to
      **Implemented**; ADR + one `ARCHITECTURE.md` status line added if the
      maintainer wants an ADR (test-only-armor precedent: ADR-0074/ADR-0072).
- [ ] Confirm `generated-room-demo-polish-pass-v0` is *not* started by this work;
      hand off the ranked WEAK list to it.

## 15. Decisions needing maintainer approval

1. **Docs location for the rubric + run template** — `docs/evaluation/`
   (recommended, new dir) vs. inline in this plan vs. `docs/status/`.
2. **Ship the automated backstop (Slices 3–4) at all, or keep the suite
   docs-only for v0?** Recommended: ship Slices 3–4 — they reuse ADR-0074's
   pattern for near-zero cost and convert the objective rows to CI signal.
3. **Tier-1 seed count** — 6 proposed; more coverage vs. faster runs.
4. **ADR at closeout?** Test-only armor still got one for ADR-0074/ADR-0072;
   recommend a short ADR if Slices 3–4 ship, none if v0 stays docs-only.
5. **Real-provider Tier-2 in the standing procedure** vs. an as-needed manual
   step only (recommended: keep it manual/optional; never in CI).

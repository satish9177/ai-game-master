# Implementation Plan — `feature/generated-room-demo-polish-pass-v0`

> Status: **Implementation closed for Slices 2-5; pending manual smoke before final merge/signoff.**
> This plan began as the docs-only design for a focused demo polish pass over
> generated rooms. The shipped implementation covered the approved low-risk core
> slices (notice/copy, lighting/material readability, interactable/exit
> visibility, and NPC presentation). Slice 7 is this docs-only closeout. No ADR,
> `ARCHITECTURE.md` status line, runtime code, tests, or launch-polish work is
> added by this closeout slice.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md) · [CONVENTIONS](../CONVENTIONS.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md).
>
> Direct precedents this plan builds on:
> - [`generated-room-manual-evaluation-suite-v0`](./generated-room-manual-evaluation-suite-v0.md)
>   and the shipped suite at
>   [`docs/evaluation/generated-room-manual-evaluation-suite-v0.md`](../../evaluation/generated-room-manual-evaluation-suite-v0.md)
>   — the rubric/labels (**BLOCKER / WEAK / POLISH**) that produce this pass's
>   prioritized input. This feature fixes only **WEAK** (and selected **POLISH**)
>   findings; **BLOCKER** findings are bugs handled outside this cosmetic pass.
> - The NPC life/movement stack —
>   [`npc-idle-animation-v0`](./npc-idle-animation-v0.md),
>   [`npc-behavior-state-v0`](./npc-behavior-state-v0.md),
>   [`npc-movement-safety-contract-v0`](./npc-movement-safety-contract-v0.md),
>   [`npc-local-wander-v0`](./npc-local-wander-v0.md) — whose movement-stack
>   safety is a **hard invariant** here (§6).
>
> Global invariants for THIS slice (expanded in §6): no provider/LLM behavior
> change; no `RoomSpec`/`SceneSpec` schema change; no `LoadedRoom` mutation
> outside existing trusted assembly/repair; no `WorldState`/`WorldEvent`/save-load
> change; no memory writes; no gameplay/navigation/pathfinding/combat authority
> change; no new logging of prompts, generated text, provider output, memory, or
> player text; NPC movement-stack safety preserved; small and reversible.

---

## 1. Goal and non-goals

### Goal

Make **prompt-generated rooms look and feel demo-ready** — readable, intentional,
and un-embarrassing to show — by applying a small, reversible **cosmetic and
presentation** pass driven by the WEAK findings the manual evaluation suite
produces. The pass improves how generated rooms *read* on screen; it does **not**
change what the pipeline generates, how it validates, or any gameplay authority.

Concretely, within the invariants below, this pass may improve:

- generated room readability and visual composition (trusted renderer + the
  existing deterministic composition pass)
- object placement *readability* (existing composition pass only — see §1 scope
  fences)
- room anchors / focal points (existing anchor **presentation**, not selection
  rules)
- interactable visibility (renderer indicators/rings)
- exit clarity (renderer exit-arch treatment)
- NPC visibility and local-wander presentation (renderer-only; movement stack
  untouched)
- objective clarity in generated rooms (read-only UI / copy)
- fallback / repair notice presentation (copy + presentation)
- avoiding rooms that *read* as broken / empty / cluttered (leverage existing
  safe diagnostics; no new generation)
- small UI / copy polish on the generated-room demo flow

### Non-goals

- ❌ **Not a full visual overhaul.** No new art pipeline, GLTF/asset registry,
  textures, shaders, fonts, or material system. Trusted hand-written Three.js
  primitives only.
- ❌ **Not `generated-room-object-placement-v0`.** No new placement engine,
  collision solver, or spatial-reasoning system. Placement changes are limited
  to *readability tuning inside the existing `composeGeneratedRoom` pass* (§5),
  and only if the maintainer approves that slice.
- ❌ **Not `room-composition-rules-v0`.** No new composition rule engine, zone
  DSL, or anchor-selection redesign. Anchor *selection* priority is frozen; only
  anchor **presentation** (placement nudge / focal emphasis) is in scope, gated
  by approval.
- ❌ **Not `asset-registry-fallback-v0`.** No asset registry. A *tiny* fallback
  **copy/presentation** polish (notice wording, mystery-marker calm) is the only
  fallback work, and only if §5 explicitly includes it.
- ❌ **Not `open-source-launch-polish-v0`.** README, license, screenshots,
  onboarding, repo hygiene, and broader UI theming are deferred wholesale (§13).
- ❌ No provider/LLM prompt or behavior change. No schema change. No new gameplay,
  quest, objective, memory, navigation, or combat behavior.

---

## 2. Current repo facts to verify before implementation

Source seams to re-verify before implementation (file/function references below
were checked while writing this plan, but the generated-room pipeline moves
quickly and file names shift — **re-verify at implementation time**).

- **Trusted assembly pipeline (the only legal `LoadedRoom` writer).**
  `domain/assembleRoom.ts` (`assembleRoom(rawText, fallbackRoom, options)`) runs
  parse → generated normalizers → `loadRoomSpec` → generated-room layout/compose
  → `validateRoom` → `repairRoom` → fallback, returning `{ room, diagnostics }`.
  Any placement/composition tuning this pass does must live **inside this existing
  pass** (it is the "existing trusted assembly/repair path"); nothing downstream
  may mutate `LoadedRoom`.
- **Deterministic composition pass.** `domain/generatedRoomComposition.ts`
  (`composeGeneratedRoom`) arranges *existing* objects into zones, selects and
  focal-places the single story anchor from validated `RoomObject.type` only, and
  reports `composed` / `lacksAnchor` / `lacksInteractable`. It is pure,
  deterministic, invents no content, and preserves object count + every non-position
  field. Readability tuning here stays within these guarantees.
- **Layout contract (safety envelope — do not weaken).**
  `domain/generatedRoomLayout.ts` clamps shell size, repairs object footprints /
  count cap, repairs spawn, and snaps exits to walls. This is a **safety**
  boundary; the polish pass may not relax any clamp/cap/snap.
- **Anchor / object-purpose helpers.** `domain/generatedRoomComposition.ts`
  (anchor selector), `domain/generatedRoomObjectPurpose.ts`,
  `domain/generatedRoomObjectiveTarget.ts` — selection logic is **frozen** for
  this pass; only presentation consumes their output.
- **NPC presence & dialogue (data guarantees, not visuals).**
  `domain/ensureGeneratedNpcPresence.ts` guarantees a talkable NPC with a
  collision-safe id and closed-table dialogue. Presentation of the NPC is renderer
  work; the data guarantee is untouched.
- **Trusted renderer builders (the main cosmetic surface).**
  `renderer/engine/builders/` — `shell.ts` (floor/walls), `lighting.ts`
  (lights), `storyAnchors.ts`, `documents.ts`, `practicalProps.ts`,
  `postApocProps.ts`, `strangeDevices.ts`, and `index.ts` (the registry, which
  also holds several inline builders). NPC mesh: `buildNpc` in
  `renderer/engine/builders/index.ts` +
  `renderer/engine/builders/parts/humanoid.ts` (humanoid parts). Interactable
  rings: `buildInteractableIndicator` + the ring-color constants
  (`AFFORDANCE_RING_COLOR`, `RETURN_EXIT_RING_COLOR`) in
  `renderer/engine/builders/index.ts`, using `buildGroundRing` from
  `renderer/engine/builders/indicators.ts`. Exit arches / return exits are drawn
  by `buildArch` **inside** `renderer/engine/builders/index.ts` — there is no
  standalone exit-arch builder file. All hand-written Three.js primitives;
  **every current `RoomObject["type"]` has a registered builder**. This is where
  visual readability, interactable visibility, and exit/NPC presentation are
  tuned. (Re-verify this builder file/function set at implementation time — the
  builders move quickly.)
- **NPC movement stack (must not regress — hard invariant).**
  `domain/npcMovementContract.ts` (frozen rules),
  `renderer/engine/npc/wanderStep.ts` (pure step advance),
  `renderer/engine/npc/WanderMotor.ts` (engine motor, owns **X/Z only**), and the
  IdleAnimator (owns **Y / rotation.y**). Talk ring + `Interactable.position`
  follow the moved NPC; interaction/dialogue lock pauses wander. Any NPC-visibility
  polish must not touch step choice, speed, tether, exclusion discs, the axis
  split, or the lock/pause behavior.
- **Fallback / repair notice.** `app/fallbackNotice.ts` (`FALLBACK_NOTICE`,
  `shouldShowFallbackNotice`) — `App.tsx` shows a static, prompt-free, dismissable
  notice for `repaired`/`fallback`, nothing for `generated`. Copy/presentation
  polish is a read-only UI surface.
- **Objective UI (read-only projection).** The generated-room objective/journal
  surfaces (`JournalPanel`, objective HUD, generated journal projector) are
  read-only projections per the UI projection rules; copy/clarity tuning must keep
  them presentational (no write-back, no new events/commands).
- **Safe diagnostics already exist.** `RoomDiagnostics` exposes
  `provenance`, `composed`, `lacksAnchor`, `lacksInteractable`, `npcInserted`,
  `objectsRepaired`, `spawnRepaired`, `exitsRepaired`, `exitNavigationEnsured`,
  `skippedObjectCount`, `skippedObjectReasonCounts`, `warningCount`, etc. — enough
  to *observe* "empty / cluttered / anchorless" without adding new logging.
- **Run/verify.** From `apps/web`: `dev` = `vite`, `test` = `vitest run
  --passWithNoTests`, `lint`, `build` = `tsc -b && vite build`. Targeted:
  `npm run test -- <name>`.

**To confirm at implementation time:** the exact current builder file set and
which `RoomObject["type"]`s still render as calm-but-plain vs. mystery markers;
the current `composeGeneratedRoom` zone constants; the current `RoomDiagnostics`
field names; that no in-flight branch is mid-change to `assembleRoom` /
`generatedRoomComposition` / the builders; and the ranked WEAK list from a fresh
manual-evaluation run (§3).

---

## 3. Inputs from `generated-room-manual-evaluation-suite-v0`

This pass is **findings-driven**. Its backlog is the set of **WEAK** rows (and
maintainer-selected **POLISH** rows) recorded from one or more runs of the manual
evaluation suite. Mapping from the suite's rubric rows to this pass's target areas:

| Suite rubric area | Typical WEAK finding | Polish target (§4) |
| --- | --- | --- |
| Visual quality | Bland / placeholder-ish but readable | T1 readability & materials/lighting |
| Object placement | Minor awkward spacing / clutter | T2 placement readability (composition tuning) |
| Room composition | Weak zones / focal intent | T3 anchor & focal presentation |
| NPC presence / idle-wander | Present but stiff / awkwardly placed | T4 NPC presentation (renderer-only) |
| Objective clarity | Objective needs guesswork | T5 objective clarity (read-only UI/copy) |
| Interaction availability | Usable but hard to discover | T6 interactable visibility (indicators) |
| Exits / navigation | Reachable but visually unclear | T7 exit clarity (renderer treatment) |
| Notice state | Notice unclear / jarring | T8 fallback/notice presentation |
| "reads empty / cluttered" | Sparse or busy room | T9 empty/cluttered read (diagnostics-guided) |

**Rules for consuming the input:**

- Only rows the suite labels **WEAK** (usable but below demo quality) or **POLISH**
  (nice-to-have) are eligible. A **BLOCKER** is a bug — it is *not* fixed by this
  cosmetic pass and must be escalated to the appropriate feature/bugfix.
- The suite's own scope note (["Belongs In
  `generated-room-demo-polish-pass-v0`"](../../evaluation/generated-room-manual-evaluation-suite-v0.md))
  is the authoritative eligibility list; this plan does not add categories beyond it.
- Findings are content-safe by construction (the suite forbids pasting names /
  prompts / JSON / dialogue / memory); this pass keeps that discipline.
- The ranked WEAK list is captured (maintainer's run notes) **before** any slice
  ships, so each slice cites the specific findings it addresses.

---

## 4. Demo polish target areas

Each target is a small, independently revertable cosmetic concern. Ordered by
risk (lowest first). "Surface" names the *layer* touched; none crosses a
gameplay-authority boundary.

- **T1 — Readability, materials & lighting.** *Surface: trusted renderer builders
  (`shell.ts`, `lighting.ts`, prop builders).* Warmer/clearer lighting, less-flat
  materials, calmer palette so rooms read as intentional. No assets/textures/shaders.
- **T2 — Placement readability.** *Surface: `composeGeneratedRoom` (existing
  trusted composition pass).* Small spacing / de-clutter / off-path nudges of
  *existing* objects. **Approval-gated** (§15) because it edges toward
  object-placement scope; strictly bounded to readability, invents nothing,
  preserves count + non-position fields, stays before the spawn/exit finalizers.
- **T3 — Anchor & focal presentation.** *Surface: composition placement +
  `storyAnchors.ts` builder.* Make the already-selected focal anchor read as the
  focal point (placement emphasis / subtle framing). Anchor **selection** rules
  frozen.
- **T4 — NPC presentation.** *Surface: `buildNpc` in `index.ts` /
  `parts/humanoid.ts` / the NPC ring surface (`buildGroundRing` in
  `indicators.ts`).* Calmer, more legible NPC silhouette/ring. **Movement stack
  untouched** — no step/speed/tether/lock change; axis split preserved.
- **T5 — Objective clarity.** *Surface: read-only objective/journal UI + copy.*
  Clearer objective wording / status legibility. Presentational only; no write-back.
- **T6 — Interactable visibility.** *Surface: `buildInteractableIndicator` +
  ring-color constants in `index.ts`, `buildGroundRing` in `indicators.ts`.* Make
  usable interactables easier to discover (ring/marker contrast, subtle idle
  pulse). No proximity/interaction logic change.
- **T7 — Exit clarity.** *Surface: `buildArch` (exit/return-exit arch) in
  `index.ts`.* Make exits obviously exits and obviously reachable. Navigation
  logic untouched.
- **T8 — Fallback / notice presentation.** *Surface: `app/fallbackNotice.ts` copy
  + notice styling; mystery-marker calm.* Calmer, clearer notice; no provenance /
  gating logic change.
- **T9 — Empty / cluttered read.** *Surface: presentation choices guided by
  existing safe diagnostics (`lacksAnchor`, `lacksInteractable`, skipped counts).*
  Make sparse rooms feel deliberate and busy rooms feel legible **without**
  generating or removing content or changing counts. No new generation.

---

## 5. What is allowed to change

Within the invariants (§6), and only for prompt-generated rooms' demo readability:

- **Trusted renderer builders** — hand-written Three.js geometry, materials,
  colors, and lighting values in `renderer/engine/builders/**` (T1, T3, T4, T6,
  T7) — notably `renderer/engine/builders/index.ts` (registry + inline `buildNpc`
  / `buildInteractableIndicator` / `buildArch`), `renderer/engine/builders/indicators.ts`
  (`buildGroundRing`), and `renderer/engine/builders/parts/humanoid.ts` (humanoid
  parts). Additive, primitive-based, no external assets.
- **Interactable indicators / rings** — visibility/contrast/idle-pulse tuning of
  `buildInteractableIndicator` + ring-color constants in
  `renderer/engine/builders/index.ts` and `buildGroundRing` in
  `renderer/engine/builders/indicators.ts` (T6), preserving the object-id tagging
  and proximity contract.
- **The existing deterministic composition pass** — `composeGeneratedRoom`
  readability tuning **only** (T2, T3), staying pure/deterministic, inventing
  nothing, preserving object count and every non-position field, and running in
  its current pipeline slot before spawn/exit finalizers. *(Approval-gated — §15.)*
- **Read-only objective / journal UI + copy** (T5) — presentational tuning only;
  no write-back, no new events/commands.
- **Fallback / repair notice copy + presentation** (`app/fallbackNotice.ts`,
  notice styling) (T8) — text and appearance only; provenance/gating logic frozen.
- **Small UI / copy polish** on the generated-room demo flow (PromptBar helper
  text, generated-room HUD labels) — presentational strings only.
- **Deterministic tests / fixtures** covering the changed builders/composition/UI
  (fake generator + fixed fixtures; no provider call).

Everything above is either trusted-renderer presentation, read-only UI, or a
bounded change *inside the existing trusted assembly pass* — never a new authority
surface.

---

## 6. What is explicitly NOT allowed to change

Hard invariants for every slice (violating any one rejects the change in review,
even if tooling passes):

- ❌ **No provider/LLM behavior change** — prompts, selection, adapters, and the
  generation trust boundary are frozen. (Any exception needs explicit written
  justification + approval; default is **no**.)
- ❌ **No `RoomSpec` / `SceneSpec` schema change** — `schemaVersion` stays put; no
  new/renamed fields, enums, or validation rules. (Exception → explicit approval.)
- ❌ **No `LoadedRoom` mutation outside the existing trusted assembly/repair path.**
  The renderer and UI never write `LoadedRoom.objects[].position` or any spec
  field; only `assembleRoom`/its composition+repair stages may arrange objects.
- ❌ **No `WorldState` mutation, no `WorldEvent`s** for any polish behavior.
- ❌ **No save/load schema change** — no `SaveGame`/sidecar shape change; no new
  persisted field.
- ❌ **No memory writes** and no change to any memory firewall/path.
- ❌ **No gameplay-authority change** — quests, objectives, gates, interactions,
  encounters, and `WorldSession`/event-log authority are untouched.
- ❌ **No navigation / pathfinding authority change** — exit resolution and
  navigation logic are frozen; only exit **visuals** may change.
- ❌ **No combat / chase / patrol / awareness / schedule behavior** — none exists
  for this pass to add or alter.
- ❌ **No new runtime logging** of prompts, generated descriptions, provider
  output, memory, room/object/NPC names, dialogue, or player text. Logs stay
  safe enums/counts/booleans; prefer adding none.
- ❌ **No hidden provider calls in tests / CI** — all tests use the deterministic
  fake generator and fixed fixtures.
- ❌ **NPC movement-stack safety preserved, no regression:**
  - IdleAnimator owns **Y / rotation.y**; WanderMotor owns **X/Z only** — the axis
    split is inviolate.
  - F-talk prompt + talk ring + `Interactable.position` follow moved NPCs.
  - talking / interaction lock pauses wander.
  - No change to step choice, speed, tether, exclusion discs, or pause logic in
    `npcMovementContract.ts` / `wanderStep.ts` / `WanderMotor.ts`.
- ❌ **No layout-contract weakening** — no relaxed shell clamp, footprint/count
  cap, spawn repair, or exit-wall snap in `generatedRoomLayout.ts`.
- ❌ **No new dependency, asset pipeline, GLTF, texture, shader, or font.**
- ❌ **No anchor-selection or composition-rule redesign** (frozen — §1 fences).

---

## 7. Smallest safe implementation slices

Each slice is independently reviewable, independently revertable, and green on its
own. Slice 1 is this document. Slices are ordered lowest-risk-first; the maintainer
may approve a subset. Every code slice cites the specific WEAK findings it fixes.

- **Slice 1 — Docs plan (this file).** Design/approval checkpoint. No code.
  Commit: `docs: plan generated room demo polish pass v0`.
- **Slice 2 — Notice + copy polish (lowest risk).** T8 + small T5/UI copy: calmer
  `FALLBACK_NOTICE` wording/styling, clearer generated-room objective/HUD/PromptBar
  strings. Read-only UI + strings only.
  Commit: `feat(ui): calmer generated-room notice + demo copy polish`.
- **Slice 3 — Lighting & material readability.** T1: warmer/clearer lighting and
  less-flat materials in `lighting.ts` / `shell.ts` / prop builders. Trusted
  renderer only.
  Commit: `feat(renderer): readability lighting + material polish for generated rooms`.
- **Slice 4 — Interactable & exit visibility.** T6 + T7: indicator/ring contrast
  and exit-arch clarity treatment. Renderer only; proximity/navigation logic
  untouched.
  Commit: `feat(renderer): clearer interactable + exit affordances`.
- **Slice 5 — NPC presentation.** T4: calmer/legible NPC silhouette + ring, with a
  movement-stack non-regression re-assertion. No behavior change.
  Commit: `feat(renderer): clearer NPC presentation (movement stack unchanged)`.
- **Slice 6 — Composition readability (approval-gated).** T2 + T3: bounded
  de-clutter / focal-emphasis tuning inside `composeGeneratedRoom`, only if §15
  approves. Pure/deterministic; count + non-position fields preserved.
  Commit: `feat(domain): generated-room composition readability tuning`.
- **Slice 7 — Empty/cluttered read + closeout.** T9 presentation guided by existing
  diagnostics; update this plan's status; add ADR + one `ARCHITECTURE.md` status
  line if the maintainer wants one.
  Commit: `feat(renderer): deliberate read for sparse/busy generated rooms` (+
  `docs: record generated room demo polish pass`).

Slices 2–5 are the low-risk core and are shippable without Slice 6. Slice 6 is the
only one that touches domain composition and is explicitly optional/approval-gated.

---

## 8. Files likely to be touched per slice

Mostly presentation/UI/builder files. **No schema, save/load, world-session,
memory, persistence, server, or provider file is touched by any slice.** Exact
paths re-confirmed at implementation.

| Slice | Files (likely) |
| --- | --- |
| 1 | `docs/architecture/implementation-plans/generated-room-demo-polish-pass-v0.md` (this file) |
| 2 | `apps/web/src/app/fallbackNotice.ts`; generated-room objective/journal UI copy in `renderer/ui/**`; PromptBar/HUD strings in `renderer/ui/**`; matching `*.test.ts` |
| 3 | `apps/web/src/renderer/engine/builders/lighting.ts`, `shell.ts`, selected prop builders (`practicalProps.ts`, `documents.ts`, `postApocProps.ts`, `strangeDevices.ts`, `storyAnchors.ts`); matching `*.test.ts` |
| 4 | `apps/web/src/renderer/engine/builders/index.ts` (interactable indicator build, ring-color constants, and `buildArch`), `apps/web/src/renderer/engine/builders/indicators.ts` (`buildGroundRing`); matching `*.test.ts` |
| 5 | `apps/web/src/renderer/engine/builders/index.ts` (`buildNpc`), `apps/web/src/renderer/engine/builders/parts/humanoid.ts` (humanoid parts), NPC ring surface in `index.ts` / `indicators.ts`; a movement-stack non-regression assertion (reusing existing `WanderMotor`/`npcMovementContract` suites) |
| 6 | `apps/web/src/domain/generatedRoomComposition.ts`; `generatedRoomComposition.test.ts` |
| 7 | presentation guided by diagnostics (renderer/UI file TBD by finding); this plan (status); optionally `docs/architecture/decisions/ADR-00XX-generated-room-demo-polish-pass-v0.md` + one `ARCHITECTURE.md` status line |

**Explicitly NOT touched:** `domain/roomSpec.ts` and all schemas;
`domain/assembleRoom.ts` pipeline order; `domain/generatedRoomLayout.ts` (safety
clamps); `domain/npcMovementContract.ts`, `renderer/engine/npc/wanderStep.ts`,
`renderer/engine/npc/WanderMotor.ts` (movement stack); `generation/**`;
`world-session/**`, `interactions/**`, `encounters/**`, `dialogue/**`,
`memory/**`, `persistence/**`, `server/**`; save/load modules; `app/llmConfig.ts`,
`app/selectRoomGenerator.ts` (provider selection); `eslint.config.js`,
`tsconfig*.json`, `package.json`; any ADR/boundary rule.

### Minimum Safe Change Check

- **Reused:** the whole trusted renderer builder set + registry; the existing
  `composeGeneratedRoom` pass and its diagnostics; the existing `fallbackNotice`
  seam; the read-only objective/journal UI; the frozen movement stack + its tests;
  the fake generator + fixed fixtures for tests. Nothing new is invented that the
  pipeline doesn't already expose.
- **Minimum new code:** cosmetic edits to existing builders/UI/copy, one bounded
  optional composition-readability tweak, and matching deterministic tests. Zero
  new abstraction, zero new dependency, zero new runtime system.
- **Safety boundaries unchanged:** schema validation, trusted-renderer boundary,
  generation trust boundary, layout-contract safety clamps, memory firewall,
  authoritative-state rules, logging redaction, and the NPC movement-stack safety
  contract are all preserved and (where relevant) re-asserted.
- **Targeted tests:** §9 — deterministic builder/composition/UI tests plus a
  movement-stack non-regression re-assertion.

---

## 9. Tests required per slice

All tests deterministic and offline (fake generator + fixed fixtures; **no
provider call**). Match the existing builder/domain test style.

- **Slice 1 (docs):** none. Report build/test as *skipped* (docs-only).
- **Slice 2:** notice copy/state test (`shouldShowFallbackNotice` unchanged;
  `repaired`/`fallback` show, `generated` shows none); objective/HUD copy renders
  expected strings; no write-back / no new event from the read-only surfaces.
- **Slice 3:** builder tests assert the polished builders still produce valid
  Three.js nodes for every affected `RoomObject["type"]`, disposal-safe, no new
  external resource; a smoke over a fake-generated room asserts the room still
  builds without error.
- **Slice 4:** indicator/ring tests assert the object-id tag + proximity contract
  are preserved; exit-arch builder still tags/positions exits identically
  (visual-only diff).
- **Slice 5:** NPC builder tests assert mesh/ring nodes build correctly; **movement
  non-regression** — re-run/assert `WanderMotor` writes X/Z only, idle owns
  Y/rotation, ring + `Interactable.position` follow the NPC, and wander pauses on
  lock/talking (reuse existing suites; add at most one thin assertion). No edit to
  the contract/motor files.
- **Slice 6:** `generatedRoomComposition.test.ts` — the tuned pass is still pure
  and deterministic; object **count preserved**; every **non-position field
  preserved**; anchor **selection** unchanged (same anchor id as before for fixed
  fixtures); `lacksAnchor`/`lacksInteractable` diagnostics unchanged; runs before
  spawn/exit finalizers. Thresholds are absolute literals mirroring the pass's
  existing constants.
- **Slice 7:** presentation test for the sparse/busy read; full regression
  (`npm run test`), `npm run lint`, `npm run build` on the touched central areas.

---

## 10. Manual smoke procedure

Run the **manual evaluation suite** (`docs/evaluation/generated-room-manual-evaluation-suite-v0.md`)
before and after the pass, and confirm the targeted WEAK rows improved without any
regression. Per shipped slice:

1. `cd apps/web && npm run dev`; open the local Vite URL.
2. Generate a room from the PromptBar (fake default; optionally the maintainer's
   BYOK real provider for a subjective real pass — never in CI, never committed keys).
3. Walk the room and re-score the suite rows the slice targeted; confirm the WEAK
   row(s) now read better and **no** previously-good row regressed.
4. **Interactables/exits (Slices 3–4):** every interactable is easy to spot and
   opens; every exit reads as an exit and still navigates when used.
5. **NPC (Slice 5):** NPC reads clearly, still breathes (idle owns Y/rotation),
   still takes calm tethered X/Z steps, still pauses on any panel and while talking,
   and the F-talk prompt + ring **follow the moved NPC**. Exit is never blocked.
6. **Notice (Slice 2):** a `repaired`/`fallback` room shows the calmer static
   notice; a clean `generated` room shows none.
7. **Objective clarity (Slice 2/5):** the objective/journal reads clearly and
   matches the room; the panel remains read-only (no accidental write-back).
8. **Composition (Slice 6):** the focal anchor reads as the focal point; clutter
   reads as zones; the central path stays walkable; the same fixture room is
   byte-stable across reloads (determinism).
9. **Leakage spot-check:** watch the dev console for the whole run — only safe
   count/enum/boolean lines; no prompt/JSON/names/dialogue/memory text.
10. Record before/after scores in the suite's run template.

For the **docs-only Slice 1** there is nothing to run — report checks skipped.

---

## 11. Safety / boundary checklist

Every item holds for every code slice:

- ✅ No provider/LLM behavior change; provider selection/prompts frozen.
- ✅ No `RoomSpec`/`SceneSpec` schema change; `schemaVersion` unchanged.
- ✅ No `LoadedRoom` mutation outside `assembleRoom`'s existing composition/repair
  stages; renderer/UI never write spec fields.
- ✅ No `WorldState` mutation, no `WorldEvent` emission.
- ✅ No save/load schema/shape change.
- ✅ No memory write; memory firewall untouched.
- ✅ No gameplay/quest/objective/gate/interaction/encounter authority change.
- ✅ No navigation/pathfinding authority change; exit visuals only.
- ✅ No combat/chase/patrol/awareness/schedule behavior added or altered.
- ✅ No new runtime logging of prompts, generated text, provider output, memory,
  names, dialogue, or player text; logs stay safe enums/counts/booleans.
- ✅ No hidden provider calls in tests/CI; fake generator + fixed fixtures only.
- ✅ NPC movement-stack safety preserved: IdleAnimator owns Y/rotation.y;
  WanderMotor owns X/Z only; F-talk/ring/`Interactable.position` follow moved
  NPCs; talking/interaction lock pauses wander; contract/motor files unedited.
- ✅ Layout-contract safety clamps (shell/footprint/count/spawn/exit) unweakened.
- ✅ No new dependency, asset pipeline, GLTF, texture, shader, or font.
- ✅ Anchor-selection / composition-rule logic unchanged (only presentation +
  bounded readability tuning).
- ✅ Trusted renderer stays hand-written; no generated executable renderer code.
- ✅ Lint walls intact; no boundary rule added or relaxed.

---

## 12. Visual / demo acceptance criteria

The pass is accepted when, over a fresh manual-evaluation run:

- Generated rooms read as **intentional spaces**, not placeholder clusters: no
  view dominated by flat/placeholder props or stray mystery markers (T1).
- The **focal anchor is legible** as the focal point; clutter reads as zones; the
  central path is walkable (T2/T3).
- Every **interactable is easy to discover** and its ring/marker reads clearly;
  every **exit reads as an exit** and is obviously reachable (T6/T7).
- The **NPC reads clearly**, sits/stands on the floor, wanders calmly, pauses
  correctly, and stays talkable while moving (T4 — with the movement stack proven
  unchanged).
- The **objective is clear** from the room + read-only UI (T5).
- The **fallback/repair notice** (when shown) is calm, static, prompt-free, and
  clearly explains state; a clean room shows none (T8).
- Sparse rooms feel **deliberate** and busy rooms feel **legible**, with no content
  generated or removed and no count change (T9).
- **Scoring delta:** the WEAK rows this pass targeted improve to `2` (good) — or a
  logged, accepted `1` — with **zero** new `0`/FAIL and **zero** BLOCKER introduced,
  measured by the manual evaluation suite before vs. after.
- All targeted tests, `npm run lint`, and `npm run build` pass; results honestly
  reported.

---

## 13. Deferred to `open-source-launch-polish-v0`

Explicitly out of scope here; handed off to the launch-polish feature:

- README, license, contribution guide, repo hygiene, badges, and docs-site work.
- Committed demo screenshots / GIFs / a recorded walkthrough / trailer.
- First-run onboarding, tutorial overlays, or a landing/marketing surface.
- Broad app-wide UI theming, typography systems, or a design-token pass beyond the
  generated-room demo flow.
- Any **asset pipeline** (GLTF/textures/fonts) or **asset-registry-fallback-v0**
  work — a real fallback asset system is its own approved feature.
- A **generated-room-object-placement-v0** placement engine or a
  **room-composition-rules-v0** rule engine — this pass only *nudges readability*
  inside the existing composition pass; the systems themselves are deferred.
- Screenshot-diff / visual-regression automation or a dev diagnostics overlay
  (runtime surface) — separate tooling features.
- Accessibility, i18n, mobile/touch, and performance-tuning passes.

---

## 14. Closeout checklist

### Closeout status

Closed scope:

- **Slice 2 shipped:** fallback notice copy/CSS/tests.
- **Slice 3 shipped:** lighting and material readability polish.
- **Slice 4 shipped:** interactable and exit affordance visibility polish.
- **Slice 5 shipped:** NPC presentation polish.
- **Slice 6 intentionally skipped:** it is approval-gated domain composition tuning,
  there is no specific manual-evaluation **WEAK** finding requiring it, and the
  approved plan says Slices 2-5 are the low-risk core and shippable without Slice 6.
  No `domain/generatedRoomComposition.ts` change shipped.

Safety summary:

- No provider/LLM behavior change.
- No `RoomSpec` / `SceneSpec` schema change.
- No `LoadedRoom`, `WorldState`, `WorldEvent`, save/load, or memory change.
- No gameplay, navigation, pathfinding, or combat authority change.
- No new sensitive logging.
- No dependency, asset pipeline, GLTF, texture, shader, or font change.
- NPC movement-stack runtime files were unchanged.
- Domain composition tuning was skipped with Slice 6.
- `open-source-launch-polish-v0` was not started.

Verification summary:

- Slice 2: full suite passed before commit.
- Slice 3: targeted lighting/shell builder tests and lint passed; build failed only
  on known pre-existing TypeScript errors outside Slice 3.
- Slice 4: `indicators`, `builders`, and lint passed; build failed only on known
  pre-existing TypeScript errors outside Slice 4.
- Slice 5: `characters`, `humanoid`, `WanderMotor`, `npcMovementContract`,
  `builders`, and lint passed; build failed only on known pre-existing TypeScript
  errors outside Slice 5.

Manual smoke status:

- Manual smoke / before-after manual evaluation was **not performed during
  closeout**. It remains required before final feature merge/signoff.

Deferred / follow-up:

- Slice 6 composition readability remains available later if a concrete
  manual-evaluation **WEAK** finding appears.
- ADR and `ARCHITECTURE.md` status line were not added in this slice; either can
  be added later if the maintainer requests it.
- `open-source-launch-polish-v0` remains a separate feature.

Marked complete at the end of the final shipped slice:

- [ ] The ranked WEAK/POLISH backlog from a fresh manual-evaluation run is captured
      and each shipped slice cites the findings it addressed.
- [ ] Only WEAK/POLISH findings were touched; **no BLOCKER** was "fixed" cosmetically
      (any BLOCKER was escalated as a bug outside this pass).
- [x] `git diff --stat` shows only presentation/UI/builder files (+ the optional,
      bounded `generatedRoomComposition.ts` if Slice 6 shipped) and docs — no schema,
      save/load, world-session, memory, persistence, server, or provider file.
- [x] No schema, save/load, config, dependency, or logging-surface change; §11
      boundary checklist re-verified.
- [x] NPC movement-stack safety re-confirmed green (contract + motor suites; axis
      split, follow-the-NPC talkability, lock/talking pause all hold).
- [x] Layout-contract safety clamps unweakened; `assembleRoom` pipeline order
      unchanged.
- [ ] Targeted tests + `npm run lint` + `npm run build` green; reported honestly.
      Targeted tests and lint passed for shipped slices, but build still fails on
      known pre-existing TypeScript errors outside this feature.
- [ ] A before/after manual-evaluation run shows the targeted WEAK rows improved
      with zero new `0`/FAIL and zero new BLOCKER; §12 acceptance criteria met.
- [x] Status blockquote at the top of this plan updated to **Implemented**; ADR +
      one `ARCHITECTURE.md` status line not added in this slice.
- [x] Confirm `open-source-launch-polish-v0` is *not* started by this work; hand
      off deferred items (§13).

---

## 15. Decisions needing maintainer approval before implementation

1. **Include the composition-readability slice (Slice 6 / T2–T3) at all?**
   Recommended: **yes but tightly bounded** — a small de-clutter/focal-emphasis
   tune inside the existing pure `composeGeneratedRoom`, preserving count +
   non-position fields + anchor selection. If the maintainer prefers zero domain
   risk, drop Slice 6 and keep the pass renderer/UI-only.
2. **Depth of lighting/material change (T1)** — subtle readability nudge
   (recommended) vs. a broader palette/mood pass (edges toward "visual overhaul",
   discouraged here).
3. **Any fallback presentation beyond copy (T8)** — copy + light styling only
   (recommended) vs. touching the mystery-marker builder. Confirm mystery-marker
   changes stay purely cosmetic (never reveal skipped type/name text).
4. **NPC presentation depth (T4)** — silhouette/ring readability only (recommended)
   vs. a leg-swing/facing polish (that is a *movement/animation* follow-up flagged
   by npc-local-wander, and would need its own approval — keep out of this pass).
5. **ADR at closeout?** Recommended: a short ADR if any renderer/composition
   behavior visibly changes; none if the pass is pure copy/lighting.
6. **Real-provider subjective pass** — kept manual/dev-only/optional (recommended;
   never in CI, keys never committed) vs. skipped entirely.
7. **Slice subset & order** — confirm which of Slices 2–7 to authorize and in what
   order (default: 2 → 3 → 4 → 5 → [6] → 7, lowest-risk-first).

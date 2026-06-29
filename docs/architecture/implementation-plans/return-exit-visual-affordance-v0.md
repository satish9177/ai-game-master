# Implementation Plan — `feature/return-exit-visual-affordance-v0`

> Status: **in progress — Slice 1 implemented 2026-06-29.**
> Maintainer approved the design on 2026-06-29.
> The ADR for this slice is
> [ADR-0053](../decisions/ADR-0053-return-exit-visual-affordance-v0.md)
> (Accepted — planned).
>
> **Depends on (implemented and merged):**
> `feature/bidirectional-generated-room-links-v0`
> ([ADR-0052](../decisions/ADR-0052-generated-room-bidirectional-links-v0.md)) —
> `ensureGeneratedReturnExit`, `:return-exit:` id namespace, and the pregenerator
> `ensureReturnExits` option must all be in place before this plan makes visual sense.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).

---

## Goal

Make return exits visually distinct from forward generated exits so the player can tell which
arch goes back and which goes forward **from across the room** — without changing navigation
semantics, RoomSpec schema, affordance classification, HUD behavior, or any provider/objective/
persistence boundary.

---

## 1. Current repo facts (verified)

- **`ensureGeneratedReturnExit`** (`domain/generatedReturnExit.ts`): inserts an arch with
  `color: '#9a9488'` — the same grey-brown as forward exits. This is the value that changes in
  Slice 1.
- **`RETURN_EXIT_ID_INFIX`** (`domain/generatedReturnExit.ts`): exported constant
  `':return-exit:'`. Already used in `uniqueReturnExitId`; Slice 1 also exports a predicate
  keyed on it.
- **`RETURN_EXIT_ARCH_COLOR`** (`domain/generatedReturnExit.ts`): exported constant `'#c084fc'`.
  Already wired into `ensureGeneratedReturnExit` arch insertion (Slice 1 complete).
- **`isReturnExitObject`** (`domain/generatedReturnExit.ts`): exported pure predicate —
  `typeof object.id === 'string' && object.id.includes(RETURN_EXIT_ID_INFIX)`. Already
  exported (Slice 1 complete).
- **`AFFORDANCE_RING_COLOR`** (`renderer/engine/builders/index.ts:368`): fixed map from
  `Affordance` to hex color. `exit` → `'#6bbcff'` (cyan). Return exits currently receive this
  same cyan ring.
- **`buildInteractableIndicator`** (`renderer/engine/builders/index.ts:382`): called from
  `buildObjects` with `(obj.position, affordance)`. Picks color from `AFFORDANCE_RING_COLOR`.
  This is where Slice 2 adds the return-exit branch.
- **`affordanceForInteractableObject`** (`domain/ports/interaction.ts:31`): derives affordance
  from interaction structure; returns `'exit'` for all exit arches (both forward and return).
  Not changed.
- **`buildObjects`** (`renderer/engine/builders/index.ts:29`): the loop that calls both
  `buildKnownObject` and `buildInteractableIndicator`. The call to `buildInteractableIndicator`
  is the only site that needs a one-branch change in Slice 2.
- **Forward exit arch color** (`ensureGeneratedExitNavigation.ts:56`): `color: '#9a9488'`.
  This is NOT changed by this plan.
- **Authored exits** (e.g. `throneRoom.ts`): authored arches have ids like `north-arch` — no
  `:return-exit:` infix → `isReturnExitObject` returns `false` → cyan ring unchanged.

---

## 2. Scope

### Implemented by this plan

1. **Domain constants/predicate + arch color** — `RETURN_EXIT_ID_INFIX`, `RETURN_EXIT_ARCH_COLOR`,
   `isReturnExitObject`, arch `color` wired to the constant.
2. **Renderer ring color** — `RETURN_EXIT_RING_COLOR` constant; `buildObjects` picks it for
   return exits via `isReturnExitObject`; `buildInteractableIndicator` accepts a resolved color.
3. **Docs/status closeout** — ADR-0053 status flip, ARCHITECTURE.md status legend + planned
   section, implementation plan status.

### Explicitly not implemented (deferred)

- Colorblind iconography / shape differentiation for return exits.
- HUD chip/label change or new `return-exit` affordance kind.
- Arch geometry change (no special arrow mesh or door animation).
- Named/destination-aware return arch labels.
- Authored/demo bidirectional links.
- Persistence of generated map links.
- Any provider, prompt, objective, world-state, navigation-contract, backend, or save/load change.

---

## 3. Minimum Safe Change Check

**Existing code reused:**
- `RETURN_EXIT_ID_INFIX` and the `:return-exit:` namespace (ADR-0052) — the predicate reads the
  same infix already embedded in every return-exit id.
- `buildInteractableIndicator` — no new mesh or ring; the color parameter change is local.
- `affordanceForInteractableObject` — unchanged; return exits stay `exit`.
- Renderer→domain import seam — already allowed; `isReturnExitObject` is a domain export.

**New code (minimum):**
- `isReturnExitObject` pure predicate + `RETURN_EXIT_ARCH_COLOR` + `RETURN_EXIT_ID_INFIX`
  extraction (Slice 1 — done).
- `RETURN_EXIT_RING_COLOR` constant + one-branch in `buildObjects` + color parameter on
  `buildInteractableIndicator` (Slice 2).

**Safety boundaries unchanged:**
- `RoomSpec` schema — `color` field already exists on arch; no schema version bump.
- `validateRoom` / `repairRoom` — no semantic change.
- Affordance union / `Interactable` view-model / HUD — untouched.
- Navigation semantics, `AdjacentRoomPregenerator`, `NavigationService` — untouched.
- Renderer trust boundary — only trusted hand-written constants reach the renderer.
- Objective pipeline, providers, world-session, persistence, save/load — untouched.
- Logging redaction — no new log surface.

**Targeted tests:**
- Domain: `isReturnExitObject` predicate cases; arch color = `RETURN_EXIT_ARCH_COLOR`; forward
  arch color unchanged.
- Renderer: return-exit object → ring uses `RETURN_EXIT_RING_COLOR`; forward exit → cyan;
  non-exit interactable → its affordance color; authored exit → cyan.

---

## 4. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

### Slice 1 — Domain constants, predicate, arch color ✅ complete
`feat(domain): export return-exit id infix, arch color, and isReturnExitObject predicate`

**Files changed:**

- `apps/web/src/domain/generatedReturnExit.ts`
  — export `RETURN_EXIT_ID_INFIX = ':return-exit:'`; export
  `RETURN_EXIT_ARCH_COLOR = '#c084fc'`; reuse `RETURN_EXIT_ID_INFIX` in `uniqueReturnExitId`
  (replacing the inline string); wire `RETURN_EXIT_ARCH_COLOR` into the inserted arch's `color`;
  export `isReturnExitObject(object: RoomObject): boolean`.
- `apps/web/src/domain/generatedReturnExit.test.ts`
  — new `RETURN_EXIT_ID_INFIX` describe; new `isReturnExitObject` describe (6 cases: true for
  return-exit id, true for suffixed collision id, false for `:generated-exit:`, false for
  authored id, false for no id, false for `undefined` id); two new assertions in the first
  `ensureGeneratedReturnExit` test (arch.color === RETURN_EXIT_ARCH_COLOR; isReturnExitObject
  true).
- `apps/web/src/domain/ensureGeneratedExitNavigation.test.ts`
  — one new test: forward arch color stays `#9a9488` (regression guard).

**Verification (run and confirmed passing):**
`npm run test -- generatedReturnExit` → 18 passed
`npm run test -- ensureGeneratedExitNavigation` → 15 passed
`npm run build` → clean

---

### Slice 2 — Renderer ring color selection
`feat(renderer): paint return exits with a distinct floor ring color`

**Files to change:**

- `apps/web/src/renderer/engine/builders/index.ts`
  — add `export const RETURN_EXIT_RING_COLOR = '#f472b6'`;
  — update `buildInteractableIndicator(position, color: string)` to take a resolved color string
    instead of an `Affordance` (single callsite; color resolution stays in `buildObjects`);
  — in `buildObjects`, before calling `buildInteractableIndicator`, resolve the ring color:
    `const ringColor = isReturnExitObject(obj) ? RETURN_EXIT_RING_COLOR : (AFFORDANCE_RING_COLOR[affordance] ?? AFFORDANCE_RING_COLOR.inspect)`;
    pass `ringColor` to `buildInteractableIndicator`.
  — add import of `isReturnExitObject` from `'../../../domain/generatedReturnExit'`.

**Test additions (`renderer/engine/builders/objectIndicators.test.ts` or co-located):**
- A return-exit object (id containing `:return-exit:`, `interaction.exit` present) produces an
  `interactable-indicator` ring with material color matching `RETURN_EXIT_RING_COLOR`.
- A forward generated-exit object (id containing `:generated-exit:`, `interaction.exit` present)
  produces a ring matching `AFFORDANCE_RING_COLOR.exit` (cyan `#6bbcff`).
- An authored exit arch (id `north-arch`, `interaction.exit` present, no return-exit infix)
  produces a ring matching `AFFORDANCE_RING_COLOR.exit` (cyan).
- A non-exit interactable (e.g. `interaction.effect.kind = 'inspect'`) gets its affordance color,
  not `RETURN_EXIT_RING_COLOR`.

**Verification:** `npm run test -- objectIndicators`, `npm run lint`, `npm run build`

---

### Slice 3 — Docs/status closeout
`docs: record return exit visual affordance v0`

**Files to change:**

- `docs/architecture/decisions/ADR-0053-return-exit-visual-affordance-v0.md`
  — flip Status to `Accepted — implemented`; add `Implemented: 2026-06-29`.
- `docs/architecture/ARCHITECTURE.md`
  — move the feature from 🔜 Planned to ✅ Implemented in the status legend;
  — add short ✅ section body ("Return Exit Visual Affordance v0").
- This implementation plan — flip status to `implemented`.

**Verification:** `git diff --check` only.

---

## 5. Files touched

| File | Slice | Change summary |
|---|---|---|
| `apps/web/src/domain/generatedReturnExit.ts` | 1 ✅ | Export `RETURN_EXIT_ID_INFIX`, `RETURN_EXIT_ARCH_COLOR`, `isReturnExitObject`; wire color into arch; use infix constant |
| `apps/web/src/domain/generatedReturnExit.test.ts` | 1 ✅ | `isReturnExitObject` cases; arch color + predicate round-trip assertions |
| `apps/web/src/domain/ensureGeneratedExitNavigation.test.ts` | 1 ✅ | Forward arch color regression guard |
| `apps/web/src/renderer/engine/builders/index.ts` | 2 | `RETURN_EXIT_RING_COLOR`; ring color branch; `buildInteractableIndicator` color param |
| `apps/web/src/renderer/engine/builders/objectIndicators.test.ts` | 2 | Ring color cases for return, forward, authored, and non-exit objects |
| `docs/architecture/decisions/ADR-0053-*.md` | 3 | Status flip to implemented |
| `docs/architecture/ARCHITECTURE.md` | 3 | Status legend + new ✅ section |
| `docs/architecture/implementation-plans/return-exit-visual-affordance-v0.md` | 3 | Status flip |

---

## 6. Files NOT to touch

`domain/roomSpec.ts` (no schema field) · `domain/loadRoomSpec.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/assembleRoom.ts` · `domain/generatedRoomLayout.ts` ·
`domain/generatedRoomComposition.ts` · `domain/ensureGeneratedExitNavigation.ts` (forward exits
stay grey/cyan; this plan adds no behavior to that file) ·
`domain/interactions/affordance.ts` (Affordance union unchanged) ·
`domain/ports/interaction.ts` (`Interactable` view-model unchanged; `affordanceFor` unchanged) ·
`renderer/ui/Hud.tsx` (HUD chip and prompt unchanged) ·
`renderer/engine/Engine.ts` · `renderer/engine/controls/` · `renderer/engine/camera/` ·
`app/AdjacentRoomPregenerator.ts` · `app/NavigationService.ts` · `app/exits.ts` ·
`app/exitGate.ts` · `app/gatedNavigation.ts` · `App.tsx` · `RoomViewer.tsx` ·
all objective code (`domain/quests/**`, `app/generatedObjective.ts`, `app/selectObjectiveGenerator.ts`,
`generation/FakeObjectiveGenerator.ts`, `generation/OpenAICompatibleObjectiveGenerator.ts`) ·
`generation/FakeRoomGenerator.ts` · `generation/OpenAICompatibleRoomGenerator.ts` ·
provider prompts · `world-session/**` · `interactions/**` · `encounters/**` ·
`dialogue/**` · `memory/**` · `persistence/**` · `server/**` ·
`eslint.config.js` · `package.json`.

No new `VITE_*` environment variable. No new lint block. No new dependency.

---

## 7. Test plan

### Mandatory new tests

**`generatedReturnExit.test.ts` additions (Slice 1 — done):**
- `RETURN_EXIT_ID_INFIX` equals `':return-exit:'` (value guard).
- `isReturnExitObject`:
  - `true` for id containing `:return-exit:` (nominal return arch)
  - `true` for suffixed collision id (`…:return-exit:south:2`)
  - `false` for `:generated-exit:` forward id
  - `false` for authored id (`throne-room`)
  - `false` for object with no `id` property
  - `false` for object with `id: undefined`
- `ensureGeneratedReturnExit` inserts arch with `color === RETURN_EXIT_ARCH_COLOR`.
- Inserted arch id satisfies `isReturnExitObject`.

**`ensureGeneratedExitNavigation.test.ts` addition (Slice 1 — done):**
- Forward arch color stays `#9a9488` (regression guard).

**Renderer ring color tests (Slice 2):**
- Return exit object (`id.includes(':return-exit:')`, `interaction.exit` set) → ring material
  color = `RETURN_EXIT_RING_COLOR` (`#f472b6`).
- Forward generated exit (`id.includes(':generated-exit:')`, `interaction.exit` set) → ring
  material color = `AFFORDANCE_RING_COLOR.exit` (`#6bbcff`).
- Authored exit (`id = 'north-arch'`, `interaction.exit` set, no return infix) → ring material
  color = `AFFORDANCE_RING_COLOR.exit` (cyan).
- Non-exit interactable (`interaction.effect.kind = 'inspect'`) → ring material color =
  `AFFORDANCE_RING_COLOR.inspect` (`#ffcf6b`).

### Regression (must stay green, no change required)

- `generatedReturnExit.test.ts` — all pre-existing cases unchanged (Slice 1 adds only new cases).
- `ensureGeneratedExitNavigation.test.ts` — all pre-existing cases unchanged.
- `AdjacentRoomPregenerator.test.ts` — untouched.
- `NavigationService.test.ts` — untouched.
- `affordance.test.ts` — untouched (Affordance union unchanged).

### Log safety (all suites)

No test may assert the presence of room names, object names, generated JSON, interaction text,
provider bodies, or API keys in log output. `isReturnExitObject` is silent; no new log line is
introduced.

---

## 8. Manual smoke checklist

1. Launch the app; prompt-generate a room A. Walk to the forward exit, enter adjacent room B.
2. In B, confirm **two arches are visually distinct from across the room**:
   - Forward arch (to C) is **grey** (`#9a9488`) with a **cyan** floor ring.
   - Return arch (to A) is **purple** (`#c084fc`) with a **pink/rose** floor ring.
3. Press `E` on the return arch → arrive back in A (cache hit, no regeneration).
4. Press `E` on the forward arch → enter C (forward navigation, as before).
5. A → B → C → B → A backtracking: every return arch is purple/pink; every forward arch
   is grey/cyan.
6. Authored / demo world: all exits remain grey + cyan. No purple arches appear.
7. Room #1 (A): only a forward grey/cyan exit (no return arch, as expected per ADR-0052).
8. Up close, HUD: return arch reads "Return to previous room"; forward arch reads "Enter next
   room". Chip still reads "Exit" for both.

---

## 9. Known limitations (document, do not fix in this slice)

- **Color-only channel.** Visual distinction is by color only. Players with red-green or other
  color vision deficiencies may not distinguish cyan from pink at range. Colorblind-safe
  iconography (shape, icon, or label change) is a follow-up.
- **Idempotent early-return case.** When a generated room already had an exit to the parent
  before `ensureGeneratedReturnExit` ran (idempotent path), the pre-existing arch keeps whatever
  color it already had — typically the forward grey — and `isReturnExitObject` will return `false`
  for that arch. The behavior is consistent (cyan ring), and the room still navigates correctly;
  only the visual affordance is absent for that edge case.
- **Session-local (inherited from ADR-0052).** Generated map links are not persisted; purple arches
  disappear on save/load as before.
- **No arch geometry change.** Purple color is the only new signal; the arch shape itself is
  unchanged. A chevron, arrow, or door-frame variant is deferred.

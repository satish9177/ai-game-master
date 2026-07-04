# Implementation Plan — `feature/generated-room-theme-materials-v1`

> Status: **DECISIONS LOCKED — docs-only. No code written.**
> Open design decisions D1–D3 resolved by the maintainer (see §15). Design first per
> `AGENTS.md` ("Do not implement until the maintainer approves."). This update records the
> locked choices; implementation is still gated on plan approval.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [CONVENTIONS](../CONVENTIONS.md).
>
> **Builds on (implemented and merged):**
> - Generated Room Composition v0 ([ADR-0032](../decisions/ADR-0032-generated-room-composition-v0.md)).
> - Generated Room Visual Vocabulary v0 ([ADR-0033](../decisions/ADR-0033-generated-room-visual-vocabulary-v0.md)) —
>   the trusted per-type procedural builders this plan re-finishes.
> - Generated Room Theme Vocabulary v0 ([ADR-0044](../decisions/ADR-0044-generated-room-theme-vocabulary-v0.md)) —
>   the `GeneratedRoomThemeVocabulary.palette` (incl. the currently-unused `accent`/`emissive`)
>   this plan activates at render time.

---

## 0. Pre-flight: is this already implemented?

**No.** Verified against the current tree on `main`:

- There is **no ADR or plan** for theme-driven materials, palette-at-render, or lighting
  variation. The highest ADR is 0074; theme work stops at Theme Vocabulary v0 (ADR-0044),
  which is a **generation-side data** feature, not a render-side material/lighting feature.
- `GeneratedRoomThemeVocabulary.palette` (`apps/web/src/domain/generatedRoomThemeVocabulary.ts`)
  defines `floor`, `wall`, `prop`, **`accent`**, and **`emissive`**. Only `floor`/`wall`/`prop`
  are consumed — by `FakeRoomGenerator` — and they flow into the room **as data**
  (`shell.floorColor`, `shell.wallColor`, per-`prop` `color`). **`accent` and `emissive` are
  dead fields**: nothing reads them.
- The renderer applies **no theme awareness**. `buildShell` uses one global finish
  (`roughness: 0.82, metalness: 0.02`) for every room. `buildLighting` reads `RoomSpec`
  ambient/hemisphere verbatim and adds a fixed renderer-internal key light
  (`KEY_LIGHT_COLOR = '#fff6e8'`). `buildObjects`/per-type builders read each object's
  `obj.color` (schema default when the generator/provider didn't set one) with hardcoded,
  theme-neutral finishes.
- `Engine.setRoom` receives only `LoadedRoom` + `SetRoomOptions { resolvedObjectIds? }`.
  **The renderer is never told the room's theme** — `themePack` lives on the App's generated
  `ActivePlay` (World Bible), not on `RoomSpec`/`LoadedRoom`.

Conclusion: the exact feature — *deterministic theme-driven material, palette, and lighting
variation at render time* — is **not shipped**. This plan is safe to pursue.

---

## 1. Goal

Make generated rooms read as **cohesive themed spaces** by deterministically varying
**material finish, palette accents, and lighting grade** per theme (`fantasy-keep` vs
`post-apoc`), reusing the existing `GeneratedRoomThemeVocabulary` data and activating its
currently-dead `accent`/`emissive` fields — **without** any schema, provider/prompt, App, or
save-load change, and **without** weakening any safety boundary.

Non-goal: new object types, new assets/textures/GLTF, recoloring objects whose color already
carries meaning (e.g. steel drums), or a new "theme" beyond the two existing packs.

---

## 2. Current repo facts (verified)

| Concern | Where | Today's behavior |
| --- | --- | --- |
| Theme palette data | `domain/generatedRoomThemeVocabulary.ts` | `palette.{floor,wall,prop,accent,emissive}` per theme; `accent`/`emissive` **unused**. |
| Palette → data | `generation/FakeRoomGenerator.ts` | Sets `floorColor`/`wallColor` from `palette.floor`/`palette.wall`; `prop.color` from `palette.prop`. Non-prop objects get **schema-default** colors. Real provider emits arbitrary colors. |
| Shell render | `renderer/engine/builders/shell.ts` | One global finish for floor/walls/seams/trim. No theme input. |
| Lighting render | `renderer/engine/builders/lighting.ts` | Ambient + optional hemisphere from `RoomSpec`; fixed warm key light. No theme input. |
| Object render | `renderer/engine/builders/index.ts` (+ `documents/practicalProps/postApocProps/storyAnchors/strangeDevices`) | Per-type builders read `obj.color`; finishes/emissive hardcoded per builder. |
| Render seam | `renderer/engine/Engine.ts` `setRoom(room, { resolvedObjectIds })` | No theme field. `themePack` never reaches the renderer. |
| Theme derivation | — | **Does not exist.** |

Renderer→Domain imports are **allowed** (BOUNDARIES dependency table), so the renderer may
import `generatedRoomThemeVocabulary` and a new domain derivation helper **with no new lint
rule**.

---

## 3. What existing systems already provide (so we don't rebuild)

- **Theme classification vocabulary + palette** — `themeVocabulary(themePack)` already exists
  and already encodes floor/wall/prop/accent/emissive per theme. Reuse verbatim; do not
  redefine palettes.
- **Palette-as-data path** — floor/wall/prop colors already vary per theme *in the data* for
  fake rooms. This plan does **not** duplicate that; it adds the **render-side** finish/accent/
  lighting layer the data path can't express (there are no material/finish/lighting-color fields
  in `RoomSpec`, and adding them is forbidden here).
- **Bounded presentation precedent** — the key light and floor seams are already
  "presentation, not room data": renderer-internal, deterministic, applied to every room.
  Theme material/lighting variation is the **same class of change** and follows the same rule.

---

## 4. Exact visual gap this feature fills

1. **No material differentiation.** Fantasy stone and post-apoc metal/concrete share one
   matte finish. Post-apoc should read cooler and slightly more metallic/rougher; fantasy
   warmer and matte.
2. **Dead accent/emissive.** The theme's `accent`/`emissive` never touch a pixel. Focal
   anchors and "strange" props (artifact/machine/candle) should carry a subtle themed emissive
   rim so the room's focal idea reads.
3. **Flat lighting grade.** Ambient/hemisphere/key-light color don't reflect theme, so even a
   correctly-themed palette sits under theme-neutral light.

This is precisely the "theme-driven materials/palette/lighting variation" gap the Fable 5
review flagged as the real remainder of Generated Room Visual Composition.

---

## 5. Design: derive theme at render time (the one real constraint)

The renderer needs the theme but **cannot** be handed `themePack`: that would require an
`App.tsx` prop → `RoomViewer` → `Engine.setRoom` thread, and `App.tsx` changes are forbidden.

**Chosen approach — derive deterministically from `LoadedRoom` data the renderer already
holds.** A pure domain function classifies the theme from the room's own object-type mix
(and, as a tiebreak only, shell hue). This is a *presentation classification*, not authority —
exactly like the key light. It works for fake **and** real-provider rooms, needs no seam, no
schema, no App change.

```
LoadedRoom
  └─ deriveRoomVisualTheme(room): 'fantasy-keep' | 'post-apoc' | null   (pure domain, new)
        └─ themeVocabulary(theme).palette   (existing domain data; activates accent/emissive)
              └─ buildLighting / buildShell / buildObjects apply bounded finish + grade
                    └─ null → today's exact behavior (fallback)
```

**Rejected alternative:** thread `themePack` through `SetRoomOptions`. Cleaner semantically,
but it requires `App.tsx` (owns `ActivePlay.themePack`) to pass a new prop — a **forbidden**
change. Recorded so review sees it was considered.

**Signal (deterministic, content-free):** count validated `RoomObject.type` values only —
never names, prompts, or body text.
- post-apoc markers: `machine`, `corpse`, `debris`, `barricade`, `zombie`, `crate`, `barrel`.
- fantasy markers: `throne`, `altar`, `statue`, `scroll`, `candle`, `rug`, `pillar`.
- Decision rule returns a theme only on a **clear** majority; ties / too-few-markers →
  `null` (neutral). This keeps authored/fallback rooms (e.g. the plain fallback antechamber)
  on today's behavior since they carry no strong marker set.

> **Known consideration (surfaced for review):** the renderer can't distinguish generated from
> authored rooms (no provenance on `LoadedRoom`). The `null`-by-default threshold is the
> mitigation — weak/neutral rooms are untouched. Slice-2 manual eval explicitly verifies the
> authored demo room and the fallback room stay visually acceptable; if any drifts, we tighten
> the threshold, never loosen a safety rule.

---

## 6. Proposed slices (each small, independently testable; implement one at a time)

**Slice 1 — Derive presentation theme (pure domain; no visible change).**
- New `domain/roomVisualTheme.ts`: `deriveRoomVisualTheme(room: LoadedRoom): GeneratedRoomVisualTheme | null`.
- Pure, deterministic, content-free, no I/O/logger. Reuses the `GeneratedRoomVisualTheme` type.
- Ships behind nothing yet — no builder consumes it. Foundation + full unit coverage.

**Slice 2 — Theme-driven lighting grade (renderer).**
- `buildLighting` accepts an optional derived theme; applies a **bounded color grade** to
  ambient/hemisphere/key-light *color temperature* (warm for fantasy, cool for post-apoc)
  while **preserving `RoomSpec` intensities**. `null` theme → byte-identical to today.
- Smallest visible change; easiest to A/B in the manual suite.

**Slice 3 — Theme-driven material finish + accent/emissive (renderer).**
- `buildShell` and the per-type builders take an optional themed finish descriptor derived
  from `themeVocabulary(theme).palette`: per-theme `roughness`/`metalness`, plus a subtle
  `accent`/`emissive` rim on focal/"strange" types (anchor, `artifact`, `machine`, `candle`).
- **Base object hues are preserved** — this changes finish/emissive only, never replaces a
  meaningful `obj.color`. `null` theme → today's finishes.

Order is **locked** (D2): Slice 1 → Slice 2 → Slice 3. Slice 1 is a prerequisite for both;
Slice 2 (lighting) precedes Slice 3 (materials). One slice is implemented at a time, each gated
on approval.

---

## 7. Material / palette / lighting strategy (bounded + deterministic)

- **Palette source of truth:** `themeVocabulary(theme).palette` only. No new color constants;
  `accent`/`emissive` finally get consumers.
- **Materials:** per-theme `{ roughness, metalness }` descriptor (small deltas from today's
  `0.82 / 0.02`), applied to shell + eligible props. Emissive accents are **low intensity**
  (in the range already used by `archBox`/mystery-marker, ~0.2–0.5), never bloom.
- **Lighting:** grade **color only**, within a bounded delta; **intensities stay from
  `RoomSpec`** so authored mood and generator-chosen brightness are respected.
- **Determinism:** pure functions of `(LoadedRoom)`; same room in → same materials/lights out.
  No randomness, clock, or per-frame work. One material per mesh preserved so `disposeObject`
  stays correct.

---

## 8. Fallback behavior

- `deriveRoomVisualTheme` returns `null` on ambiguous/neutral rooms → **every builder falls
  back to today's exact output** (proven by "null === current" tests).
- Missing/partial palette or unknown theme → neutral path.
- No throw path: derivation is total; the renderer never fails to draw a room because of theme.
- Authored / fallback / demo rooms: neutral by threshold; verified in manual eval.

---

## 9. Allowed files / modules

**New:**
- `apps/web/src/domain/roomVisualTheme.ts` (+ `.test.ts`) — pure derivation.

**Edit (renderer only):**
- `renderer/engine/builders/lighting.ts` (+ test) — Slice 2.
- `renderer/engine/builders/shell.ts` (+ test) — Slice 3.
- `renderer/engine/builders/index.ts` and the per-type builder files
  (`documents.ts`, `practicalProps.ts`, `postApocProps.ts`, `storyAnchors.ts`,
  `strangeDevices.ts`) (+ tests) — Slice 3, finish/accent only.
- `renderer/engine/Engine.ts` — only if a builder call-site needs the derived theme passed in
  (Engine derives it locally from `room`; **no `SetRoomOptions`/App signature change**).

**Read-only reuse:** `domain/generatedRoomThemeVocabulary.ts`, `domain/loadRoomSpec.ts`,
`domain/roomSpec.ts`.

---

## 10. Forbidden files / modules (hard boundaries for this feature)

- `App.tsx`, `RoomViewer.tsx`, anything in `app/` — **no changes**.
- `domain/roomSpec.ts` schema / `schemaVersion` — **no changes** (materials/lighting stay
  renderer-derived, never new `RoomSpec` fields).
- Generation: `FakeRoomGenerator.ts`, `OpenAICompatibleRoomGenerator`, `generation/llmRoomPrompt.ts`
  / any prompt — **no changes**.
- `assembleRoom.ts`, `validateRoom`, `repairRoom`, layout/composition normalizers — **no
  changes** (this is a render-time layer, not a pipeline stage).
- Save/load, `SaveGame`/`WorldState`/`QuestSpec`, persistence, server, FTS, facts,
  dialogue-context, memory — **no changes, no writes**.
- Event log / world-session / gameplay authority — **untouched**.
- No new dependency, asset, texture, GLTF, shader, or font.

---

## 11. Tests (targeted, deterministic, no DOM/network)

- **Slice 1:** `roomVisualTheme.test.ts` — post-apoc marker room → `'post-apoc'`; fantasy
  marker room → `'fantasy-keep'`; ambiguous/empty/fallback-antechamber → `null`; purity
  (no mutation, stable output); content-free (never touches names/prompts).
- **Slice 2:** `lighting.test.ts` — themed grade changes light **color** within bounds, keeps
  `RoomSpec` intensities; `null` theme → identical lights to today (regression lock).
- **Slice 3:** `shell.test.ts` + builder tests — themed finish sets expected `roughness`/
  `metalness`; accent/emissive appear only on eligible types and stay low-intensity; base
  `obj.color` preserved; `null` theme → identical materials to today; one-material-per-mesh
  and disposal invariants hold.
- Commands: `npm run test -- roomVisualTheme`, `npm run test -- lighting`,
  `npm run test -- shell`, then `npm run lint` and `npm run build` before hand-off.

---

## 12. Manual evaluation checklist (uses the existing suite as-is)

Run `docs/evaluation/generated-room-manual-evaluation-suite-v0.md` **unchanged** — do not edit
the suite to hide a finding. Focus rows for this feature (theme materials must not regress any
safety-critical row):

- **Visual quality** row should **improve** (cohesive, themed, not placeholder-flat) on
  scenarios **S1** (fantasy keep) and **S2/S4** (post-apoc lab/salvage); confirm the two
  themes read visibly differently.
- **Object placement / composition / NPC presence / exits / objective** rows — **no
  regression** (materials must not obscure anchors, exits, indicator rings, or the player/NPC
  silhouette).
- **NPC idle/wander** and **interaction availability** — unchanged; affordance rings still read
  against the new finishes.
- **Save/load/reload/return smoke** — unchanged; confirm no new state, notice, or console
  surface appears (theme is render-only).
- **Leakage / mutation / movement-stack** safety rows — must stay `2`.
- **Authored/fallback check (feature-specific):** load the authored demo room and force a
  fallback room; confirm both stay visually acceptable and effectively neutral (validates the
  `null`-threshold mitigation from §5).
- Record findings with the suite's rubric/labels; any shortfall is `WEAK`/`POLISH`, and any
  safety-critical `0` is a `BLOCKER` that stops the slice.

---

## 13. Minimum Safe Change Check (AGENTS.md requirement)

- **Reused:** `themeVocabulary`/`palette` (incl. dormant `accent`/`emissive`), existing
  per-type builders, existing lighting/shell builders, `LoadedRoom`, the manual eval suite.
- **New code:** one pure `deriveRoomVisualTheme` (~30–40 lines) + bounded finish/grade
  parameters threaded into existing builders. No new abstraction, service, or state.
- **Boundaries unchanged:** no schema, provider/prompt, App, pipeline, save-load, persistence,
  memory, world-session, or logging change; renderer stays trusted/hand-written; Renderer→Domain
  import needs **no new lint rule**; one-material-per-mesh/disposal preserved.
- **Proof:** targeted unit tests with explicit "`null` theme === today" regression locks, plus
  the existing manual suite.

---

## 14. Review checklist (before hand-off, per approved slice)

- [ ] Only the approved slice's files changed; no `App.tsx`/`app/`/schema/provider/save-load edit.
- [ ] `deriveRoomVisualTheme` is pure, content-free, and total (never throws).
- [ ] `null` theme yields byte-identical rendering to `main` (regression test present).
- [ ] `accent`/`emissive` consumed only at bounded low intensity; base `obj.color` preserved.
- [ ] Lighting intensities still come from `RoomSpec`; only color graded, within bounds.
- [ ] No new dependency/asset/texture/shader; renderer stays trusted and hand-written.
- [ ] One material per mesh; disposal invariant intact.
- [ ] No new log surface; no raw content logged.
- [ ] `npm run test` (targeted) + `npm run lint` + `npm run build` pass and are reported honestly.
- [ ] Manual suite run with the authored/fallback neutrality check; no safety-critical regression.

---

## 15. Resolved decisions (LOCKED by maintainer)

- **D1 — Theme-derivation seam: LOCKED → derive from `LoadedRoom` object-type mix via a pure
  domain function.** Do **not** thread `themePack` through `App.tsx`; the `SetRoomOptions`+App
  alternative is rejected. **No `App.tsx` changes.** No schema, save-load, or provider changes.
  When no confident theme can be derived, `deriveRoomVisualTheme` returns **`null`** and every
  builder preserves today's neutral rendering. (Governs §5, §6 Slice 1, §8.)
- **D2 — Slice order: LOCKED →** (1) `deriveRoomVisualTheme` pure domain helper, then
  (2) themed lighting grade, then (3) themed material finish + accent/emissive. The earlier
  "either 2 or 3 first" option is closed. (Governs §6.)
- **D3 — accent/emissive scope: LOCKED →** apply `accent`/`emissive` to **focal anchors and
  strange/special props only** (anchor types + `artifact`, `machine`, `candle`). Do **not**
  broadly apply accent/emissive to documents, practical props, or every object; all other
  objects keep their base color/finish. (Governs §6 Slice 3, §7, §11 Slice 3 tests.)

Implementation remains gated on plan approval; the choices above are fixed and must not drift
during coding.

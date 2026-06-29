# ADR-0053: Return Exit Visual Affordance v0 — distinct presentation for return exits

- **Status:** Accepted — implemented
- **Date:** 2026-06-29
- **Implemented:** 2026-06-29
- **Deciders:** Project owner
- **Extends:** [ADR-0052](./ADR-0052-generated-room-bidirectional-links-v0.md) (generated room
  bidirectional links — `ensureGeneratedReturnExit`, `:return-exit:` id namespace, the
  generated-play pregenerator `ensureReturnExits` option). This ADR is a **presentation-only
  follow-up**; it does not supersede any decision in ADR-0052.
- **Related:** [ADR-0036](./ADR-0036-generated-room-interaction-affordances-v0.md) (generated
  room interaction affordances — `AFFORDANCE_RING_COLOR`, `buildInteractableIndicator`,
  `affordanceFor`),
  [ADR-0041](./ADR-0041-generated-room-exit-navigation-v0.md) (generated room exit
  navigation — forward exit arch color `#9a9488`, `ensureGeneratedExitNavigation`),
  [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) (data-only RoomSpec /
  trusted renderer boundary)

> Full pre-code design in the implementation plan
> [`return-exit-visual-affordance-v0`](../implementation-plans/return-exit-visual-affordance-v0.md).

---

## Context

ADR-0052 gave every generated adjacent room a data-only return exit pointing back to the parent
room. The topology data works correctly, including nested A → B → C → B → A traversal. However,
the **player cannot tell which arch goes back and which goes forward** until they walk up close
enough to read the HUD prompt.

Both the forward exit (inserted by `ensureGeneratedExitNavigation`, id namespace
`:generated-exit:`) and the return exit (inserted by `ensureGeneratedReturnExit`, id namespace
`:return-exit:`) use:

- the same arch mesh color: `#9a9488` (grey-brown)
- the same affordance: `exit`
- the same floor ring color: `AFFORDANCE_RING_COLOR.exit = '#6bbcff'` (cyan)

The only existing differentiator — the HUD prompt "Return to previous room" vs "Enter next room"
— is only visible when the player stands close to the arch. From across an 18 × 18 m room, both
arches look identical.

The fix must be **presentation-only**: no navigation semantics change, no RoomSpec schema change,
no new affordance kind, no provider or objective change.

**Key enabling fact.** Return exits already carry a structurally distinct id namespace:
`{roomId}:return-exit:{side}`. This was deliberately chosen in ADR-0052 to be collision-safe
with `:generated-exit:`. The same namespace can be used as a pure, content-free, deterministic
detector in both the domain (arch color) and the renderer (ring color).

---

## Decision

### Two complementary visual levers

#### Lever 1 — Return arch mesh color (domain layer)

Change `ensureGeneratedReturnExit`'s inserted arch from the grey `#9a9488` to a distinct
**`RETURN_EXIT_ARCH_COLOR = '#c084fc'`** (purple/lavender). The arch mesh is 3.5 m tall and
readable from across the room; this is the more important lever for the stated "from a distance"
problem.

The color is a new named export in `domain/generatedReturnExit.ts`. It is hand-written and
deterministic — no LLM, no schema, no provider call.

#### Lever 2 — Return floor ring color (renderer layer)

In `buildObjects` (renderer/engine/builders/index.ts), after the affordance is derived, check
whether the object is a return exit via the pure domain predicate `isReturnExitObject(obj)`. If
true, use a distinct **`RETURN_EXIT_RING_COLOR = '#f472b6'`** (pink/rose) instead of the normal
`AFFORDANCE_RING_COLOR.exit` cyan. Non-return exits (forward generated exits, authored exits)
continue to receive cyan.

The ring color is a new named export in the renderer builders file. No new layer, no new file.

### Detection: `isReturnExitObject(object: RoomObject): boolean`

```ts
export function isReturnExitObject(object: RoomObject): boolean {
  return typeof object.id === 'string' && object.id.includes(RETURN_EXIT_ID_INFIX)
}
```

- `RETURN_EXIT_ID_INFIX = ':return-exit:'` is the shared structural infix already used by
  `uniqueReturnExitId`. Exporting it as a constant prevents build/predicate drift.
- Detection is purely structural (id namespace), not content-based (no prompt/body reading).
- The predicate is pure and domain-only; the renderer imports it through the already-allowed
  domain → renderer import direction.
- False-positive risk is negligible: authored room ids (e.g. `throne-room`) and forward generated
  exit ids (`:generated-exit:`) do not contain `:return-exit:`.

### What is NOT changed

- Navigation semantics. Return exits continue to resolve exactly as before.
- `RoomSpec` schema / `loadRoomSpec` / `validateRoom` / `repairRoom`. The `color` field is
  already a standard `RoomObject` arch field; the value change is within the existing schema.
- The `Affordance` union (`exit` / `inspect` / `talk` / etc.). Return exits remain `exit`.
- `AFFORDANCE_LABEL` and the HUD chip. "Exit" chip and prompt are unchanged.
- `buildInteractables` / the `Interactable` view-model / `affordanceFor`. Unchanged.
- Forward exit arch color (`#9a9488`). Unchanged.
- Forward exit ring color (`AFFORDANCE_RING_COLOR.exit = '#6bbcff'`). Unchanged.
- Authored / demo exits. `isReturnExitObject` returns `false` for authored arches; they keep the
  existing cyan ring and grey arch.
- `ensureGeneratedExitNavigation` (forward exits). Untouched.
- `AdjacentRoomPregenerator`, `NavigationService`, world-session, objective pipeline,
  providers, persistence, backend, or save/load. None touched.
- Logging. No new log surface; `isReturnExitObject` is silent.

---

## Color palette

| Context | Hex | Visual |
|---|---|---|
| Forward arch mesh | `#9a9488` | grey-brown |
| Return arch mesh | `#c084fc` | purple/lavender |
| Forward floor ring (`AFFORDANCE_RING_COLOR.exit`) | `#6bbcff` | cyan |
| Return floor ring (`RETURN_EXIT_RING_COLOR`) | `#f472b6` | pink/rose |

The purple + pink palette is distinctly warm-toned vs the grey + cyan of forward exits. No
existing affordance ring color (inspect `#ffcf6b`, talk `#6fe39a`, approach `#ff7048`, take
`#ffd84d`, use `#9b7cff`) is close enough to cause confusion within a single room.

**Known limitation:** distinction is color-only. Colorblind iconography/shape differentiation is
explicitly out of scope for v0.

---

## Safety

- `color` on an arch object is an existing `RoomSpec` field. Changing the value in the domain
  helper does not add a schema field and does not require a schema version bump.
- Re-validation in the pregenerator already runs after `ensureGeneratedReturnExit`; the new
  color is a string in the same schema position as before and passes validation.
- `isReturnExitObject` is pure, total, and side-effect-free. It cannot mutate state.
- The renderer-layer predicate call sits at the same point as the existing affordance call
  (`affordanceForInteractableObject`) — no new engine loop, no new mesh, no new light.
- No generated executable code is introduced. The renderer still executes only trusted,
  hand-written builders; the color comes from a hand-written constant, not from provider output.

---

## Non-goals

- No new affordance kind (`return-exit`).
- No HUD chip/label change for return exits.
- No arch geometry or shape change (no special door/arrow mesh).
- No door/exit animation.
- No colorblind iconography (shape/icon differentiation deferred).
- No minimap or map topology display.
- No named/destination-aware labels on return arches.
- No authored/demo bidirectional links.
- No persistence of generated map links.
- No provider, prompt, objective, world-state, or navigation-contract change.

---

## Consequences

Forward exits and return exits are visually distinguishable from across the room: forward arches
are grey + cyan ring; return arches are purple + pink ring. The player can identify which arch
to use before walking to it. Up close, the HUD prompt still reads "Enter next room" vs "Return
to previous room", providing a second layer of confirmation.

The change is a small, presentation-only extension of ADR-0052: two color constants, one pure
domain predicate, and a one-branch renderer change. Every schema, navigation-contract,
world-state, renderer trust boundary, provider, objective, and persistence boundary is preserved.

Future slices can add colorblind iconography, named/destination-aware labels, save/load
persistence of generated map links, or a minimap without changing this v0 guarantee.

# ADR-0006: Compositional object/entity builders

- **Status:** Accepted — **direction for future object/character work** (v0
  primitive builders remain acceptable)
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

v0 renders each object type with a small hand-written builder (`throne`,
`pillar`, `npc`, …) keyed by a registry. That is fine for a handful of static
props. But the product will need many characters and objects — soldier, woman,
man, zombie, giant, king, merchant, and countless combinations.

Writing **one bespoke builder per entity type** does not scale:

- combinatorial explosion (every body × outfit × equipment × role is a new
  function),
- duplicated limb/posture/anchoring logic copied across builders,
- unmaintainable and error-prone, and it violates SRP / OCP / DRY.

At the same time, the trust boundary
([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)) must hold: the
LLM must never generate geometry or builder code.

## Decision

Adopt **compositional builders**. An entity is *assembled* by the renderer from
a **trusted part library** along a fixed set of dimensions:

- **base body type** — e.g. `humanoid` (later: quadruped, etc.)
- **appearance parts** — head/face/skin variations
- **clothing / outfit** — robe, armor, rags, …
- **equipment** — weapon, helmet, bag/wares, …
- **size / scale modifiers** — overall scale, limb heaviness
- **material / color palette**
- **role / preset** — a named bundle of the above (e.g. `soldier`)
- **interaction / behavior metadata** — interaction key/prompt, behavior tags

Examples (composition, not new code):

| Entity | Composition |
| --- | --- |
| soldier | humanoid + armor + helmet + weapon |
| zombie | humanoid + damaged posture + pale skin + torn clothes |
| giant | humanoid + large scale + heavy limbs + monster traits |
| merchant | humanoid + robe + bag/wares |

Rules:

1. **RoomSpec stays data-only.** A spec selects a preset and/or lists parts +
   parameters. No geometry, no code.
2. **The LLM may pick safe presets/parts/params** from the published vocabulary,
   but **never generates geometry or builder code.**
3. **The renderer owns the trusted part library and assembles the entity
   safely.** Unknown parts/presets degrade gracefully (placeholder), like
   unknown object types do today.
4. **v0 primitive builders are acceptable.** This ADR governs how the object
   system *grows*; it is not a mandate to rebuild v0.

## Consequences

- A new entity is usually a new **data combination**; occasionally a new
  **part** is added to the library (and reviewed); almost never a new bespoke
  builder. This is OCP/DRY in practice.
- Presets give the LLM a **bounded, safe vocabulary**, which both improves
  generation quality and reinforces the trust boundary.
- Up-front design cost when the time comes: a part taxonomy, a composition
  schema (additions to RoomSpec), and an assembler in the renderer. That work is
  deferred until character expansion actually begins — building it now would be
  over-engineering ([AGENTS.md](../../../AGENTS.md) rule 13).
- The placeholder/degradation behavior from
  [FAILURE-MODES](../FAILURE-MODES.md) extends naturally to unknown parts.

## Alternatives considered

- **One bespoke builder per entity type** — rejected: combinatorial explosion,
  duplication, unmaintainable.
- **LLM-generated geometry/builder code** — rejected: violates the data-only
  trust boundary ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **A single mega-builder with giant conditionals** — rejected: just the
  one-off problem hidden inside one function; not composable or testable.

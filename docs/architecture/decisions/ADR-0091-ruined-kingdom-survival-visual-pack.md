# ADR-0091: Ruined Kingdom Survival uses one closed visual-pack registry, one shared humanoid rig, and weighted rendering budgets behind the existing trusted Three.js boundary

- **Status:** **Accepted; implementation is split into reviewable slices.**
- **Date:** 2026-07-10
- **Deciders:** Project owner
- **Extends / builds on:** [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md), [ADR-0002](./ADR-0002-react-three-boundary.md), [ADR-0006](./ADR-0006-compositional-entity-builders.md), and [ADR-0008](./ADR-0008-renderer-portability-strategy.md).

> Detailed vocabulary, file scope, slices, verification, and licensing rules live
> in [the implementation plan](../implementation-plans/ruined-kingdom-survival-visual-pack.md).

---

## Context

The renderer boundary is already correct: generated text becomes data, then
passes parsing, closed alias repair, schema loading, deterministic normalization,
semantic validation, and repair/fallback before trusted, hand-written Three.js
code sees it. `WorldSession` and its event-log projection remain authoritative;
the renderer emits interaction intent and displays projections.

The presentation inside that boundary is not production quality. The player is
a blue capsule; NPCs and zombies are primitive mannequins; animation is root
bobbing; props are diagrams; the shell is four boxes; and interaction resolution
does not visibly open, empty, lock, read, activate, burn, or damage an object.
Raw object-count limits also discard rich layouts even when hundreds of pieces
would be inexpensive to instance.

The feature needs one cohesive fantasy-kingdom/survival presentation without
letting generated content choose files, nodes, materials, clips, shaders, or
renderer instructions. It must improve the existing renderer, not create a
parallel character or scene system.

## Decision

### Preserve the trusted renderer boundary

`RoomSpec` remains renderer-agnostic, validated, versioned data. Additive visual
fields expose only closed semantic values: environment, family/kind, safe
variant, static condition, and humanoid appearance preset. They expose no model
URL, path, bundle id, node name, texture, material, shader, animation clip,
script, callback, or free-form renderer instruction.

`VisualPackId` is trusted app configuration and never generated data. The
production id is `ruined-kingdom-survival`. The renderer owns fixed bundle
locations, reviewed GLTF node names, materials, animation clips, collision
profiles, render costs, license references, and fallback mappings.

### Use one closed `VisualPackRegistry`

Resolution is frozen, exhaustive, deterministic, and follows:

```text
exact semantic variant + visible state
-> object-family default
-> environment-compatible family default
-> neutral production fallback
-> development-only debug fallback
```

The blue/purple seal, blue player capsule, and primitive geometry are debug or
emergency diagnostics only. Supported production rooms never display them. If
the neutral production bundle cannot load, production shows a fixed
asset-unavailable surface rather than inventing geometry or leaking a path.

Every canonical object and generated alias has a catalog row covering exact
mapping, fallbacks, interaction support, visible states, collision, license, and
tests. New semantic families add architecture, furniture, clutter, vegetation,
and light fixtures without exposing asset identities to RoomSpec.

### Use one shared humanoid system

One `HumanoidCharacterFactory` serves the renderer-owned player, human NPC role
presets, guards, villagers, merchants, nobles, servants, wanderers, raiders,
zombies, and bipedal humanoid monsters compatible with the same skeleton. It
composes trusted body, head, hair, clothing, armour, palette, accessory, and
infection pools. Exact parts are selected deterministically from stable
room/object identity and the closed preset.

Each character keeps the existing logical movement/interaction root and adds a
child visual-facing root. The child turns toward velocity without changing
RoomSpec or movement authority. Bones and mixers are per instance; immutable
geometry, textures, and clips are cache-shared. Player, NPC, zombie, and role
variations are presets over this factory, never parallel builders.

Animation intents are `idle`, `walk`, `run`, `talk`, `gesture`, `inspect`,
`pick-up`, `sit`, `carry`, `hurt`, `zombie-idle`, and `zombie-walk`.
Existing movement, dialogue, routine, chase, and interaction signals select
presentation only. Clips add no sprint, carrying, sitting, combat, or health
gameplay.

Non-humanoid creatures are outside this rig. Quadrupeds, spiders, flyers, and
other body plans require separate future rig contracts and must not be forced
through the humanoid skeleton.

### Project visible state from existing truth

Static `intact | weathered | damaged | burned | overgrown` conditions are
validated RoomSpec presentation. Dynamic `none | closed | open | locked | looted
| read | activated` states are pure projections from existing authoritative
interaction flags and generated-gate evaluation.

The renderer receives neutral presentation states through the approved
`RoomViewer` seam and updates live without an engine remount. It writes no world
state. Interaction precedence remains `exit -> encounter -> dialogue -> effect`.
Generated assembly may remove a purposeless body-only affordance, but never
invents loot or effects.

### Replace small raw count limits with weighted budgets

There is no production design-time object-count limit. Rich rooms may retain
hundreds of cheap static pieces. A separate high envelope ceiling may reject
parser/memory abuse; it is not a rendering budget and does not truncate normal
rooms.

The runtime budget measures triangles, draw calls, decoded texture bytes,
skinned characters, animation mixers, local and shadow lights, particles,
blended transparency, shadow casters, and collision bodies. Degradation is:

1. instance identical state-invariant static objects;
2. choose lower LODs;
3. keep the player and nearest/interactive humanoids rigged, with static LODs for excess distant humanoids;
4. suspend excess mixers;
5. convert excess local lights to emissive-only fixtures;
6. disable excess particles;
7. replace blended transparency;
8. disable low-priority mesh shadows;
9. select lower-cost family, environment, or neutral production assets.

Exits, story anchors, interactions, NPC identity, and semantic objects stay
present. Local lights do not cast shadows; the profile has at most one
shadow-casting directional light.

### Give the asset cache explicit ownership

Bundles are lazy and fixed-path. A cache outside a room-engine lifecycle owns
loaded source scenes, shared geometry, textures, materials, and clips. Room
instances acquire leases and own cloned scene nodes, skeletons, mixers, and
bounded material overrides. Scene traversal never disposes cache-owned
resources. Final cache teardown frees shared GPU resources exactly once after
mixers stop and uncache.

Stateful/interactable objects are unique. Static identical state-invariant
objects may be instanced. Collision is a closed 2D circle/box/none profile,
renderer-local and deterministic; it adds no physics engine and preserves all
four exit gaps.

### Keep story-driven generation and authority unchanged

The LLM still selects semantic NPC concepts, objects, and composition from the
story through validated RoomSpec fields. Showcases are dev/test fixtures, not
templates or caps on generated rooms.

This decision adds no `WorldEvent`, `WorldCommand`, authoritative `WorldState`,
backend, memory, DB migration, or renderer write path. Save/cache projections
preserve optional RoomSpec fields; dynamic visuals reconstruct from existing
flags and gate results.

## Asset and licensing decision

Use a grounded low-poly pack readable from the isometric camera, with a small
core and lazy bundles totaling about 35-50 MB. Acquire only reviewed downloadable
CC0 sources. Every binary and registry descriptor needs a manifest entry with
creator, official page, acquisition date, SPDX id, license URL, original archive
name/SHA-256, included nodes, and modifications. Attribution is retained; asset
licensing remains separate from the repository code license.

GLBs are self-contained, meters, Y-up, forward +Z, based at y=0, with cameras,
lights, scripts, remote references, unused nodes, and unused clips stripped.
Verification rejects undeclared nodes, unsupported extensions, missing
checksums/licenses, or undocumented size exceptions.

## Consequences

Benefits are cohesive generated rooms, one reusable rig, scalable rich layouts,
visible feedback from existing truth, testable cache ownership, and auditable
provenance. Costs are asset curation, retargeting/LOD/atlas work, stricter
resource ownership, explicit save/cache projection updates, and an exhaustive
semantic catalog.

Main risks are double-disposal, shared bone state, stateful objects accidentally
instanced, visual/gameplay divergence, collision-blocked exits, mixed styles,
debug fallback leakage, and optional fields lost during persistence. The plan
requires targeted tests for each.

## Rejected alternatives

- Generated model/material/texture/clip paths or shader instructions.
- Runtime-downloaded or runtime-generated production assets.
- A separate capsule player or procedural NPC production path.
- Forcing non-humanoid creatures through the shared skeleton.
- Fixed showcase rooms as the normal generation path.
- Any 5-10, 30, or other small production object-count cap.
- A physics engine, combat, or unrelated gameplay to justify the assets.

## Hard boundaries

- No paths, URLs, materials, shaders, clips, node names, or renderer instructions in generated/persisted data.
- No executable generation or renderer imports in the domain.
- No gameplay writes from visual state, animation, collision, UI, or cache.
- No renderer import of React, persistence, server, network, memory, dialogue, encounters, interactions, or world-session internals.
- No combat, weapon physics, multiplayer, voice, runtime asset generation, or non-humanoid rig.
- Supported production content never uses debug seals, primitive debug geometry, or the blue capsule.

## Verification

Acceptance requires schema/red-team tests, exhaustive registry/alias/fallback
coverage, weighted rich-layout tests, cache/clone/disposal tests, collision and
four-exit tests, live visible-state integration, save/load round trips,
production debug-fallback invariants, binary/license verification, three
showcase smokes, `git diff --check`, lint, build, and the full test suite.

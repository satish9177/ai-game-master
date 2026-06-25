# ADR-0032 — Generated Room Composition v0

**Status:** Implemented

## Context

The generated-room layout contract ([ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md))
made generated rooms spatially safe: shells are bounded, objects stay inside the
floor, spawn is usable, and exits land on walls. Safety alone did not make the
rooms read as deliberately arranged spaces. Valid rooms could still feel like
random prop clusters, with a blocked central path, a throne at an arbitrary point,
NPCs standing in the route, and clues or resources lost among decorative objects.

This is a composition problem, not a content-generation or renderer problem. The
existing objects are sufficient; they need a deterministic spatial pass before
the final spawn and exit safety normalizers run.

## Decision

Add the pure `domain/generatedRoomComposition.ts` helper and call
`composeGeneratedRoom` from `assembleRoom` after generated object legality repair
and before the spawn and exit finalizers:

```
clampGeneratedShell
  → repairGeneratedObjects
  → composeGeneratedRoom
  → repairGeneratedSpawn
  → repairGeneratedExits
  → validateRoom
```

Composition is generated-room-only, deterministic, non-mutating, and arranges
existing objects only. It does not add, remove, or reinterpret content.

### Composition behavior

- Keep a clear central north/south corridor by relocating eligible clutter to
  side zones.
- Place the first throne, when present, in the north-center anchor zone. Missing
  anchors are diagnostic information only.
- Move NPCs out of the central corridor to a room flank.
- Move interactable clues and resources out of the corridor so they remain
  visible and readable.
- Push eligible decorative and structural-looking clutter, including pillars and
  non-exit arches, toward side zones. Wall-light torches remain under the layout
  contract, and exit-carrying objects remain for the exit finalizer.
- Preserve object count and every non-position field. No NPC, throne, clue,
  chest, light, resource, interaction, or quest object is invented or removed.

The helper also exposes role classification and zone computation as pure APIs for
focused tests. Its output uses the same-reference convention when no relocation is
needed.

### Provenance and fallback behavior

Composition is a benign normalization. A composition-only change keeps
`provenance: generated`, sets no `failedStage`, and does not show the existing
repaired/fallback notice. Only the existing `repairRoom` path produces
`provenance: repaired`; pipeline failure still produces `provenance: fallback`.

Missing anchors or interactables do not fail validation, trigger repair, or select
the fallback. They are reported only through three log-safe booleans:

- `composed`
- `lacksAnchor`
- `lacksInteractable`

Fallback results set these diagnostics to safe `false` defaults. The diagnostics
contain no raw generated JSON, prompt text, provider body, room or object text, or
API key.

### Scope boundary and non-goals

- Authored rooms, `StaticRoomSource`, and the trusted fallback room are untouched.
- No provider prompt or provider behavior changes.
- No content invention, story engine, quest generation, or living-world
  simulation.
- No renderer rewrite or renderer behavior change.
- No backend, API, persistence, memory, world-session, or gameplay change.
- No LLM reviewer, repair loop, or fallback for composition quality.

## Consequences

**Good:**

- Spatially safe generated rooms now read as intentional spaces rather than random
  prop clusters.
- Spawn and exit finalizers retain the final safety say because they run after
  composition.
- Provenance and user-facing notice semantics remain accurate.
- The pass is pure, deterministic, independently testable, and renderer-agnostic.

**Trade-offs:**

- Composition recognizes only the existing closed object vocabulary and simple
  structural interaction presence; it does not understand narrative meaning.
- Missing anchors and interactables remain accepted. The pass reports absence but
  deliberately does not invent content or judge story quality.
- Zone placement is intentionally simple and deterministic rather than a general
  collision solver or procedural level designer.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Trust boundary unchanged: composition transforms validated data only; the trusted renderer remains hand-written |
| [ADR-0010](./ADR-0010-generation-foundation-v0.md) | Adds one pure stage to the existing generated-room assembly pipeline |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Repair/fallback behavior and notice semantics are unchanged |
| [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) | Provider output still enters the same assembly boundary; prompts and provider behavior are unchanged |
| [ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md) | Runs after object legality repair and before spawn/exit finalizers; layout safety remains authoritative |
| [ADR-0034](./ADR-0034-generated-room-story-anchors-v0.md) | Broadens the focal anchor selector while preserving composition's generated-room-only, data-only scope |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds only three fixed boolean diagnostics; no generated or user content is logged |

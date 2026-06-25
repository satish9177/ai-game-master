# ADR-0033 — Generated Room Visual Vocabulary v0

**Status:** Implemented

## Context

The generated-room layout contract ([ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md))
made generated rooms spatially safe, and generated-room composition
([ADR-0032](./ADR-0032-generated-room-composition-v0.md)) made them feel more
arranged. The next visible failure was readability: rooms were safe and composed,
but many objects still appeared as placeholders or repeated mystery markers. The
player could not reliably distinguish documents, containers, bodies, tables,
anchors, devices, artifacts, candles, and generic clutter.

The root cause was not a need for model-authored rendering code. The safe renderer
already owns the only executable scene code. The missing piece was a broader,
trusted RoomSpec vocabulary with hand-written procedural builders, plus a few
generated-room-only pre-validation normalizers for common provider drift.

## Decision

Expand the safe RoomSpec visual vocabulary and renderer registry with first-class
object types:

- `book`, `paper`, `map`
- `chest`, `corpse`, `table`
- `altar`, `statue`
- `machine`, `artifact`, `candle`

Keep `schemaVersion: 1`. The change is additive to the existing generated object
vocabulary and remains within the data-only RoomSpec contract.

Each new type has a trusted procedural Three.js builder using existing primitives
and materials. No external assets, textures, GLTF, shaders, fonts, labels, custom
shaders, or dependencies were added. The LLM still generates data only, never
renderer code, builder names, mesh names, material programs, or executable scene
logic.

Skipped or malformed objects still remain `LoadedRoom.skipped` and render as a
bounded non-interactive mystery marker. The old magenta placeholder cube was
replaced by an intentional mystery marker so unsupported content is visible
without looking like a renderer breakage.

## Generated-room pre-validation normalizers

Real providers still sometimes emit useful intent in slightly invalid data. To
reduce unnecessary mystery markers without weakening validation, generated rooms
now run two pre-validation normalizers inside `assembleRoom`, after `JSON.parse`
and before `loadRoomSpec`:

1. **Alias repair.** A fixed allowlist maps common natural-language noun type
   strings to canonical RoomSpec types, for example `desk → table`,
   `skeleton → corpse`, `floor plan → map`, and `generator → machine`. This is
   type-only repair: all other fields remain subject to normal validation.
2. **Optional transform repair.** Malformed optional `rotationY` and `scale`
   fields are removed so schema defaults apply. Required fields such as
   `position`, required interactions such as `scroll.interaction`, colors,
   dimensions, object purpose, and gameplay data are not repaired.

Normal validation remains authoritative. Unknown types, malformed required
fields, invalid interactions, bad positions, invalid dimensions, invalid colors,
or anything outside these narrow generated-room normalizers still gets skipped or
falls through the existing repair/fallback pipeline.

## Pipeline position

The generated-room assembly path is now:

```
JSON.parse
  → repairGeneratedAliases
  → repairGeneratedObjectTransforms
  → loadRoomSpec
  → clampGeneratedShell
  → repairGeneratedObjects
  → composeGeneratedRoom
  → repairGeneratedSpawn
  → repairGeneratedExits
  → validateRoom
  → repairRoom / fallback when needed
```

Authored/static/restored/fallback rooms do not pass through the generated-room
pre-validation normalizers. Direct `loadRoomSpec` behavior remains strict.

## Provider and fake generator behavior

The deterministic fake generator now emits a small, safe sample of the expanded
vocabulary so browser QA can see the objects without relying on a real provider.

The real provider prompt advertises the full safe vocabulary, requires exact
allowlisted `object.type` strings, and includes synonym guidance such as
`notes/letter/parchment → paper or scroll`, `door/doorway/gate → arch`, and
`trash/rubble/broken parts → debris`. If unsure, the model is told to use `prop`
rather than invent a type.

The prompt still asks for concise RoomSpec JSON data only. It does not ask for
Three.js, builder names, renderer hints, GLTF, textures, shaders, external assets,
or executable code.

## Provenance and diagnostics

Visual vocabulary, alias repair, and optional transform repair are benign
normalizations for generated rooms. When the resulting room validates, provenance
stays `generated`, `failedStage` remains absent, and the repaired/fallback notice
is not shown.

New diagnostics are count-only and log-safe:

- `aliasesRepaired`
- `objectTransformsRepaired`
- `skippedObjectReasonCounts`

They never contain raw prompt text, provider request/response bodies, generated
JSON, raw skipped objects, object names, room names, story text, raw type strings,
transform values, or API keys.

## Non-goals

- No LLM-generated Three.js, JavaScript, JSX, renderer code, or executable code.
- No external assets, textures, GLTF, shaders, fonts, labels, or dependencies.
- No backend, API, memory, persistence, world-session, or gameplay changes.
- No story engine, quest generation, living-world simulation, inventory, loot,
  combat, power system, puzzle system, or object-purpose behavior.
- No interaction repair. `invalidInteraction` remains deferred because
  interactions are content/gameplay-bearing.
- No position repair before validation. `invalidPosition` remains deferred.
- No fuzzy alias matching, substring matching, stemming, or model-output
  interpretation beyond the explicit alias allowlist.
- No raw prompt/provider/generated JSON logging.

## Consequences

**Good:**

- Generated rooms are more visually readable at the isometric gameplay camera
  scale.
- Common real-provider noun drift is normalized into safe canonical types instead
  of producing many skipped mystery markers.
- Malformed optional transform fields no longer skip otherwise-valid generated
  objects.
- The renderer trust boundary is preserved: all visuals are hand-written,
  deterministic, procedural builders over validated data.
- Authored/static/restored/fallback rooms remain untouched.

**Trade-offs and limitations:**

- Real providers can still produce a small number of skipped objects, especially
  `invalidInteraction` cases.
- `invalidInteraction` repair is intentionally deferred to a future
  interaction/object-purpose feature.
- Alias repair is intentionally conservative and allowlisted; unsupported nouns
  still skip rather than being guessed.
- Structural tests cover builder registry, deterministic bounds, and log-safe
  diagnostics, but manual/browser QA remains important for visual taste.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves the data-only RoomSpec → trusted renderer boundary |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds only count-safe diagnostics; no raw generated/user/provider content |
| [ADR-0010](./ADR-0010-generation-foundation-v0.md) | Expands generated-room data vocabulary while keeping the same generation seam |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Repair/fallback semantics and notice behavior are unchanged |
| [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) | Hardens real-provider prompting while keeping provider output untrusted text |
| [ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md) | Visual vocabulary sits after the layout safety contract in assembly |
| [ADR-0032](./ADR-0032-generated-room-composition-v0.md) | Composition arranges the now-readable existing objects |

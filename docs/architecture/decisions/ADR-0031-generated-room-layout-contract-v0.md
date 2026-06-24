# ADR-0031 — Generated Room Layout Contract v0

**Status:** Implemented

## Context

The opt-in `OpenAICompatibleRoomGenerator` ([ADR-0023](./ADR-0023-real-room-generator-provider-v0.md))
and the real DeepSeek and OpenAI providers it wraps produce valid `RoomSpec` JSON
that passes `loadRoomSpec` schema validation and even `validateRoom` semantic
validation — yet the rooms are still **spatially broken in practice**:

- **Tiny or huge shells.** A real DeepSeek room arrived as 5 × 5 m — playable
  by `validateRoom`'s loose size rule (min 4 m), but far too cramped to navigate
  or play. Others arrived at 30 × 30 m or larger. Neither case triggers the
  existing repair/fallback path.
- **Objects outside the floor.** Props, barrels, and crates were placed at X/Z
  coordinates beyond the wall faces — technically a valid `RoomSpec` position, not
  caught by the loose bounds-check in `validateRoom`, but rendered floating in
  empty space by the trusted builders.
- **Overcrowded object lists.** 50–70 objects in a single room is clutter the
  renderer must build and the player must navigate around; the existing soft object
  budget is 60, but soft means warn-only.
- **Spawn outside or crowded.** The player spawn landed beyond the wall, or directly
  on top of a throne or pillar, making the first frame unplayable. The existing
  `repairRoom` pass fixes this — but that raises `provenance: repaired` and
  triggers the dismissable notice for what is really just a minor geometry fix.
- **Exit arches misplaced.** Arch objects carrying `interaction.exit` were placed
  in the middle of the floor or at arbitrary positions rather than at wall faces,
  making navigation arches invisible or unreachable.

All five problems have the same root cause: real LLMs treat the `RoomSpec`
coordinate space as approximate. The existing `repairRoom` (spawning outside →
clamp, objects over hard budget → truncate) does handle some of these — but
raising `provenance: repaired` and showing the dismissable notice for a purely
geometric mismatch is wrong: the room's *content* is fine; only its *layout
numbers* are off.

## Decision

Add a **pure domain module** `domain/generatedRoomLayout.ts` that defines the
generated-room size envelope, helper predicates, and four benign layout
normalizers. Integrate the normalizers as **stages 2.5–2.8 in `assembleRoom`**
between `loadRoomSpec` (stage 2) and `validateRoom` (stage 3).

### Product constants

```
DEFAULT_SIZE = 18 m   (width and depth default for a generated room)
MIN_SIZE     = 14 m   (floor for width/depth clamp)
MAX_SIZE     = 24 m   (ceiling for width/depth clamp)
MAX_OBJECTS  = 30     (benign object-count cap, below the soft budget of 60)
```

### Four benign normalizers (stages 2.5–2.8)

| Stage | Function | What it does |
| --- | --- | --- |
| 2.5 | `clampGeneratedShell` | Clamps `width` and `depth` individually to `[14..24]`. Height is unconstrained. |
| 2.6 | `repairGeneratedObjects` | Clamps each object's X/Z into the walkable floor area (same wall-clearance margin as `validateRoom`), then caps total object count at 30; drops decorative objects first, then structural; never drops critical objects (NPC, scroll, interactive arch, interactive crate/barrel/debris/barricade/zombie). |
| 2.7 | `repairGeneratedSpawn` | Clamps spawn X/Z into the playable floor area, then searches a small deterministic candidate set (origin, ±step in four cardinal directions) for a position not crowded by a spawn-blocking object. |
| 2.8 | `repairGeneratedExits` | Snaps each exit-carrying object to the nearest wall face (north: `z = −halfD`; south: `z = +halfD`; east: `x = +halfW`; west: `x = −halfW`). Tie-broken north > south > east > west. |

### Provenance stays `generated`

All four stages are **benign normalizations**, not playability repairs. They run on
every generated room regardless of semantic validation outcome. Their results are
exposed via four safe boolean diagnostics (`sizeRepaired`, `objectsRepaired`,
`spawnRepaired`, `exitsRepaired`) for logging only. **The host shows no notice** for
a normalized-only room. Only a `repairRoom` pass (stage 4) produces
`provenance: repaired`; only a pipeline failure produces `provenance: fallback`.

### Scope boundary

- Normalization applies **only in `assembleRoom`** for generated rooms. It is
  never applied to authored rooms, `StaticRoomSource`, the fallback room, or any
  Node/server/memory/persistence path.
- `validateRoom`, `repairRoom`, the fallback room author, `GeneratedRoomSource`,
  and the renderer are **unchanged**.
- No backend, provider, memory, gameplay, world-session, or persistence change.
- No new ESLint block is needed: `domain/generatedRoomLayout.ts` is a peer of
  `domain/repairRoom.ts` and is covered by the existing domain import rules.

### Safe diagnostics

The four boolean flags (`sizeRepaired` / `objectsRepaired` / `spawnRepaired` /
`exitsRepaired`) are the only new surface in `RoomDiagnostics` and in the log
line emitted by `GeneratedRoomSource`. They never carry raw generated JSON, prompt
text, provider body, room names, object text, or API keys.

## Consequences

**Good:**

- Real LLM-generated rooms always arrive at the renderer with spatially sensible
  floor dimensions, in-bounds objects, a safe player spawn, and wall-placed exit
  arches — without ever triggering the repair/fallback notice for what is purely a
  geometric correction.
- The dismissable notice remains accurate: it fires only for genuine playability
  repairs (`repairRoom`) or pipeline failures (fallback).
- Authored and static rooms are completely unaffected — the size envelope,
  object-count cap, and spawn/exit repair are generated-room-only concerns.
- `validateRoom` and `repairRoom` are unchanged; the new normalizers are additive.

**Known follow-up:**

Object-bounds repair (stage 2.6) currently clamps every object's X/Z into the
playable interior **before** exit repair (stage 2.8) snaps exit-carrying objects
back to a wall face. For an exit arch that is simply misplaced (not otherwise
out-of-bounds), this causes both `objectsRepaired` and `exitsRepaired` to be
logged true when only `exitsRepaired` was semantically needed. Near room corners,
it can also cause a small nearest-wall drift: the clamp moves the arch to the
corner of the playable area, and the wall-snap may pick a slightly different face
than if the arch had been left at its original position. Both effects are harmless
— the arch still lands on a wall face and navigation works — but a future cleanup
can make object-bounds repair skip exit-carrying objects to eliminate the
over-report.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Trust boundary unchanged: generated output is data only, layout normalization stays domain-pure before the renderer |
| [ADR-0010](./ADR-0010-generation-foundation-v0.md) | `assembleRoom` is the same pipeline; this ADR adds stages 2.5–2.8 before the existing stages 3–4 |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | `repairRoom` (stage 4) and `fallbackRoom` are unchanged; provenance semantics are clarified |
| [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) | The real provider that motivated this contract |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | New boolean diagnostics are log-safe by construction |

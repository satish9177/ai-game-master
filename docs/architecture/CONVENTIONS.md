# Conventions

> The single source of truth for spatial conventions and RoomSpec authoring
> rules. File headers in the codebase repeat these in brief; when they disagree,
> **this document wins** and the code comment should be corrected.

## Coordinate system

| Aspect | Convention |
| --- | --- |
| **Up axis** | **Y-up.** +Y is up, gravity points −Y. |
| **Units** | **Meters**, everywhere. A 1.0 value is one meter. |
| **North** | **−Z is north.** So +Z is south. |
| **East / West** | **+X is east, −X is west.** |
| **Origin** | Room is centered on the origin: x ∈ [−width/2, +width/2], z ∈ [−depth/2, +depth/2]. |
| **Floor plane** | The floor's **top surface is at y = 0.** Objects rest on y = 0. |

```
            -Z  (north)
             ▲
             │
   -X ◄──────┼──────► +X
  (west)     │      (east)
             │
             ▼
            +Z  (south)   ← player spawns here in the demo room
```

## Orientation (rotationY / yaw)

- **`rotationY` and `yaw` are in DEGREES** in RoomSpec data. (They are converted
  to radians inside the engine; authors and specs always use degrees.)
- Forward direction for a given yaw is **`(sin yaw, cos yaw)`** on the XZ plane.
- Right (strafe) direction is **`(−cos yaw, sin yaw)`**.

Consequences:

| yaw | Faces | Notes |
| --- | --- | --- |
| `0` | **south** (+Z) | default rotation |
| `90` | east (+X) | |
| `180` | **north** (−Z) | the demo player spawns at `yaw: 180`, looking at the throne |
| `270` | west (−X) | |

## Object anchoring (where `position` means)

`position` is `[x, y, z]` in meters. What the `y` (and the object's vertical
origin) refers to depends on how the object is placed:

- **Ground-placed objects** (throne, pillar, rug, arch, npc, prop): `position`
  is the **base on the floor**, not the center. Authors typically give `y = 0`
  and the builder lifts the geometry so it rests on the floor. This makes specs
  forgiving — you place a pillar at `y = 0` and it stands on the ground.
- **Wall / ceiling-mounted props** (e.g. `torch`): `position` is the **mount
  point** (e.g. `y = 3` on a pillar/wall). The builder brackets the prop out
  from that mount.

When adding a new object type, **state its anchoring rule in the builder's doc
comment** and keep it consistent with one of these two patterns.

## Colors

- Colors are **`#rrggbb` hex strings** (validated by zod: `^#[0-9a-fA-F]{6}$`).
- Builders may use additional hardcoded accent colors internally; only the
  author-facing color fields are part of the spec.

## RoomSpec authoring rules

RoomSpec is **data only** — see
[ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md). When
authoring (by hand today, or via an LLM later):

1. **No code, ever.** No functions, no expressions, no `eval`-able strings, no
   references to JS/Three/React. Numbers, strings, booleans, enums, arrays,
   objects only.
2. **`schemaVersion` is required** and currently must be `1`. Every stored or
   generated spec carries its version so it can be migrated later.
3. **Stable `id` / `name`.** The room has an `id` and `name`; objects may carry
   an optional `id`. Prefer stable, meaningful ids.
4. **Use known object `type`s.** The renderer maps `type` to a builder via a
   fixed registry: `throne`, `pillar`, `rug`, `torch`, `arch`, `scroll`, `npc`,
   `prop`. Unknown types are not an error — they render as a visible magenta
   placeholder (see [FAILURE-MODES](./FAILURE-MODES.md)) — but they do nothing
   useful, so prefer known types or add a new builder + schema variant.
5. **Rely on defaults.** Most fields (colors, sizes, light intensity, wall
   thickness) have sensible schema defaults; omit what you don't need. A minimal
   object is just `{ "type": "...", "position": [x, y, z] }`.
6. **Coordinates follow the rules above** — meters, −Z north, degrees, base-on-
   floor anchoring.
7. **`exits`** are declared on the shell with a `side` (`north`/`south`/`east`/
   `west`) and a `width`; the matching wall is split to leave a walkable gap.
   Place an `arch` at the exit if you want it framed.
8. **`interaction`** (on `scroll`, `npc`) carries a `key` (`E` or `F`), a
   `prompt` shown in the HUD, and optional `title`/`body` for the dialogue
   panel. v0 dialogue is static text — no branching.
9. **One bad object can't break a room.** The loader validates each object
   independently and skips invalid ones. But don't rely on that as a feature:
   author valid objects.

## Quick reference

```
Y-up · meters · -Z north · +X east · degrees for yaw
forward = (sin yaw, cos yaw)      yaw 0 → +Z (south)   yaw 180 → -Z (north)
floor top at y=0                  ground objects: position = base on floor
colors = #rrggbb                  schemaVersion = 1     data only, never code
```

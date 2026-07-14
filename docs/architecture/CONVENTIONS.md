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

- **Ground-placed objects** (legacy props, humanoids, and semantic architecture/furniture/
  clutter/vegetation/light fixtures unless documented as mounted): `position` is the **base on
  the floor**, not the center. Authors normally use `y = 0`; trusted assets are normalized with
  their base at local y=0.
- **Wall / ceiling-mounted props** (e.g. `torch`): `position` is the **mount
  point** (e.g. `y = 3` on a pillar/wall). The builder brackets the prop out
  from that mount.

When adding a new object type, **state its anchoring rule in the builder's doc
comment** and keep it consistent with one of these two patterns.

## Camera & movement (renderer-internal presentation)

The camera and player character are **renderer-internal presentation**, not RoomSpec data —
a spec never describes the camera, player mesh, rig parts, or clips. V1 retains the controlled
3D/isometric presentation; full first-person/free-camera 3D remains future/optional
([ADR-0012](./decisions/ADR-0012-isometric-camera-foundation.md), [ADR-0091](./decisions/ADR-0091-ruined-kingdom-survival-visual-pack.md)).

- **Isometric camera.** An `OrthographicCamera` at the fixed true-isometric angle:
  azimuth **45°**, elevation **`atan(1/√2) ≈ 35.264°`**. It **follows the player**
  from a constant offset; it never rotates with input. Sitting toward +X/+Z, the
  camera looks toward −X/−Z (the north-west).
- **The player drives; the camera follows.** The engine owns a shared-rig player character
  on the floor; movement and interaction proximity act on its logical root, and the camera
  follows that root each frame. `spawn.yaw` orients the character; velocity turns only its
  visual-facing child so gameplay coordinates remain unchanged.
- **Screen-relative movement** (relative to the fixed camera, not world axes):
  **W / ↑ = up-screen (into the scene)**, **S / ↓ = toward the camera**,
  **A / ← = screen-left**, **D / → = screen-right**; diagonals are normalized and
  movement stays clamped to the room AABB. (At the 45° azimuth, screen diagonals
  collapse onto the world axes — W+D walks straight north.)
- **Isometric cutaway shell.** The camera-facing **south (+Z) and east (+X)** near
  walls render as a low **curb** so they can't hide the player; the **north (−Z)
  and west (−X)** far walls stay full height to preserve room shape. This is a
  renderer choice derived from the camera angle — `exits`, dimensions, and the rest
  of the RoomSpec are unchanged.

## Colors

- Colors are **`#rrggbb` hex strings** (validated by zod: `^#[0-9a-fA-F]{6}$`).
- Builders may use additional hardcoded accent colors internally; only the
  author-facing color fields are part of the spec.

## Closed visual semantics

- `environmentKind` is optional and closed: village, tavern, palace, ruins, forest-edge, crypt, or dungeon.
- Static `condition` is closed: intact, weathered, damaged, burned, or overgrown. Dynamic open/locked/looted/read/activated state is derived from existing authoritative interactions, flags, and gate results; authors do not write renderer state.
- NPC/zombie appearance may select only closed humanoid preset, presentation, palette, accessory, and infection enums. Exact body/head/hair/outfit/armour nodes remain renderer-owned.
- Asset paths, URLs, pack ids, model/material/node/clip/shader names, executable code, and free-form renderer instructions are never valid RoomSpec fields.
- Non-humanoid body plans are not humanoid presets. They require separate future rig contracts.

## RoomSpec authoring rules

RoomSpec is **data only** — see
[ADR-0001](./decisions/ADR-0001-data-only-room-spec-trusted-renderer.md). When
authoring (by hand, via the deterministic fake generator of Generation
Foundation v0 today, or via an LLM later):

1. **No code, ever.** No functions, no expressions, no `eval`-able strings, no
   references to JS/Three/React. Numbers, strings, booleans, enums, arrays,
   objects only.
2. **`schemaVersion` is required** and currently must be `1`. Every stored or
   generated spec carries its version so it can be migrated later.
3. **Stable `id` / `name`.** The room has an `id` and `name`; objects may carry
   an optional `id`. Prefer stable, meaningful ids.
4. **Use known semantic object types.** The closed schema includes the legacy types
   `throne`, `pillar`, `rug`, `torch`, `arch`, `scroll`, `book`, `paper`, `map`,
   `chest`, `corpse`, `table`, `altar`, `statue`, `machine`, `artifact`, `candle`,
   `npc`, `prop`, `crate`, `barrel`, `debris`, `barricade`, and `zombie`, plus the
   reusable `architecture`, `furniture`, `clutter`, `vegetation`, and `light-fixture`
   families. Each family uses a closed `kind` enum. Unknown/malformed objects are skipped
   at validation; supported production content resolves through registry fallbacks, never a debug primitive.
5. **Rely on defaults.** Most colors, sizes, light values, transforms, and conditions
   have safe schema defaults. Semantic family objects additionally require their closed `kind`;
   they never accept model, material, node, clip, shader, or file-path selectors.
6. **Coordinates follow the rules above** — meters, −Z north, degrees, base-on-
   floor anchoring.
7. **`exits`** are declared on the shell with a `side` (`north`/`south`/`east`/
   `west`) and a `width`; the matching wall is split to leave a walkable gap.
   Place an `arch` at the exit if you want it framed.
8. **`interaction` stays purpose-driven data.** Supported objects may carry the existing
   closed interaction descriptor (`exit`, `encounter`, `dialogue`, or effect). An affordance must
   have gameplay purpose and its result is projected into a visible state such as open, looted, read, or activated.
9. **One bad object can't break a room.** The loader validates each object
   independently and skips invalid ones. But don't rely on that as a feature:
   author valid objects.

## Quick reference

```
Y-up · meters · -Z north · +X east · degrees for yaw
forward = (sin yaw, cos yaw)      yaw 0 → +Z (south)   yaw 180 → -Z (north)
floor top at y=0                  ground objects: position = base on floor
colors = #rrggbb                  schemaVersion = 1     data only, never code
camera/player = renderer-internal isometric presentation; semantic visuals use closed ids only
movement = screen-relative        W/↑ into scene · S/↓ toward camera · A/D strafe
```

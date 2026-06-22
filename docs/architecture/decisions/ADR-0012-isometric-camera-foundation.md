# ADR-0012: Isometric Camera Foundation — controlled 3D / isometric presentation

- **Status:** Accepted — **implemented** (Isometric Camera Foundation)
- **Date:** 2026-06-22
- **Deciders:** Project owner

## Context

[Renderer Foundation v0](./ADR-0002-react-three-boundary.md) shipped with a
**first-person** camera: the `PerspectiveCamera` *was* the player. Movement moved
the camera directly, drag-look (`LookControls`) rotated it, and proximity for
interactions read the camera's position. That proved the renderer trust boundary,
but first-person is not the product's intended feel.

The product direction is a **browser-based controlled 3D / isometric solo RPG
scene** — a walkable isometric 3D story scene the player reads from a fixed,
slightly-overhead angle, like a diorama. Crucially this is a **presentation**
change, not an engine change:

- We still use **Three.js** (vanilla 0.184) and still render **real 3D** objects
  and rooms — this is "2.5D-style" in *framing*, not flat sprites.
- **RoomSpec JSON** remains the generated data format, **unchanged**.
- **LLM/generation still emits data only, never code** ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- The **trusted renderer** still owns the camera, movement, builders, and all
  visual construction.
- "2.5D" = camera/presentation, **not** a new engine, not Unity/Godot, not a
  rewrite ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

So the camera is **renderer-internal presentation**, not room data: a RoomSpec
describes *what is in the room*, never *how it is filmed*.

## Decision

Ship the **Isometric Camera Foundation**: make the engine's default view a fixed
**orthographic true-isometric** camera that follows a **player object** decoupled
from the camera. Camera mode lives entirely inside the renderer engine.

```
input → player (a floor object the engine owns)
            │
            ├─ MovementControls   screen-relative WASD/arrows → player.position (XZ)
            ├─ proximity/interact  read player.position
            │
            ▼
        CameraController (IsometricCameraController)
            └─ derives camera transform FROM player.position each frame
                 (fixed azimuth 45°, elevation atan(1/√2), orthographic)
            ▼
        OrthographicCamera  →  trusted Three.js render (unchanged builders)
```

### What it is

- **Player ↔ camera decoupling (the key change).** The engine now owns a
  `player` (`THREE.Object3D`) that input drives; the camera is a separate
  `CameraController` that derives its transform **from** the player each frame.
  Input never moves the camera directly. On room load the player is initialized
  at the spawn point on the floor and oriented by `spawn.yaw`; the camera snaps to
  frame it.
- **A `CameraController` seam.** A small interface — `camera`, `follow(target)`,
  `resize(aspect)`, `dispose()` — behind which the engine renders. The Engine
  never sets the projection or pose itself, so a future free-camera/first-person
  controller is a local swap, not an engine rewrite.
- **`IsometricCameraController`.** Owns an `OrthographicCamera` at the fixed
  **true-isometric** angle (azimuth 45°, elevation `atan(1/√2) ≈ 35.264°`). It
  applies pure camera math and keeps world units un-stretched on any viewport.
- **Pure, tested camera math.** A dependency-free `renderer/engine/camera/isometric.ts`
  module (plain `{x,y,z}` records, no Three.js) holds the offset direction,
  follow pose, screen-relative movement, AABB clamp, and orthographic frustum —
  unit-tested without a WebGL context, mirroring the pure-function style of
  `validateRoom`. The controller and movement are thin adapters over it.
- **Screen-relative movement.** `MovementControls` moves the **player** on the
  ground plane relative to the fixed camera azimuth: **W/↑ up-screen (into the
  scene), S/↓ toward the camera, A/← and D/→ strafe**; diagonals normalized;
  delta-time scaled; clamped to the room AABB (the same `clampToBounds` the pure
  module exposes). The player's height (Y) is never changed by movement.
- **Proximity reads the player.** Interaction proximity and the E/F open-key now
  read `player.position` instead of the camera's, so prompts and dialogue are
  unchanged in behavior but anchored to where the player actually stands.
- **A minimal player marker.** A small capsule body + facing nose built by a
  renderer-internal `buildPlayerMarker()` helper, resting on the floor and facing
  `+Z` at yaw 0 (the NPC facing convention). It is **renderer-internal, not
  RoomSpec data** — no schema field describes it. It is part of the scene graph,
  so the engine's existing `disposeObject(scene)` teardown frees it.
- **Isometric cutaway shell.** `buildShell` takes an optional `cutawaySides`: the
  walls between the camera and the interior (the **south and east** near walls at
  this azimuth) render as a low **curb** (0.4 m) instead of full height, so a tall
  wall never hides the player or an NPC standing against it. The **far/back walls
  (north, west) stay full height** to preserve room shape — a dollhouse/cutaway,
  not a closed box. The Engine derives the near sides from the camera's own offset
  direction, so it stays correct if the angle changes. RoomSpec is untouched.
- **`LookControls` is retained but not instantiated.** The drag-look class stays
  in the tree for a future free-camera mode; it is simply not wired in isometric
  mode.

### What it is **not** (deliberately deferred)

- **No zoom** — the orthographic view size is fixed in v1.
- **No camera-mode toggle UI** and **no free-camera / first-person mode** — the
  isometric controller is the only one wired; `LookControls` stays available for
  when a free-camera controller is added behind the same `CameraController` seam.
- **No mobile/touch controls, no minimap, no pathfinding.**
- **No combat, inventory, or asset packs.**
- **No RoomSpec/schema change, no camera data in generated rooms** — camera is
  presentation, authored/derived by the renderer, never by the model.

### Invariants this preserves

- **Still Three.js, still real 3D.** The renderer, builders, lighting, and
  disposal are unchanged; only the camera and what drives movement changed. This
  is a framing change, not an engine change ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).
- **RoomSpec is unchanged and renderer-agnostic.** No camera/player fields were
  added to the schema. The domain holds **no** camera or engine objects; the
  player marker and camera controllers are Three.js handles that live only inside
  the renderer adapter ([BOUNDARIES](../BOUNDARIES.md)).
- **The trust boundary holds.** Generation still emits **data only**; the renderer
  still executes only trusted, hand-written builders ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- **The React ↔ engine seam is unchanged.** The same imperative methods and
  callbacks drive the HUD and dialogue; the camera change is invisible to the UI
  ([ADR-0002](./ADR-0002-react-three-boundary.md)).

## Consequences

- The default visual direction for **v1 is controlled 3D / isometric**; the old
  first-person camera is no longer the default. Full first-person / free-camera 3D
  remains a **future, optional** mode behind the `CameraController` seam (the
  `LookControls` class is kept for it).
- A new failure surface — camera/player presentation — is documented in
  [FAILURE-MODES](../FAILURE-MODES.md): orthographic frustum must update on
  resize; player and camera must initialize safely before and after room load;
  proximity must use player position; the player marker must dispose with the
  scene; cutaway walls must prevent occlusion without destroying readability.
- The camera seam makes a second view mode cheap to add later without touching the
  Engine's render loop, builders, or the domain.

## Alternatives considered

- **Angled perspective camera instead of orthographic** — rejected for v1: a true
  orthographic isometric gives a stable, un-distorted diorama read where equal
  world lengths read equally on screen; perspective reintroduces depth distortion
  the fixed framing is meant to avoid. (A perspective free-cam can still arrive
  later behind the seam.)
- **Keep the first-person camera** — rejected: it does not match the intended
  controlled-3D RPG feel, and tall walls make a fixed overhead read unusable
  without cutaways anyway.
- **Make near walls fully transparent or remove them entirely** — rejected in
  favor of low curbs: transparency sorting on four thin walls is fiddly and can
  flicker, and removing walls loses the footprint. A 0.4 m curb never occludes the
  player at this camera angle yet still bounds the room.
- **Put camera mode / angle in RoomSpec** — rejected: the camera is presentation,
  not room data. Encoding it in the spec would couple the data contract to one
  renderer's framing and invite the model to "direct the camera," violating the
  renderer-agnostic, data-only rules ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0008](./ADR-0008-renderer-portability-strategy.md)).
- **A THREE.Vector3-based camera math module** — rejected: plain `{x,y,z}` records
  keep the math dependency-free and unit-testable with no WebGL context; the
  controller converts to Three.js at the call site.

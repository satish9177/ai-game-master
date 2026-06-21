# AI Game Master — Renderer Foundation v0

The first slice of the AI Game Master project. It proves that a **hardcoded
RoomSpec JSON** can be turned into a **walkable, low-poly 3D room** rendered
entirely by **trusted Three.js code** — with no AI, no backend, and no
arbitrary code execution anywhere in the pipeline.

The demo room is a throne room: floor and walls with a north exit, a throne,
pillars, a rug, an arch, wall torches (real point lights), an NPC (Malik), and a
readable scroll. You can walk around, look with the mouse, and interact with the
NPC and the scroll.

## Goal of v0

Establish the **data → trusted renderer** boundary and the lifecycle discipline
that everything later depends on:

- A room is described by **data only** (`RoomSpec`). It is never executed.
- The browser only ever runs **trusted, hand-written renderer code**.
- Unknown / malformed objects must **degrade gracefully**, never crash.
- The engine must **fully tear down** (canvas, WebGL context, listeners, GPU
  memory) on unmount, so repeated mounts leak nothing.

This is deliberately the *plumbing* slice. AI-driven room generation is a later
concern; v0 only proves the renderer can be trusted with whatever data it's
handed.

## How to run

The app lives in `apps/web/`.

```bash
cd apps/web
npm install
npm run dev      # start the Vite dev server (prints a localhost URL)
npm run build    # type-check (tsc -b) + production build
```

Open the printed URL (e.g. http://localhost:5173) and you'll spawn near the
south wall facing the throne.

> Stack: React 19 + TypeScript + Vite, vanilla Three.js (not react-three-fiber),
> zod for RoomSpec validation.

## Controls

| Input | Action |
| --- | --- |
| **W / A / S / D** | Move on the floor plane (delta-time scaled) |
| **Mouse drag** | Look around (drag-look — **no** pointer lock) |
| **E** | Interact when the prompt shows "Press E …" (the scroll) |
| **F** | Interact when the prompt shows "Press F …" (Malik) |
| **Esc** / Close button / backdrop | Close the dialogue panel |

While a dialogue panel is open, movement and drag-look are disabled and the
E/F keys won't re-open a panel.

## RoomSpec conventions

All rooms use one coordinate convention:

- **Y-up**, all units in **meters**.
- **−Z is north** (so +Z is south, where the player spawns).
- **rotationY / yaw are in degrees.** Forward = `(sin yaw, cos yaw)`, so
  `yaw = 180` faces north (−Z).
- Ground-placed objects treat their `position` as the **base on the floor**
  (`y = 0`), not their center. Wall/ceiling-mounted props (e.g. torches) use
  `position` as the mount point.

## Data-only RoomSpec / trusted-renderer boundary

`RoomSpec` is **pure data** (see `apps/web/src/roomspec/`). It is validated with
zod and mapped to trusted builders by its `type` string. Nothing in a RoomSpec
is ever evaluated as code — no functions, no scripts, no raw JS.

Loading is intentionally split:

- **`loadRoomSpec(raw)`** validates the room *envelope* strictly (dimensions,
  spawn, lighting). A broken envelope is a hard error.
- Each entry in `objects` is validated **leniently**, one at a time. A valid
  object is kept; an unknown or malformed one is recorded in `skipped` /
  `warnings` instead of rejecting the whole room.

So one bad object can never take down the room, and the room can never run code.

## Object registry & fallback placeholder

The renderer maps each known object `type` to a trusted builder via a registry
(`apps/web/src/renderer/engine/builders/`):

`throne · pillar · rug · torch · arch · scroll · npc · prop`

Anything the registry doesn't cover renders as a **magenta placeholder box**
rather than crashing. Two distinct paths reach the placeholder:

1. Objects the loader **skipped** (unknown/malformed types).
2. Valid types that simply don't have a builder yet.

This makes unsupported content *visible* during development while preserving the
"never crash the renderer" guarantee.

## Lifecycle & disposal

The `Engine` (`apps/web/src/renderer/engine/Engine.ts`) is constructed once with
a container element and disposed exactly once. `dispose()` is total:

- cancels the animation frame and disconnects the `ResizeObserver`;
- removes the interaction (E/F) key listener, and tears down movement
  (keydown/keyup) and drag-look (pointer) listeners;
- disposes every geometry, material, and texture in the scene graph
  (one material per mesh, so each is freed exactly once), then
  `renderer.dispose()` + `forceContextLoss()` and removes the canvas.

The React `DialoguePanel` cleans up its own Escape listener on unmount. This
symmetry is what keeps the app stable under React StrictMode's dev double-mount
(mount → dispose → mount) with **exactly one canvas** and no leaked WebGL
context.

## Current limitations (by design for v0)

- **No LLM / AI** anywhere in the pipeline.
- **No backend, no database, no persistence/memory.**
- **No real collision** — movement is clamped to an axis-aligned room box only
  (no per-object collision).
- **No pointer lock** — drag-look only.
- **Single hardcoded room**; no multi-room or room transitions.
- **No dialogue tree / branching choices** — the interact panel shows static
  title/body text only.
- **No animations, textures, or imported (GLTF) models** — primitives only.

## Next planned slice

Introduce **AI-authored RoomSpecs**: an LLM proposes a room *as RoomSpec data*,
which flows through the exact same `loadRoomSpec` validation and trusted-builder
registry proven here. The model never emits renderer code — only data — so the
trust boundary established in v0 is what makes that step safe. Likely companions:
a small backend to host generation, and multi-room navigation through exits.

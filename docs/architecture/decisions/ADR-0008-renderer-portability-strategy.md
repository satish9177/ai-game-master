# ADR-0008: Renderer portability / engine strategy

- **Status:** Accepted — **direction; Three.js remains the v1 renderer**
- **Date:** 2026-06-21
- **Deciders:** Project owner

## Context

Three.js is the right renderer for a browser-first v1. But the long-term value of
this product is **not** the choice of renderer — it is the `RoomSpec`/`WorldSpec`
data contract, the validation and generation pipeline, the AI memory, and
persistence. We may one day want a richer web game engine, or a native desktop /
mobile client. We must not let renderer-specific assumptions leak into the parts
that would make such a move a rewrite.

The trust boundary ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md))
already says the LLM emits data, never code. This ADR extends that principle
across *every* renderer we might ever adopt.

## Decision

1. **Three.js remains the correct renderer for browser-first v1.** No change.
2. **`RoomSpec`/domain stay renderer-agnostic.** The data contract describes a
   room in neutral terms (positions, types, parameters), never in terms of one
   engine's API.
3. **Never store Three.js objects in the domain or the database.** No
   `THREE.Mesh`, `Material`, `Vector3`, scene-graph node, or other engine handle
   in domain types or persisted rows. Persist the validated **data** spec only
   (see [ADR-0004](./ADR-0004-persistence-sqlite-to-postgres.md)).
4. **Renderer adapters are a boundary.** A renderer is an adapter that *consumes*
   a validated spec and instantiates trusted engine objects:
   - **Three.js adapter** now.
   - **Babylon.js** possible later for richer web-game-engine features.
   - **Unity / Godot** possible much later for native/desktop/mobile/full-game
     clients.
5. **A non-web engine fits only by consuming the spec through trusted engine
   code.** If a Unity client exists, **trusted C#** loads `RoomSpec` JSON and
   instantiates prefabs. If a Godot client exists, **trusted GDScript/C#** loads
   `RoomSpec` JSON and instantiates nodes/resources. The renderer per platform is
   hand-written and reviewed, exactly like the Three.js builders today.
6. **The LLM must never generate any of:** Three.js code, Unity C#, Godot
   GDScript, or executable scene scripts. It emits `RoomSpec`/`WorldSpec` **data**
   only — same rule, every engine.

## Consequences

- Adding or swapping a renderer is "write a new trusted adapter against the
  existing data contract", not a redesign. The domain, generation, validation,
  memory, and persistence are reused unchanged.
- The trust boundary scales to native engines for free: prefabs/nodes are the
  per-engine equivalent of the Three.js builder registry; data selects them, code
  owns them.
- Keeping engine handles out of the domain/DB is a discipline cost today, paid
  back the first time a second renderer or a migration appears.
- We explicitly do **not** build a second renderer now — this ADR only keeps the
  seam in the right place ([AGENTS.md](../../../AGENTS.md) rule 13).

## Alternatives considered

- **Bake Three.js types into the domain / persist engine objects** — rejected:
  welds the product to one engine and makes any future client a rewrite.
- **Let the LLM emit engine code per platform** — rejected: violates the
  data-only trust boundary ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md))
  on every platform at once.
- **Commit now to a single "universal" engine (e.g. Unity) for all targets** —
  rejected: premature; browser-first v1 is best served by Three.js, and the data
  contract keeps the option open without paying for it now.

# ADR-0052: Generated Room Bidirectional Links v0 — deterministic return exit to the parent room

- **Status:** Accepted — implemented
- **Date:** 2026-06-29
- **Implemented:** 2026-06-29
- **Deciders:** Project owner
- **Extends:** [ADR-0041](./ADR-0041-generated-room-exit-navigation-v0.md) (generated room
  exit navigation — `ensureGeneratedExitNavigation`, structural `toRoomId`, the
  generated-play `AdjacentRoomPregenerator`/`NavigationService` seams). This ADR
  **supersedes ADR-0041's "No return or bidirectional exits" non-goal.**
- **Related:** [ADR-0021](./ADR-0021-adjacent-room-pregeneration-v0.md) (adjacent-room
  pregeneration — `AdjacentRoomPregenerator`, cache-first `resolveRoom`, provider-free
  `warmAdjacent`),
  [ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md) (multi-room navigation / cache —
  `NavigationService`, `SessionRoomCache`),
  [ADR-0051](./ADR-0051-generated-objective-per-room-v0.md) (per-room objectives restored
  from the memo on revisit — unchanged by this slice),
  [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) (data-only RoomSpec /
  trusted renderer boundary)

> Full pre-code design in the implementation plan
> [`generated-room-bidirectional-links-v0`](../implementation-plans/generated-room-bidirectional-links-v0.md).

---

## Context

ADR-0041 gave every generated room at least one usable **forward** exit, but explicitly
listed *"No return or bidirectional exits"* as a non-goal. Manual testing after
`generated-objective-per-room-v0` ([ADR-0051](./ADR-0051-generated-objective-per-room-v0.md))
confirmed the gap: when the player walks from room A into a generated adjacent room B,
B exposes only a forward exit. The visible cyan interactable marker usually points to the
*next* generated room, so there is no clear way to walk back to A. This makes it hard to
revisit earlier generated rooms and manually verify that per-room objective memos restore
on revisit.

The fix must preserve the data-only RoomSpec boundary, change no schema, touch no
renderer, make no provider calls, leave the objective pipeline alone, and reuse the
existing `NavigationService` / `AdjacentRoomPregenerator` seams without changing their
contracts.

**Key enabling fact.** A generated forward exit's `toRoomId` is **constructed
structurally** by `ensureGeneratedExitNavigation` as `` `${room.id}:exit:${side}` ``, and
`AdjacentRoomPregenerator.normalize` then assigns the child room's `id` to exactly that
navigation id. So a generated adjacent room's own id **already encodes its parent and the
entry side**: `B.id === ${A.id}:exit:${entrySide}`. The parent id and entry side are
recoverable by a deterministic structural parse — no name/prompt/JSON leakage, no LLM, no
new plumbing through the navigation contracts.

---

## Decision

### Core mechanism

Add a return exit to a generated adjacent room **before it is cached**, in
`AdjacentRoomPregenerator`, by delegating to a new **pure domain helper**
`ensureGeneratedReturnExit(room, parentRoomId, entrySide)`. The parent id and entry side
are derived by parsing the navigation room id.

```text
warmAdjacent(A)  ->  resolveRoom("R1:exit:north")        (B's navigation id; R1 = A.id)
  resolveGenerated("R1:exit:north"):
    assembleRoom -> LoadedRoom (raw generated id)
    normalize("R1:exit:north", room):
      base = withRoomId(room, "R1:exit:north")           (B.id assigned)
      validateRoom(base) ok
      parsed = parseGeneratedExitTargetId("R1:exit:north")  -> { parentId: "R1", side: "north" }
      enriched = ensureGeneratedReturnExit(base, "R1", "north").room
                   -> return arch on opposite(north)=south wall, interaction.exit.toRoomId="R1"
      validateRoom(enriched) ok -> use enriched          (degrade to base if it ever fails)
    cache.set("R1:exit:north", enriched)                 (return link baked in)
```

### Shared id format (drift guard)

Extract a single shared pair in the domain so the build and parse cannot drift:

- `buildGeneratedExitTargetId(roomId, side)` → `` `${roomId}:exit:${side}` ``.
  `ensureGeneratedExitNavigation` is refactored to use it (no behavior change).
- `parseGeneratedExitTargetId(id)` → `{ parentId, side } | null`. Matches a trailing
  `:exit:<north|south|east|west>`; `parentId` is the id without that suffix; returns
  `null` for non-suffixed/garbage ids. Nested ids resolve to the **immediate** parent
  (`R1:exit:north:exit:south` → `{ parentId: "R1:exit:north", side: "south" }`).

A unit test asserts `parse(build(roomId, side)) === { parentId: roomId, side }` for all
four sides and nested ids.

### The pure return-exit helper

`ensureGeneratedReturnExit(room, parentRoomId, entrySide)` is pure, total, and
non-mutating (returns a fresh room; never mutates the shared fallback room). It:

- is **idempotent**: if the room already has a usable exit whose `toRoomId === parentRoomId`,
  it returns the room unchanged (`returnExitEnsured: true`, already present);
- otherwise inserts one safe **return arch** using the existing RoomSpec exit/object
  shape (`type: 'arch'`, `interaction: { key: 'E', prompt, exit: { toRoomId: parentRoomId } }`);
- chooses the wall side `opposite(entrySide)` (north↔south, east↔west); if that side
  already carries an exit object, it picks the first free side from a fixed deterministic
  order (`south, west, east, north` minus occupied), so the return arch never collides
  with the forward arch;
- reuses `ensureGeneratedExitNavigation`'s `positionForSide` / `rotationForSide` geometry
  (exported for reuse) so the return arch wall-snaps identically and `repairGeneratedExits`
  semantics are unchanged;
- adds the matching `shell.exits` entry for the chosen side;
- gives the return arch a **stable, collision-safe** object id
  `` `${room.id}:return-exit:${side}` `` (numeric suffix on collision); the distinct
  `return-exit` namespace can never collide with the forward `generated-exit` namespace;
- uses fixed, hand-written interaction text (`Return to previous room`); no room name, no
  destination label, no generated/prose text.

### Where it runs and how it is gated

- The helper runs only inside `AdjacentRoomPregenerator` `normalize`/`resolveGenerated`,
  **before `cache.set`**, behind a new constructor option `ensureReturnExits` (default
  `false`).
- Only the **generated-play** pregenerator (constructed inside `handlePrompt`) enables
  `ensureReturnExits: true`. The authored/demo/global module-scope pregenerator leaves it
  `false`.
- A second, structural gate: a return exit is added only when
  `parseGeneratedExitTargetId(roomId)` yields a parent. This naturally exempts:
  - **Room #1** — cached directly in `handlePrompt`, never through `resolveGenerated`;
    its id has no `:exit:` suffix anyway.
  - **Authored/demo rooms** — resolved through `resolveAuthored` (registry), never
    enriched; ids like `throne-room` have no suffix.

### Provenance and validation

- Adding a return exit is a **benign navigation enrichment**, exactly like
  `ensureGeneratedExitNavigation`. It does **not** change provenance: a `generated` room
  stays `generated`, and the host shows no notice.
- **Repaired/fallback adjacents may receive a return exit if validation passes.**
  Returnability is a property of the parent *edge*, not of room content, so a
  repaired/fallback adjacent the player walked into should still let them walk back. The
  helper is applied regardless of provenance, then re-validated.
- **If the enriched room fails `validateRoom`, keep the original valid room with no return
  exit** (`returnExitEnsured: false`). The room still plays; only backtracking is absent.
  The pregenerator's existing global-fallback path (on base-room revalidation failure) is
  unchanged.

### Cache and warming behavior

- The return arch is baked **before** `cache.set`, so every cache hit returns the enriched
  room; the cache-first / single-in-flight contract is unchanged.
- **A → B → A is cache-hit based.** A was cached once (room #1 at prompt time, or as a
  parent on first traversal); the door's `resolveRoom(parentId)` is a cache hit and never
  regenerates A.
- `warmAdjacent` stays **provider-free** and depth-1. `warmAdjacent(B)` now lists the
  parent A among B's adjacents, but `warmAdjacent` skips ids already in the cache, so A is
  never re-warmed or regenerated.

### Diagnostics / logging

- The pregenerator's existing `room resolved` log gains one boolean,
  `returnExitEnsured`. `roomId` is the already-logged structural navigation id.
- Never logged: room/object names, prompts, generated JSON, provider bodies, interaction
  text, the parent id as content, or PII. Side/direction is a safe enum.

---

## Safety

- The helper is pure, total, non-mutating, and domain-only.
- No RoomSpec schema field is added or changed; the existing exit/object shape is reused.
- The renderer and `RoomViewer` stay intent-only and unchanged; the return arch is an
  ordinary arch with `interaction.exit`, already renderable and navigable.
- `NavigationService` / `RoomResolver` contracts are unchanged — the parent id comes from
  the structural id parse, not from new signature plumbing.
- Return target ids are structural, never inferred from prose; the build/parse share one
  format with a round-trip test.
- Authored/demo/global pregeneration is untouched (option off + structural gate).

---

## Non-goals

- No quests, objective, reward, inventory, combat, memory, backend/API, living-world, or
  world-state change. Per-room objective restore on revisit is the **existing**
  ADR-0051 memo behavior, unchanged here.
- No RoomSpec schema change.
- No `NavigationService` / `RoomResolver` contract change.
- No `WorldState` / `WorldEvent` / `WorldCommand` / reducer / persistence / save-load
  change; generated map links are **not persisted** in v0.
- No provider calls; adjacent warming remains provider-free.
- No renderer change, no door/exit animation.
- No destination-aware or named return labels.
- No minimap.
- No bidirectional links for authored/demo rooms.
- No guarantee for return paths that do not arise from a generated forward exit (a return
  exit is added only when the id structurally encodes a parent).

---

## Consequences

The player can walk A → B → A (and deeper, C → B → A), with each backtrack a cache hit
that never regenerates a prior room. Earlier generated rooms become revisitable, which in
turn makes per-room objective memo restoration manually verifiable. The change is a small,
pure, data-only enrichment in the composition layer plus one shared domain helper; every
schema, navigation-contract, world-state, renderer, provider, and objective boundary is
preserved.

Future slices can add named/destination-aware labels, save/load persistence of generated
map links, authored bidirectional links, richer map topology, door animation, or a
minimap without changing this v0 guarantee.

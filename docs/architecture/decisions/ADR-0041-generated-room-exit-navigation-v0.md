# ADR-0041 - Generated Room Exit Navigation v0

**Status:** Accepted / Implemented

## Context

Generated rooms could be valid and visible while still lacking a usable
navigable exit. The shell might declare an exit, or an arch might be present, but
the existing runtime navigation path requires a stable object id plus an
`interaction.exit.toRoomId` so `RoomViewer` can map the nearby interactable to
`NavigationService`.

The fix must preserve the data-only RoomSpec boundary, avoid renderer changes,
and reuse the existing `NavigationService` and `AdjacentRoomPregenerator`
composition seams.

## Decision

Generated-room assembly now runs a pure domain helper,
`ensureGeneratedExitNavigation(room)`, after spawn repair and before exit
wall-snapping:

```text
clampGeneratedShell
  -> repairGeneratedObjects
  -> composeGeneratedRoom
  -> repairGeneratedSpawn
  -> ensureGeneratedExitNavigation
  -> repairGeneratedExits
  -> assignGeneratedObjectPurpose
  -> ensureGeneratedNpcPresence
  -> validateRoom
```

If a generated room already has a stable usable exit, the helper returns the
same room reference and reports `exitNavigationEnsured: true`. Otherwise it
upgrades the first arch, or inserts a safe arch if none exists. The ensured arch:

- has a deterministic unique id;
- is placed directly on the matching wall face;
- has a matching `shell.exits` side;
- uses fixed safe interaction text (`Enter next room`);
- uses key `E`;
- points to a deterministic structural target id derived from `room.id` and the
  exit side.

`RoomDiagnostics` now includes the boolean-only
`exitNavigationEnsured`. Fallback branches report `false`; generated/repaired
branches report `true` when a usable generated exit is present.

Prompt-generated play now owns a generated-play-local `SessionRoomCache`,
`AdjacentRoomPregenerator`, and `NavigationService`. The initial generated room
warms its adjacent exits through that pregenerator, and post-navigation warming
uses the active play's pregenerator instead of the module-global example
pregenerator. Authored/example play continues to use the existing example cache
and resolver.

## Safety

- The helper is pure, total, non-mutating, and domain-only.
- No RoomSpec schema field is added or changed.
- The renderer and `RoomViewer` stay intent-only and unchanged.
- Diagnostics/logging add only a boolean. They do not include target ids, prompt
  text, raw JSON, provider output, generated names/descriptions, object names,
  interaction text, or matched terms.
- Exit target ids are structural, not inferred from prose.
- `repairGeneratedExits` remains a backstop; the helper chooses the wall side
  before that repair stage runs.
- Generated and example room caches remain separate, avoiding cross-session
  contamination.

## Non-goals

- No quests, objectives, rewards, inventory, combat, memory, backend/API, living
  world simulation, or persistence of a generated map.
- No RoomSpec schema changes.
- No prompt/world-bible theming of adjacent rooms.
- No real-LLM adjacent pregeneration.
- No return or bidirectional exits.
- No guarantee that every shell exit is usable.
- No destination-aware labels.
- No door animation.
- No minimap.
- No Enter-key support.

## Consequences

Generated rooms now have at least one visible usable exit for the existing HUD
and `E` interaction path. The first prompt-generated room and subsequent
generated adjacent rooms resolve through the same navigation and pregeneration
seams as authored rooms, while keeping generated-room cache state isolated from
the example play cache.

Future slices can add richer map topology, return exits, labels, animation, or
provider-backed adjacent generation without changing this v0 guarantee.

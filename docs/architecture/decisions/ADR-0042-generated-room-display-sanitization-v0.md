# ADR-0042 - Generated Room Display Sanitization v0

**Status:** Accepted / Implemented

## Context

Manual smoke after Generated Room Exit Navigation v0 found internal generated
structural ids leaking into player-facing text, for example:

- `Generated room - adjacent:gen-83d18466:exit:north`
- `The scroll reads: "adjacent:gen-83d18466:exit:north"`

Those ids are valid structural data for generated-room identity, navigation, and
cache resolution. They are not safe or useful display copy. The fix must remove
them from player-facing fields without weakening the data-only RoomSpec boundary,
without changing navigation ids, and without introducing UI-only masking that
leaves contaminated display data moving through the trusted assembly result.

## Decision

Generated-room assembly now sanitizes allowlisted display text at the
`assembleRoom` trust boundary. The sanitizer is pure, deterministic,
non-mutating, and generated-room-only because authored/static/restored rooms do
not pass through `assembleRoom`.

The late generated-room assembly order is:

```text
ensureGeneratedExitNavigation
  -> repairGeneratedExits
  -> assignGeneratedObjectPurpose
  -> ensureGeneratedNpcPresence
  -> sanitizeGeneratedDisplayText
  -> validateRoom
```

Only these player-facing fields are sanitized:

- `room.name`
- `object.name` for player-facing named generated object types (`npc` and
  `zombie`)
- `object.interaction.prompt`
- `object.interaction.title`
- `object.interaction.body`
- `object.interaction.dialogue.greeting`
- `object.interaction.dialogue.prompts[].label`

Structural fields are never sanitized or modified:

- `room.id`
- `object.id`
- `object.type`
- `object.interaction.exit.toRoomId`
- `object.interaction.key`
- `object.interaction.dialogue.persona`
- `object.interaction.dialogue.prompts[].id`
- positions, rotations, sizes, colors, enum values, cache ids, navigation ids,
  and other structural data

The match is targeted to generated structural ids such as:

- `gen-83d18466`
- `gen-83d18466:exit:north`
- `adjacent:gen-83d18466`
- `adjacent:gen-83d18466:exit:north`
- chained exit suffixes such as
  `adjacent:gen-83d18466:exit:north:exit:south`
- `generated-exit` suffix variants
- optional collision suffixes such as `:2`

If a contaminated `room.name` contains a structural token, the whole room name is
replaced with fixed safe text:

```text
Generated room
```

For all other allowlisted display fields, only the structural token is replaced
with neutral text:

```text
a nearby room
```

Surrounding text is preserved.

`RoomDiagnostics` now includes safe count-only diagnostics:

- `displayTextSanitized`
- `displayTextSanitizationCount`

`displayTextSanitizationCount` is the number of changed display string fields,
not the number of token occurrences. Fallback branches that return the authored
fallback room report `false` and `0`.

`GeneratedRoomSource` logs only those boolean/count diagnostics. It never logs
before/after text, matched structural ids, room names, object names,
interaction prompt/title/body text, dialogue greeting/labels, raw prompt text,
raw generated JSON, or provider output.

## Safety

- The sanitizer is pure, deterministic, non-mutating, and domain-only.
- No RoomSpec schema field is added or changed.
- No executable code from generation is introduced.
- No structural navigation/cache identity is changed.
- `interaction.exit.toRoomId` stays intact, so exits still resolve through the
  existing navigation and pregeneration seams.
- Authored fallback rooms are not sanitized by this feature; fallback branches
  return the pre-validated authored fallback and report false/zero diagnostics.
- Diagnostics and logs are safe booleans/counts only.
- No React, renderer, app service, DB, network, provider, backend/API, memory,
  quest, inventory, combat, or UI dependency is introduced.
- The renderer remains trusted hand-written Three.js over validated room data.

## Non-goals

- No adjacent-room theme continuity.
- No seed refactor or split between display seed and deterministic salt.
- No UI-only masking.
- No sanitizing encounter/effect text outside the current validated display
  surface.
- No broader anti-leak sanitizer.
- No persistence, backend/API, memory, living-world, or progression changes.
- No App, NavigationService, AdjacentRoomPregenerator, renderer, backend/API,
  memory, quest, inventory, combat, or theme-continuity changes.

## Consequences

Generated rooms no longer expose internal generated structural ids in the
current player-facing display surface. Navigation and cache ids continue to use
the same deterministic structural values, so exits still navigate and generated
adjacent rooms still resolve normally.

The feature deliberately solves a narrow leak class at the generated-room
assembly boundary. Future slices can address theme continuity, richer adjacent
seed design, additional validated display surfaces, or broader content-safety
filtering without changing this v0 guarantee.

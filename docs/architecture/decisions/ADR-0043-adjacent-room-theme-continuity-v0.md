# ADR-0043 - Adjacent Room Theme Continuity v0

**Status:** Implemented

## Context

Generated exit navigation works, and Generated Room Display Sanitization v0
prevents generated structural ids from leaking into player-facing text.

Adjacent generated rooms were still generic because the adjacent generator seed
was only structural:

```text
adjacent:${roomId}
```

Theme continuity should improve same-world flavor for prompt-generated play
without adding quests, memory, progression, or any new source of world truth.

## Decision

Prompt-generated adjacent rooms now compose their generation seed from a small
safe WorldBible projection plus the existing structural room id salt.

The adjacent theme seed uses only:

- `themePack`
- `tone`
- `generationHints.keywords`

The adjacent theme seed explicitly excludes:

- `title`
- raw prompt
- `premise`
- `majorConflict`
- `canonNotes`
- `openingArc`
- `npcs`
- `factions`
- `locations`
- `startingLocation`

Adjacent seeds are composed as:

```text
${themeSeed} | adjacent:${roomId}
```

when theme context exists, and as:

```text
adjacent:${roomId}
```

when theme context is missing.

The theme comes first so the deterministic fake generator sees safe flavor text
before structural salt. The structural salt remains last so different room ids
still produce deterministic per-room variety.

Cache and navigation identity remain the structural `roomId`. The generated
room path still lets `AdjacentRoomPregenerator` normalize the loaded room id to
the structural target id after validation.

`AdjacentRoomPregenerator`, `NavigationService`, `GeneratedRoomSource`,
`FakeRoomGenerator`, `RoomSpec`, the renderer, backend, and memory are
unchanged.

## Safety

- No RoomSpec schema change.
- No navigation/cache semantic change.
- No raw prompt is passed to adjacent generation on the WorldBible failure path.
- No prompt-shaped title is included in the adjacent theme seed.
- No new logging.
- Display sanitization remains a backstop against structural id leakage.
- Missing WorldBible degrades to existing structural seed behavior.
- Authored/example rooms are unchanged.

## Caveat

v0 still uses `FakeRoomGenerator` for adjacent rooms. The fake generator cannot
fully create literal hospital, spaceship, or other prompt-specific props and
layouts from theme. This slice improves display/flavor and deterministic seed
variety. The full payoff comes later when real-provider adjacent generation is
introduced.

## Non-goals

- Real-provider adjacent generation.
- Literal themed prop/layout generation in `FakeRoomGenerator`.
- Quests.
- Objectives.
- Rewards.
- Inventory.
- Combat.
- Memory.
- NPC memory.
- Living world.
- Backend/API.
- Persistence.
- RoomSpec schema change.
- Navigation/cache changes.
- Bidirectional/return exits.
- Theme as canon/world-state truth.
- Raw prompt propagation.

## Consequences

Prompt-generated adjacent rooms feel more connected to the same world while the
theme context stays bounded and safe. Adjacent rooms remain deterministic and
cacheable by structural id. Some generic fake-generator vocabulary remains until
future real adjacent generation.

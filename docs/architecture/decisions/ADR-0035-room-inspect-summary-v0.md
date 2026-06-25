# ADR-0035 - Room Inspect Summary v0

**Status:** Implemented

## Context

Generated Room Story Anchors v0 ([ADR-0034](./ADR-0034-generated-room-story-anchors-v0.md))
made generated rooms more often center on one clear focal object. But that work
was internal and foundation-only: story anchors shaped what was placed and where,
but the player still had no readable room context. The focal object was visible,
but there was nothing to orient the player at entry or explain what kind of space
they had entered.

This gap affected every entry path — authored bootstrap rooms, prompt-generated
rooms, navigated rooms, and restored rooms — because the domain had the data
needed for a brief observational summary but nothing surfaced it.

## Decision

Compute a deterministic observational summary from validated `LoadedRoom` data and
show it as a dismissible intro panel when a room becomes active.

**Summary is computed from validated room data only.** `buildRoomSummary(room:
LoadedRoom) → RoomSummary | null` is a pure domain function. It selects a focal
object and up to two supporting objects from the already-validated `room.objects`
array. Summary text uses:

- the room `name` field
- the focal object's `type` (mapped to a closed, hand-written noun table)
- the supporting objects' `type` values (same noun table)
- inferred cardinal direction (north / south / east / west / center) from each
  object's `position`

**No LLM-generated text.** The noun table, verbs, and direction phrases are all
hand-written and deterministic. The function calls no model, has no async path,
and performs no I/O.

**No schema fields for summary storage.** `RoomSummary` is a transient computation
result, not a stored or transmitted value. `schemaVersion` remains `1`.

**No object names or interaction bodies.** The function never reads `object.name`,
`interaction.title`, `interaction.body`, `interaction.prompt`, skipped objects, or
raw generated JSON. This prevents any generated or authored text from leaking into
the UI surface unreviewed.

**No use of raw generated JSON or skipped objects.** Only objects that passed
`loadRoomSpec` validation enter `room.objects` and can be used.

**Focal selection reuses the story-anchor selector.** `selectGeneratedStoryAnchorIndex`
from the composition module derives the focal index using the same priority table
(`throne` > `altar` > `statue` > `corpse` > `machine`/`artifact` > `chest` >
`table`/`map`/`book`/`paper`). If no story anchor candidate exists, the selector
falls back to any interactable (non-exit) or NPC. If nothing qualifies,
`buildRoomSummary` returns `null`.

**Dismissal is presentation-only and resets on room entry.** `RoomIntroPanel`
tracks dismissed state in component-local state via a `resetKey` derived from
`sessionId:roomId:entrySeq`. A new room entry changes the key; the panel
re-appears. Dismissal is never persisted to `localStorage`, `SaveGame`, `WorldState`,
or the backend.

**Summary missing is safe and non-fatal.** A `null` return from `buildRoomSummary`
renders no panel and never causes repair, fallback, a user notice, or logging.

**App wiring is path-agnostic.** `AppRoomIntro` is rendered for every active room
regardless of provenance: bootstrap/authored, prompt-generated, navigated, and
restore/load room paths all show the intro panel when a valid summary exists. The
fallback/repaired notice from `GeneratedRoomSource` remains independent.

## Non-goals

- No quest engine.
- No objective system.
- No living-world simulation.
- No memory.
- No inventory, loot, or combat.
- No NPC dialogue context wiring.
- No backend or API changes.
- No new RoomSpec schema fields or `schemaVersion` bump.
- No generated code.
- No raw JSON or debug UI.
- No object names, interaction titles, interaction bodies, or interaction prompts
  in summary text.
- No skipped or mystery-marker objects in summary selection.
- No gameplay semantics from the summary (it does not create objectives, flags, or
  world events).

## Consequences

**Good:**

- Players now see a brief readable orientation at every room entry, across all
  entry paths.
- The summary is deterministic: same room → same text, regardless of session or
  load path.
- The trust boundary holds: summary text comes from a closed hand-written noun
  table, not from model output or authored free text.
- Missing summary (decorative-only rooms, empty object lists) degrades to no panel
  and never blocks play.
- The fallback/repaired notice and the intro panel are independent and coexist
  without mutual suppression.
- No new gameplay, schema, backend, or memory obligation.

**Trade-offs and limitations:**

- Empty or decorative-only rooms (no anchor, no interactive, no NPC) produce no
  summary.
- Weak summary text is possible in v0 because templates are simple.
- The noun table is hand-written and finite; an unknown type gracefully falls back
  to a generic noun within the closed `NOUNS` record (every current `RoomObject['type']`
  is covered).
- Summary must not expose object names, interaction bodies, prompts, or raw
  generated JSON; this constraint is structural (the function never reads those
  fields), not guarded by a runtime filter.
- No quest or objective semantics follow from the summary; it is purely observational.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only RoomSpec; summary reads only validated `LoadedRoom`, never raw generated output |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | No new content-bearing log lines; summary text, room name, and object types are never logged |
| [ADR-0010](./ADR-0010-generation-foundation-v0.md) | Summary applies after `assembleRoom` and only to the validated room; generation pipeline unchanged |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Null summary never triggers repair, fallback, or user notice; fallback/repaired notice remains independent |
| [ADR-0027](./ADR-0027-session-save-load-v0.md) | Dismissal is component-local state only; save/load restores the room but not the dismissed flag (expected) |
| [ADR-0032](./ADR-0032-generated-room-composition-v0.md) | Focal selection reuses `selectGeneratedStoryAnchorIndex` from the composition module |
| [ADR-0034](./ADR-0034-generated-room-story-anchors-v0.md) | Delivers the visible story presentation that ADR-0034 explicitly deferred |

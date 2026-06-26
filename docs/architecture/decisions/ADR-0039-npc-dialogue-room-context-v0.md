# ADR-0039 - NPC Dialogue Room Context v0

**Status:** Accepted / Implemented

## Context

NPC Dialogue Foundation v0 made NPC conversations read-only and deterministic,
but NPC replies were room-blind. The dialogue service projected world/session
facts such as room id, player health, status ids, inventory item ids, and turn
history, while the provider had no compact way to know what validated room the
NPC was currently standing in.

`RoomViewer` already owns the active validated `LoadedRoom` after the normal
room-load boundary. That room contains enough structured data to make generic
NPC fallback lines feel grounded, but most room fields are unsafe to pass into
dialogue context: room names, object names, generated descriptions, interaction
prompts/titles/bodies, raw generated JSON, provider output, and user prompts may
contain authored or generated free text.

The feature needs room grounding without creating memory, state mutation,
relationship updates, quests, inventory, combat, or hidden-knowledge semantics.

## Decision

Add an optional, deterministic `RoomDialogueContext` packet and thread it through
the existing read-only NPC dialogue path.

The packet is built by a pure domain function:

```ts
buildRoomDialogueContext(room: LoadedRoom): RoomDialogueContext
```

It reads only the validated `LoadedRoom.objects` list, object `type`, object
`position`, and structured validated interaction existence/type as needed for
affordance derivation. It contains only:

- optional `focus`: `{ type, direction }`
- `features`: notable `{ type, direction }` entries, deduped and capped
- `affordances`: deduped closed affordance enum values
- `npcCount`: a small capped integer

`direction` is a closed enum (`north`, `south`, `east`, `west`, `center`).
Object type and affordance values are existing closed vocabularies.

`buildDialogueContext` accepts an optional room packet and attaches it as
`NPCDialogueContext.room` only when provided. `NPCDialogueService.reply` accepts
optional `roomContext` and passes it into that projection. `RoomViewer` builds
the packet after a successful room load and passes it to both NPC open/greeting
and subsequent canned-prompt/Continue reply calls.

The deterministic fake provider may use `context.room.focus.type` for a
room-grounded generic fallback line. Provider precedence remains:

1. prompt-specific line
2. persona line
3. room-grounded fallback line when `context.room.focus.type` has a fixed table entry
4. existing generic fallback

No real LLM provider is added or changed.

## Safety

- **Validated room data only.** The packet is derived from `LoadedRoom`, never
  raw `RoomSpec`, skipped raw objects, provider output, or generated JSON.
- **Closed enums and counts only.** The packet contains closed object type
  enums, closed direction enums, closed affordance enums, and capped `npcCount`.
- **No free text.** The packet does not include room names, object names,
  generated descriptions, interaction `prompt`/`title`/`body`, dialogue text,
  raw JSON, provider output, or user prompt text.
- **No logging/debug surface.** `NPCDialogueService` logs only existing ids,
  status/reason codes, room id, and turn count. It does not log room context,
  focus, features, affordances, npc count, object types, or generated text.
- **Read-only.** Dialogue remains UI/component-state only. The service still
  injects only `getWorldState`, appends no events, writes no memory, and mutates
  no authoritative world state.
- **No schema change.** `RoomSpec.schemaVersion` remains `1`; no stored
  `roomContext`, `storyRole`, `anchorKind`, or memory field is added.
- **Safe degradation.** Missing room context, missing focus, or unsupported focus
  type falls back to the previous dialogue behavior. It never causes room repair,
  fallback, load failure, provider failure, or user-facing error.

## Consequences

**Good:**

- Generic fake NPC fallback lines can now mention a safe focal room concept, so
  NPCs feel more aware of the current space.
- Authored/persona/prompt-specific dialogue remains byte-identical because it
  has higher precedence than the room-grounded fallback.
- The context is deterministic, compact, testable, and safe to pass toward a
  future real provider.
- Existing dialogue remains read-only and event-free.

**Trade-offs and limitations:**

- This is not long-term NPC memory. It is current-room supporting context only.
- NPCs do not learn hidden facts, navigate, update relationships, start quests,
  award loot, trigger combat, or mutate world state.
- The fake provider uses only the focus type, not feature lists or affordances.
  Those fields exist for compact future grounding but still carry no free text.
- The fallback lines are intentionally generic and hand-written.

## Non-goals

- No RoomSpec schema change.
- No backend, API, persistence, or memory change.
- No quest, relationship, inventory, loot, combat, encounter, event write, or
  world-state mutation.
- No LLM call, LLM review, or LLM repair.
- No raw prompt/provider/generated JSON/object name/generated description
  reading, passing, display, or logging.
- No debug UI or visible room-context panel.
- No NPC knowledge graph, summaries, vector recall, or long-term memory.

## ADR Relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only room contracts and trusted renderer boundaries |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds no content-bearing logs; room context details stay out of logs |
| [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) | Extends the read-only NPC dialogue context without adding event writes |
| [ADR-0024](./ADR-0024-npc-memory-persistence-v0.md) | Keeps this feature separate from persistent NPC memory |
| [ADR-0025](./ADR-0025-living-world-room-memory-v0.md) | Room dialogue context is not room memory or room truth |
| [ADR-0034](./ADR-0034-generated-room-story-anchors-v0.md) | Reuses the deterministic story-anchor selector for focus |
| [ADR-0035](./ADR-0035-room-inspect-summary-v0.md) | Mirrors validated-room-only, no-free-text leakage constraints |
| [ADR-0036](./ADR-0036-generated-room-interaction-affordances-v0.md) | Reuses closed affordance enum derivation for the packet |

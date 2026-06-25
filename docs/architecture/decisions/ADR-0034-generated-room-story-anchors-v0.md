# ADR-0034 - Generated Room Story Anchors v0

**Status:** Implemented

## Context

Generated Room Layout Contract v0 ([ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md))
made generated rooms spatially safe. Generated Room Composition v0
([ADR-0032](./ADR-0032-generated-room-composition-v0.md)) made them readable as
arranged spaces. Generated Room Visual Vocabulary v0
([ADR-0033](./ADR-0033-generated-room-visual-vocabulary-v0.md)) made more common
room concepts render as recognizable objects.

After those foundations, real-provider rooms could still feel purposeless. A room
might be safe, valid, composed, and visually readable, but still lack one clear
narrative focal idea: the thing the player should notice first to understand
what happened here.

This is not a reason to add a quest engine, a story-state system, or renderer
focus markers. For v0, the goal is only to make generated rooms more often center
on one existing object using data already available in `RoomSpec`.

## Decision

Add story-anchor guidance to the real room-generation prompt and broaden the
deterministic generated-room composition anchor selector.

Story anchors use existing `RoomSpec` data only:

- room `name`
- existing room objects
- optional existing `interaction.body` on the selected anchor

No schema fields are added. In particular, v0 adds no `roomIntent`, `storyRole`,
`anchorKind`, or stored anchor field. `schemaVersion` remains `1`.

## Prompt guidance

The real provider prompt now asks for:

- one dominant story anchor when appropriate
- a room name that reflects the anchor, event, or purpose instead of a generic
  label
- secondary objects that support the main anchor rather than compete with it
- optional short anchor `interaction.body` flavor text explaining what happened
  or why the object matters, when the anchor already has an interaction

The prompt also preserves the existing data-only JSON boundary and object type
allowlist rules. It does not require every anchor to be interactive, require
clues or rewards, create quest objectives, or create inventory, loot, combat, or
story-state semantics.

## Deterministic selector

The story anchor is derived, not stored. `composeGeneratedRoom` selects at most
one anchor from validated `RoomObject` values using type only. It does not inspect
object names, prompt text, `interaction.body`, raw generated JSON, provider
responses, or inferred purpose.

Priority:

1. `throne`
2. `altar`
3. `statue`
4. `corpse`
5. `machine` / `artifact`
6. `chest`
7. `table` / `map` / `book` / `paper`

Tie-breaks use the lowest object index within the highest-priority tier.

The selected anchor uses the existing north-center focal placement from generated
room composition. Extra candidate objects remain secondary support objects; they
do not become additional focal anchors.

## Missing anchors

Missing anchors are allowed and benign. If no candidate exists, the selector
returns no anchor, `lacksAnchor` remains true, and the room can still load with
`provenance: generated`.

Missing anchors do not cause:

- repair
- fallback
- a repaired/fallback user notice
- a new diagnostic
- a schema failure

The existing `lacksAnchor` boolean remains enough for v0.

## Foundation scope

This is foundation work. It improves prompt intent and deterministic focal
placement, but it does not guarantee that the player sees a strong story summary.
Visible narrative presentation is deferred to a later `room-inspect-summary-v0`
feature.

## Non-goals

- No quest engine.
- No living-world simulation.
- No memory.
- No inventory, loot, or combat.
- No NPC dialogue context wiring.
- No required clue, reward, or evidence object.
- No renderer or HUD focus marker.
- No backend or API changes.
- No generated code.
- No new RoomSpec schema fields.
- No `anchorKind` enum.
- No raw prompt, provider response, or generated JSON logging.

## Consequences

**Good:**

- Generated rooms more often have a single visual/narrative focal object.
- Non-throne and non-shrine rooms can now foreground evidence, devices,
  artifacts, caches, workspaces, or documents.
- The data-only RoomSpec and trusted renderer boundary is unchanged.
- Missing anchors remain safe and non-fatal.
- Authored, static, restored, and fallback rooms are untouched.

**Trade-offs and limitations:**

- Real providers can still omit a clear anchor or produce generic room names.
- The selector knows object type priority only; it intentionally does not infer
  from text fields.
- A focal anchor does not imply gameplay meaning. It creates no objective, loot,
  combat, inventory, memory, dialogue, or world-state behavior.
- Strong visible story explanation waits for `room-inspect-summary-v0`.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only RoomSpec and trusted renderer boundaries |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds no raw content logging and no new content-bearing diagnostic |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Missing anchors do not trigger repair, fallback, or user notice |
| [ADR-0023](./ADR-0023-real-room-generator-provider-v0.md) | Updates prompt guidance while provider output remains raw untrusted text |
| [ADR-0031](./ADR-0031-generated-room-layout-contract-v0.md) | Uses the existing safe generated-room layout envelope |
| [ADR-0032](./ADR-0032-generated-room-composition-v0.md) | Broadens the composition focal-anchor selector |
| [ADR-0033](./ADR-0033-generated-room-visual-vocabulary-v0.md) | Reuses the expanded safe object vocabulary for story anchors |

# ADR-0040 - Generated Room NPC Presence v0

**Status:** Accepted / Implemented

## Context

Generated rooms were not reliably creating real `npc` objects even when the user
prompt clearly asked for a survivor, guard, person, or other character to talk
to. The generated room could still be valid and playable, but the existing TALK
and NPC dialogue paths require an actual validated NPC object with the existing
interaction/dialogue shape.

NPC Dialogue Room Context v0 ([ADR-0039](./ADR-0039-npc-dialogue-room-context-v0.md))
also needs an NPC to exist before a player can manually exercise room-grounded
dialogue. Generated provider output remains untrusted and may omit, malformed, or
under-specify NPCs. The fix must not copy prompt text into generated room data or
weaken the RoomSpec/schema boundary.

## Decision

Classify the raw user prompt into a boolean `requestsNpc` signal before the
world-bible seed/projection can lose that intent.

Only that boolean crosses the prompt -> generated-room pipeline boundary:

```text
raw user prompt
  -> detectsNpcRequest(prompt): boolean
  -> GeneratedRoomSource options
  -> assembleRoom(..., { requestsNpc })
  -> ensureGeneratedNpcPresence(room, { requested: requestsNpc })
```

`assembleRoom` runs the trusted enrichment after generated-object purpose
assignment and before final validation:

```text
clampGeneratedShell
  -> repairGeneratedObjects
  -> composeGeneratedRoom
  -> repairGeneratedSpawn
  -> repairGeneratedExits
  -> assignGeneratedObjectPurpose
  -> ensureGeneratedNpcPresence
  -> validateRoom
```

When `requestsNpc` is true and the generated room has no NPC,
`ensureGeneratedNpcPresence` deterministically inserts at most one safe generic
NPC if a safe tile exists. If the room already contains an NPC, it preserves the
existing NPC and inserts nothing. If no safe tile exists, it inserts nothing and
the room continues through final validation normally.

The inserted NPC uses the existing working authored NPC interaction shape:

- `type: 'npc'`
- existing key `F`
- fixed authored name/color
- fixed `interaction.prompt` and `interaction.body`
- fixed `interaction.dialogue` with persona, greeting, and canned prompts

No new RoomSpec field or schema version is added.

## Safety

- **Boolean-only prompt boundary.** The raw prompt is reduced to `requestsNpc`.
  Matched keywords, prompt text, and classifier details are not passed into
  `GeneratedRoomSource`, `assembleRoom`, or the enrichment function.
- **No generated/free-text copying.** Inserted NPC strings come from a fixed
  authored table. They do not read room names, object names, generated
  descriptions, existing interaction prompt/title/body text, skipped raw objects,
  raw JSON, provider output, matched terms, or user prompt text.
- **Validated final room.** The inserted NPC is added before final
  `validateRoom`, so malformed insertion would be caught by the existing final
  validation path.
- **Safe diagnostics.** `RoomDiagnostics.npcInserted` is boolean-only and safe to
  log. It carries no names, prompts, ids, generated JSON, provider output, or
  object details.
- **No gameplay mutation.** The feature adds no backend/API/persistence/memory
  behavior, no world-state mutation, no event-log write, no quest, inventory,
  loot, combat, encounter, pathfinding, walking, simulation, or relationship
  update.
- **Adjacent pregeneration default false.** Background/generated adjacent rooms
  do not infer NPC requests from structural room ids such as `adjacent:...`.
  They receive the default `requestsNpc: false` unless a future deliberate raw
  prompt boolean is supplied.
- **Best effort placement.** No safe placement means no insertion. That is a
  normal generated-room outcome, not repair/fallback/unavailable.
- **Soft cap note.** The inserted NPC is added after the soft generated object cap
  and still before hard validation. This is intentional: an explicitly requested
  TALK NPC should not be dropped by soft composition trimming, while the final
  validator still enforces hard limits.

## Consequences

**Good:**

- Generated rooms can include a real interactable TALK NPC when the user clearly
  asks for one.
- The inserted NPC uses the same working shape as authored NPCs, so existing HUD
  affordance and NPC dialogue routing can consume it.
- Prompt-specific, persona, and room-grounded dialogue behavior remain separate;
  this feature only ensures an NPC object can exist.
- The pipeline remains deterministic, testable, and safe.

**Trade-offs and limitations:**

- Classifier false negatives are safe: no NPC is inserted, and the room still
  loads.
- Classifier false positives are safe: at most one harmless generic NPC may be
  inserted.
- The inserted NPC is generic by design. It does not know generated story prose or
  hidden facts.
- A future real provider can use the `generated-room-guide` persona; today's fake
  provider safely falls back if it has no persona-specific table entry.

## Non-goals

- No RoomSpec schema change.
- No backend, API, persistence, or memory change.
- No event writes, world-state mutation, quest, inventory, loot, combat,
  encounter, relationship, pathfinding, walking, or simulation behavior.
- No generated code.
- No LLM call, LLM review, or LLM repair.
- No raw prompt/provider/generated JSON/object name/generated description
  reading, passing, display, or logging.
- No RoomViewer or NPCDialogueService behavior change beyond existing generated
  room data now possibly containing a valid NPC.

## ADR Relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only RoomSpec and trusted renderer boundaries |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds only boolean diagnostics; no prompt or generated text enters logs |
| [ADR-0010](./ADR-0010-generation-foundation-v0.md) | Adds one deterministic generated-room assembly enrichment |
| [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) | Uses the existing validated NPC interaction/dialogue shape |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Failed NPC placement is non-fatal and does not trigger repair/fallback |
| [ADR-0021](./ADR-0021-adjacent-room-pregeneration-v0.md) | Adjacent pregeneration defaults the prompt-derived signal to false |
| [ADR-0037](./ADR-0037-generated-room-object-purpose-v0.md) | Runs immediately after generated object purpose enrichment |
| [ADR-0038](./ADR-0038-generated-room-explore-loop-v0.md) | Maintains fixed authored display-text discipline |
| [ADR-0039](./ADR-0039-npc-dialogue-room-context-v0.md) | Makes generated rooms more likely to have an NPC that can use room-grounded dialogue |

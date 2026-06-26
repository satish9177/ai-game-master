# ADR-0038 - Generated Room Explore Loop v0

**Status:** Implemented

## Context

Generated Room Object Purpose v0 ([ADR-0037](./ADR-0037-generated-room-object-purpose-v0.md))
made a small allowlist of bare generated objects eligible for the existing
interaction ring, HUD prompt, and E-key opening path by synthesizing safe
presentation-only interactions. That closed the first affordance gap: generated
books, chests, corpses, altars, machines, and similar validated objects could be
seen as interactable even when generated output omitted explicit `interaction`
data.

But the first slice synthesized only `{ key: 'E', prompt }`. Pressing E on those
objects still flowed into the existing `DialoguePanel`, where a missing `body`
could produce the generic fallback text and a missing `title` could let the panel
fall back to the interactable label. For object types that preserve `name`, that
label may be generated text. The result was a partial explore loop: ring -> HUD ->
E existed, but the panel text was not guaranteed to be the same safe,
deterministic presentation surface as the prompt.

This is still a presentation gap, not a gameplay gap. The fix should extend the
same generated-room-only enrichment stage rather than adding a resolver, an LLM
call, or any new stateful system.

## Decision

Extend `assignGeneratedObjectPurpose` so synthesized generated-room interactions
include safe deterministic `title` and `body` in addition to `key` and `prompt`.

The synthesized shape becomes:

```ts
{
  key: 'E',
  prompt: 'Read' | 'Inspect' | 'Examine',
  title: 'Read' | 'Inspect' | 'Examine',
  body: string,
}
```

`title` is always exactly the same safe verb as `prompt`. `body` is selected from
a fixed, hand-written table by validated `RoomObject.type`:

| Object type | Prompt/title | Body |
| --- | --- | --- |
| `book`, `paper`, `map` | `Read` | `You read over it carefully. Nothing changes yet.` |
| `chest`, `crate`, `barrel`, `table`, `machine` | `Inspect` | `You inspect it carefully, but do not take anything.` |
| `corpse` | `Inspect` | `You inspect the remains without disturbing them.` |
| `altar`, `statue`, `artifact` | `Examine` | `You examine it for meaning or danger. Nothing changes yet.` |

The stage still runs only inside generated `assembleRoom`, after generated-room
composition, spawn repair, and exit repair, and before final `validateRoom`:

```text
clampGeneratedShell
  -> repairGeneratedObjects
  -> composeGeneratedRoom
  -> repairGeneratedSpawn
  -> repairGeneratedExits
  -> assignGeneratedObjectPurpose
  -> validateRoom
```

The existing interaction-opening path is reused unchanged: `buildInteractables`
projects the validated interaction into the neutral `Interactable` view-model,
the renderer/HUD consume it for ring and prompt presentation, pressing E emits an
intent through the existing engine callback, and `RoomViewer` opens the existing
`DialoguePanel` with `target.title` and `target.body`. No new resolver is added.

## Safety

- **Deterministic, local, presentation-only.** The enrichment is pure and type
  based. It does no I/O and has no async path.
- **No LLM.** It does not call a model, provider, reviewer, repair prompt, or
  generation endpoint.
- **No generated text.** The synthesized `prompt`, `title`, and `body` come only
  from the fixed table above. They do not read object names, generated
  descriptions, existing generated prompt/title/body text, skipped raw objects,
provider output, raw generated JSON, or user prompt text.
- **No object-name leakage.** Synthesized interactions no longer rely on the
  panel-title fallback to the interactable label/name. The panel receives the
  safe verb as `title`.
- **No schema change.** `title` and `body` already exist on the shared
  `Interaction` schema. `RoomSpec.schemaVersion` remains `1`.
- **No gameplay effects.** The synthesized interaction has no `effect`,
  `encounter`, `dialogue`, `exit`, item, inventory, quest, combat, memory, or
  state mutation data.
- **No event writes or world-state mutation.** Presentation-only synthesized
  interactions may open a panel, but they do not append events and do not change
  `WorldState`.
- **No backend/API/memory/persistence change.** The feature is browser-local
  generated assembly plus existing renderer/UI presentation.
- **Existing interactions are preserved.** If a generated object already has an
  `interaction`, it is returned unchanged, including any existing `title`, `body`,
  `effect`, `encounter`, `dialogue`, or `exit` fields.
- **Unsupported and excluded objects stay unchanged.** Missing purpose remains
  best-effort and never causes repair, fallback, a generated-room notice, or room
  invalidation.

## Diagnostics

`purposesAssigned` remains the only diagnostic surface for this enrichment. It is
a count of newly synthesized purpose interactions and remains safe to log. Title,
body, object names, object ids, prompt text, provider text, raw JSON, generated
text, and free-form parse/schema details are never added to diagnostics or logs.

Fallback paths stay zero: JSON parse failure, schema failure, semantic fallback,
and generator-unavailable paths report `purposesAssigned: 0` and do not enrich the
trusted fallback room.

## Consequences

**Good:**

- Generated object exploration now has a complete deterministic loop: ring -> HUD
  -> E -> safe panel -> close -> continue exploring.
- The generic missing-effect/fallback-body path is no longer the normal experience
  for synthesized generated-object purpose interactions.
- The generated-object-name panel-title leak is closed for synthesized purpose
  interactions because the panel receives a safe title.
- Affordance classification, renderer rings, and HUD chips remain downstream
  consumers of validated interactions. They still do not invent interactions.
- Existing authored/default/restored/fallback rooms are unchanged because they do
  not enter generated `assembleRoom` purpose assignment.
- Existing generated interactions are not overwritten.

**Trade-offs and limitations:**

- The text is intentionally generic. It communicates safe inspection, not story,
  loot, puzzle, quest, or world-state consequences.
- `Inspect` remains coarse for containers and machines. A chest is not inferred as
  openable and receives no item or inventory behavior.
- This ADR supersedes ADR-0037's narrower statement that synthesized interactions
  are exactly `{ key, prompt }`. ADR-0037 still owns the allowlist, stage placement,
  and count-only diagnostic; ADR-0038 extends the synthesized interaction payload
  with safe display text.

## Non-goals

- No RoomSpec schema change.
- No backend, API, persistence, or memory change.
- No quest, inventory, loot, combat, encounter, dialogue, event write, or
  world-state mutation.
- No generated code.
- No LLM call, LLM review, or LLM repair.
- No raw prompt/provider/generated JSON/object name/generated description reading
  or logging.
- No renderer or HUD invention of interactions.
- No fallback or repair behavior tied to missing purpose text.

## ADR relationship

| ADR | Relationship |
| --- | --- |
| [ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md) | Preserves data-only RoomSpec; synthesized interaction text is inert validated data consumed by trusted UI code |
| [ADR-0003](./ADR-0003-logging-abstraction.md) | Adds no content-bearing diagnostics or logs; `purposesAssigned` remains count-only |
| [ADR-0014](./ADR-0014-object-interactions-v0.md) | Reuses presentation-only interaction opening with no effect/world-state command path |
| [ADR-0020](./ADR-0020-room-generation-repair-fallback-v0.md) | Missing/unsupported explore text never triggers repair, fallback, or user notices |
| [ADR-0035](./ADR-0035-room-inspect-summary-v0.md) | Mirrors the hand-written deterministic text discipline and no-object-name leakage rule |
| [ADR-0036](./ADR-0036-generated-room-interaction-affordances-v0.md) | Affordance/ring/HUD remain downstream consumers of validated interactions |
| [ADR-0037](./ADR-0037-generated-room-object-purpose-v0.md) | Extends the same generated-room object purpose enrichment from `{ key, prompt }` to `{ key, prompt, title, body }` |

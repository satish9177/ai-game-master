# ADR-0095: Validated Generated Meaningful-Object Consequence Attachment v0

- Status: Proposed for implementation review
- Date: 2026-07-15
- Extends: ADR-0094, Validated Meaningful Object Consequences v0

## Context

ADR-0092 provides the dry, generation-time-only object-purpose graph contract.
ADR-0093 provides deterministic stateful generated-object interactions. ADR-0094
provides the strict, per-room runtime consequence catalog, but deliberately has
only accepting seams: normal generated rooms do not populate it. Consequently,
generated documents, containers, and remains normally retain Slice B feedback.

This decision lets the existing optional post-room-validation objective-provider
call propose a small amount of data-only consequence information. Trusted code
derives all authoritative identities and validates the result before it can
reach the existing ADR-0094 runtime. The provider remains non-authoritative.

## Decision

This ADR authorizes the generation/assembly attachment path only. It does not
change the ADR-0094 runtime event, command, atomic commit, journal phrases,
facts, memory, dialogue, relationship, or persistence authority rules.

### Integration boundary

The existing optional generated-objective provider response gains an optional
`meaningfulConsequences` field. This uses the existing post-room-validation
provider request; it adds no primary `RoomSpec` field, no new provider call, no
object-purpose provider, retry, timeout, or independent usage path.

The primary room output cap remains 2,000 tokens. The optional combined call may
raise its output cap from 400 to no more than 700 tokens only after the budget
tests in the implementation plan pass. Its 12-second timeout, one-attempt
policy, and failure behavior remain unchanged.

### Raw provider envelope and independent branches

The raw response is JSON and first passes a strict root-key allowlist. The only
allowed keys are the existing objective fields plus `meaningfulConsequences`:

```ts
type GeneratedObjectiveProviderEnvelope = Readonly<{
  title: unknown
  description: unknown
  hint: unknown
  completionHint: unknown
  condition: unknown
  meaningfulConsequences?: unknown
}>
```

The envelope parser is strict: missing objective fields or unknown root keys
fail the complete response envelope. It validates only root keys and captures
values as `unknown`; it does not validate the objective or proposal payloads.

After the root succeeds, branches are parsed independently:

```ts
type GeneratedObjectiveBranch = Readonly<{
  title: string
  description: string
  hint: string
  completionHint: string
  condition: Readonly<{
    kind: 'interact-object'
    objectId: string
  }>
}>

type GeneratedMeaningfulConsequenceProposal = Readonly<{
  objectId: string
  action: 'read' | 'search'
  discoveryText?: string
  progressCurrentObjective?: true
}>
```

`GeneratedObjectiveBranch` uses the existing strict objective schema. Each
proposal uses strict parsing, with no unknown keys, a trimmed non-empty object
id, a closed action enum, an optional trimmed `discoveryText` of at most 160
characters, and an optional literal `true` progress request. The raw proposal
array has a parser-abuse ceiling of 32 entries.

A bad objective branch does not prevent valid clue-only proposals. A malformed
proposal member does not prevent a valid objective or other proposals. An
unknown root key, malformed root JSON, or more than 32 raw proposal entries
omits all new data and preserves existing behavior.

The provider must never supply clue, quest, objective, stage, room, event,
command, flags, effects, fact IDs, journal entries, or memory operations.

### Eligibility and canonical identities

Only generated-play objects with one stable, unique room object ID are eligible:

| Object type | Only permitted proposal action |
| --- | --- |
| `book`, `scroll`, `paper`, `map` | `read` |
| `chest`, `crate`, `barrel`, `corpse` | `search` |

Decorative, authored/demo, missing-id, duplicate-id, exit, encounter, dialogue,
unsupported, and stale objects are excluded. `inspect` and `open` attachments
are excluded.

Trusted code derives every clue ID through one helper:

```ts
generated-clue:${encodeURIComponent(roomId)}:${encodeURIComponent(objectId)}:${action}
```

The room ID is mandatory because generated object IDs may repeat between rooms.
The provider never supplies or alters this ID. Each accepted proposal constructs
the corresponding `ClueSpec` and ADR-0094 attachment; the existing strict
catalog validator remains the final acceptance boundary.

### Objective selection

`progressCurrentObjective: true` is only a request. Trusted code retains its
objective arm only when exactly one generated-play current-room objective is
linked to that proposal's object:

- the current quest is generated play, not authored/demo;
- its anchor room equals the proposal room;
- exactly one objective condition resolves to the proposal source object; and
- the relation is unambiguous and local to that room.

The implementation resolves that relation from the assembled, validated quest,
not provider ordering. It derives the objective ID and literal stage `1`; the
ADR-0094 runtime still derives the quest ID. If several proposals request
progression, only the unique proposal matching the trusted relation retains its
objective arm. Every unrelated or ambiguous request loses that arm. Valid clue
arms remain.

### Bounds, duplicates, and deterministic repair

The binding limits are:

- at most 32 raw proposals;
- at most 3 accepted catalog attachments;
- at most one attachment per `(objectId, action)`; and
- at most one objective-bearing attachment per room.

All members of a duplicate `(objectId, action)` group are removed. First-wins
and last-wins are forbidden. After member validation and objective-arm repair,
code sorts by `objectId` then action, retains the one trusted objective-bearing
proposal when present, fills the remaining slots with canonical clue-only
proposals, and sorts the final catalog canonically. Equal logical provider input
in any order must therefore produce byte-equivalent validated catalog data.

### Story-specific display text

ADR-0094's persisted consequence attachment may gain optional
`discoveryText`. It is display-only and is never part of a `WorldCommand`,
`WorldEvent`, flag identity, effect choice, journal entry, fact, or memory
write. Old catalogs without it remain valid and retain closed generic feedback.

For newly generated attachments, trusted assembly selects text in this order:

1. a valid sanitized proposal `discoveryText`;
2. otherwise the object's existing validated, non-generic interaction body;
3. otherwise drop the proposal.

Normalization converts allowed text to one plain-text line, trims it, collapses
repeated whitespace, applies existing structural-ID redaction, and ensures a
maximum of 160 characters after normalization. It rejects, rather than repairs,
markup/script content, code fences, prompt/system/developer header leakage, and
command, JSON Patch, or executable-expression-shaped content. Rejected or
missing text drops only that proposal. Renderers render accepted text through
text nodes only. Text is never logged.

### Prompt inputs

The primary room prompt receives no consequence schema. It may encourage concise
story-relevant interaction bodies for eligible objects, but does not require
prose for every object.

The optional objective prompt receives at most eight canonical eligible
candidates:

```ts
type MeaningfulObjectPromptCandidate = Readonly<{
  objectId: string
  type: 'book' | 'scroll' | 'paper' | 'map' | 'chest' | 'crate' | 'barrel' | 'corpse'
  action: 'read' | 'search'
  existingDiscoveryText?: string
}>
```

Candidate text and the room/story label are sanitized and bounded. The prompt
asks for zero to three high-value proposals, exact listed IDs/actions, and
omission when uncertain. It receives no facts, fact visibility data, NPC-private
information, memory, dialogue history, relationship state, hidden objectives,
or raw authoritative state.

### Pipeline and fallback

```text
provider JSON
→ strict root-key validation
→ independent objective and proposal parsing
→ existing objective assembly
→ proposal member parsing
→ stable object resolution and generated-play check
→ family/action and display-text validation
→ duplicate-group removal
→ canonical clue-ID derivation
→ trusted objective relationship resolution
→ deterministic limit enforcement
→ ADR-0094 catalog construction and validation
→ immutable room-cache catalog-map update
→ existing runtime catalog consumption
```

Provider failure/timeout, malformed root JSON, unknown root keys, a too-large
proposal array, no valid proposals, or final catalog validation failure all
preserve Slice B behavior. No retry exists solely for consequences, and old
rooms are never automatically backfilled.

### Initial, later, and stale room results

The initial generated room and later generated rooms use the same validated
attachment result. Catalogs are inserted only through immutable updates to the
existing room-ID-keyed consequence-catalog map. Adjacent pre-generated rooms
remain catalog-free until their existing objective-provider path runs.

If the player leaves while the optional request is in flight, the validated
result is retained in that room's memo/cache for a later return, but it does not
update the visible current-room quest or feedback UI. Stale results never change
authoritative state.

### Persistence and boundaries

The generated room-cache sidecar remains the sole catalog owner. It may persist
only the final validated catalog and sanitized optional discovery text. It must
not persist raw/rejected proposals, diagnostics, provider output, prompts,
provider metadata, or a duplicate quest-sidecar catalog. Old cache data remains
compatible; no automatic backfill occurs.

This decision changes no `WorldState`, save-envelope, `WorldEvent`,
`WorldCommand`, SQLite, API/server, or journal-storage schema.

Accepted proposals are not translated to Slice A `ObjectPurpose` graphs. Direct
trusted validation is sufficient because actions and transitions are already
closed and there are no provider-controlled preconditions. The graph remains dry
at runtime.

### ADR-0094 catalog documentation compatibility

ADR-0094's example includes a required catalog `schemaVersion`, while the
committed catalog wire shape contains only `clues` and `consequences`. This ADR
follows the committed wire shape and does not add a required version field or a
migration. The discrepancy is documentation debt; a small ADR-0094 wording
correction may be proposed separately without runtime changes.

### Logging and security

No new success log is preferred. Essential diagnostics may contain only closed
numeric counts and closed error codes. They must never contain room/object/clue/
quest IDs, names, discovery text, catalog content, raw JSON, prompts, provider
output, facts, memory, or journal text.

## Consequences

This creates a bounded provider proposal path while retaining ADR-0094 as the
only runtime consequence input and `WorldSession`/the append-only event log as
the only authoritative state path. The cost is a carefully bounded expansion of
the existing optional objective response and catalog display data.

## Explicit exclusions

No new provider call; no primary RoomSpec consequence schema; no player free
text actions; clue clusters; provider-controlled clue IDs; confidence,
reliability, hypotheses, facts, fact-visibility changes, memory promotion,
dialogue or relationship effects, authored/cross-room or multi-stage objectives,
machines, barricades, exit unlocking, item consumption, crafting, or Slice D
mechanisms are authorized.

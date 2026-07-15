# Validated Generated Meaningful-Object Consequence Attachment v0 Plan

- Status: Documentation review; do not implement application code or tests until approved
- Date: 2026-07-15
- Decision: ADR-0095

## Goal and scope

Populate the existing ADR-0094 per-room consequence catalog from bounded data
proposed by the existing optional generated-objective provider call. The trusted
assembly path derives identities, validates references, safely degrades invalid
data, and stores only the validated catalog. Runtime continues to consume only
that catalog.

This plan is documentation only. It does not authorize code, test,
`ARCHITECTURE.md`, commit, or push changes.

## Minimum Safe Change Check

- Reuse: the optional objective provider and its timeout/usage seam, objective
  assembler, generated-object stable IDs, ADR-0093 eligibility/evaluator,
  ADR-0094 catalog/runtime, room-cache sidecar, cache restoration, atomic event,
  save/load, and closed journal projection.
- Necessary code: a strict root/branch parser, bounded proposal assembler,
  canonical clue helper, display-text normalizer, optional catalog display field,
  combined attachment result, immutable catalog-map plumbing, and focused tests.
- Unchanged boundaries: no provider call, primary RoomSpec schema, event/command,
  WorldState, SaveGame, database/API schema, renderer authority, facts, memory,
  dialogue, relationships, journal wording, or purpose-graph runtime import.
- Targeted proof: provider contract/prompt budgets, deterministic proposal
  assembly, cache/save compatibility, stale-result composition, red-team, and
  existing Slice B/C regressions.

## Planned files and responsibilities

| Area | Planned responsibility |
| --- | --- |
| `apps/web/src/generation/llmObjectivePrompt.ts` | Build the bounded eight-candidate digest and closed proposal instructions. |
| `apps/web/src/generation/OpenAICompatibleObjectiveGenerator.ts` | Keep one attempt/12-second timeout; raise the cap to at most 700 only with budget proof. |
| `apps/web/src/generation/FakeObjectiveGenerator.ts` | Emit deterministic combined-envelope fixtures only. |
| `apps/web/src/domain/quests/generatedObjectiveSpec.ts` | Define strict root-key and independent objective/proposal branch schemas. |
| `apps/web/src/domain/objectPurpose/generatedMeaningfulConsequenceAttachment.ts` (new) | Pure proposal parsing, eligibility, text normalization/rejection, canonical clue IDs, objective relation resolution, deterministic repair/bounds, and catalog construction. |
| `apps/web/src/domain/objectPurpose/meaningfulObjectConsequences.ts` | Add optional persisted display text while retaining old catalog compatibility and strict final validation. |
| `apps/web/src/app/generatedObjective.ts` | Return independently assembled objective and catalog results without allowing one invalid branch to erase the other. |
| `apps/web/src/app/App.helpers.ts` and `apps/web/src/App.tsx` | Populate initial/later room maps immutably; retain stale async results in memo/cache without stale UI updates. |
| Existing cache/save restore files | Preserve the existing sole room-cache-sidecar ownership and validate the additive optional text field. |
| Colocated tests and red-team tests | Prove the matrix below. |

No `WorldSession`, world event/command, `applyEvent`, journal, persistence,
server, facts, memory, dialogue, relationship, renderer-engine, or primary room
generator file should change.

## Exact schemas and branch parsing

Parse raw JSON into a strict root-key envelope with exactly `title`,
`description`, `hint`, `completionHint`, `condition`, and optional
`meaningfulConsequences`. The root values remain `unknown` until branch parsing.
Unknown root keys fail the envelope and produce no new objective/catalog data.

Pass the first five values to the existing strict objective branch schema and
pass the optional proposal array independently through:

```ts
type GeneratedMeaningfulConsequenceProposal = Readonly<{
  objectId: string
  action: 'read' | 'search'
  discoveryText?: string
  progressCurrentObjective?: true
}>
```

The objective branch may succeed while all proposals fail. Valid clue-only
proposals may survive a failed objective branch. A non-array proposal field or a
member with malformed/unknown fields drops only that proposal branch/member; an
array longer than 32 drops the complete optional proposal branch.

## Trusted assembly and ordering

For each strict proposal member:

1. Resolve exactly one stable object in the validated generated room.
2. Require generated-play provenance and exclude authored/demo, decoration,
   exits, encounters, dialogue, missing/duplicate IDs, and unsupported types.
3. Require document/read, container/search, or remains/search according to the
   closed ADR-0093 table.
4. Select safe story text: proposal text first, otherwise a non-generic existing
   interaction body; drop the proposal if neither is safe.
5. Remove every duplicate `(objectId, action)` group.
6. Derive `generated-clue:${encodeURIComponent(roomId)}:${encodeURIComponent(objectId)}:${action}`
   through one canonical helper.
7. Resolve the objective relationship from the assembled current generated quest;
   retain a requested objective arm only for its unique linked source object,
   with literal `toStage: 1`.
8. Canonically sort by object ID/action, retain the unique objective-bearing
   proposal when present, fill to at most three with clue-only proposals, then
   canonically sort the final clues and consequences.
9. Construct an ADR-0094 catalog and run its existing strict validator.

No provider order, ID, stage, command, effect, flag, event, journal, fact, or
memory field becomes authoritative.

## Display-text contract

The persisted catalog field is optional for compatibility. New generated
attachments require a safe selected value. Normalization produces one trimmed,
plain-text line no longer than 160 characters, collapses repeated whitespace,
and applies existing structural-ID redaction. It rejects controls that cannot
be normalized, HTML/script markup, code fences, prompt/system/developer headers,
and command/JSON-Patch/expression-shaped strings. Rejection drops the proposal;
it never substitutes generated prose. The UI renders only text nodes. The text
is never logged, journaled, evented, facted, memorized, or used to choose effects.

## Prompt and budget plan

The primary prompt adds only optional concise-body guidance for eligible object
types, with no consequence response schema.

The objective prompt adds at most eight canonically sorted candidates containing
`objectId`, eligible `type`, closed action, and optional sanitized bounded
existing discovery text. A bounded sanitized room/story label is allowed. Facts,
visibility data, private NPC data, memories, dialogue history, relationships,
hidden objectives, and raw state are excluded.

The prompt requests zero to three proposals and omission when uncertain. Before
raising the optional output cap from 400 to 700, add:

- a maximum eight-candidate prompt-serialization budget test;
- a response-schema budget test with three 160-character discovery strings;
- usage/cost guardrail expectation updates; and
- truncation tests proving objective-only, clue-only, or Slice B degradation.

The cap may not exceed 700 without another review. The primary cap stays 2,000;
the optional timeout remains 12 seconds; there is one attempt and no
consequence-only retry.

## Initial, later, cache, and stale-result flow

The initial generated room receives a combined attachment after its existing
optional objective request. Later rooms use the same path when their per-room
objective request runs; adjacent pre-generated rooms have no catalog until then.

Store accepted catalogs by room ID through immutable updates to the existing
consequence-catalog map. If the player changes rooms before completion, retain
the validated result in that room's memo/cache, avoid stale current-room UI
updates, and make it available on return. No result changes authoritative state
until the existing ADR-0094 runtime consumes it.

The generated room-cache sidecar is the sole persistence owner. Persist only the
validated catalog and sanitized optional display text. Do not persist raw or
rejected proposals, diagnostics, raw response/prompt/provider data, or a quest
sidecar copy. Old caches remain valid; do not backfill.

## Test matrix

1. Valid document/read creates a validated clue catalog.
2. Valid container/search creates a validated clue catalog.
3. Valid remains/search creates clue plus its eligible objective arm.
4. Unknown, blank, unstable, or duplicate object IDs drop.
5. Unsupported, authored/demo, decorative, exit, encounter, and dialogue objects drop.
6. `inspect` and `open` proposals drop.
7. Unknown root keys reject the complete envelope.
8. Valid objective survives malformed proposal data.
9. Valid clue-only proposals survive an invalid objective branch.
10. More than 32 raw proposals omits the proposal branch.
11. Invalid member drops without erasing valid siblings.
12. Every duplicate `(objectId, action)` member is removed.
13. Three-proposal limit is deterministic.
14. Multiple progress requests retain only the uniquely linked objective source.
15. Missing, authored/demo, cross-room, unrelated, and ambiguous objectives lose their arms.
16. Clue-only data survives objective-arm removal.
17. Canonical clue IDs encode colon, slash, percent, spaces, and Unicode.
18. Equal local object IDs in different rooms derive distinct clue IDs.
19. Provider cannot control clue, quest, objective, room, or stage identities.
20. Provider command/effect/event/flag/fact/journal/memory fields reject.
21. Input-order permutations yield byte-equivalent catalog output.
22. Proposal and fallback interaction bodies obey the display selection order.
23. Text is one line, bounded, structurally redacted, and whitespace-normalized.
24. HTML/script, fences, prompt headers, commands, JSON Patch, and expressions reject.
25. Text cannot alter catalog identity or authoritative effects.
26. Empty/fully rejected proposals preserve Slice B.
27. Provider failure/timeout and truncated response preserve playable fallback.
28. Maximum prompt digest stays within its measured budget.
29. Three maximum-length discovery strings stay within the response budget/cap.
30. Usage/cost guardrails reflect the optional cap change without adding a call.
31. Initial-room catalog map is populated immutably.
32. Later-room catalog map is populated immutably.
33. Stale async results persist in memo/cache but do not update current UI.
34. Valid catalog survives room-cache save/load and return visits.
35. Old cache without display text/catalog remains compatible.
36. Raw/rejected proposals and diagnostics are absent from persistence.
37. Quest sidecar contains no duplicate catalog.
38. Runtime imports no provider, generation parser, or purpose graph.
39. Slice B/C atomic replay, idempotency, and generic journal tests remain green.
40. Facts, fact visibility, memory, dialogue, and relationships remain unchanged.
41. Logs contain only approved closed metadata and no raw/provider/display data.
42. API-key/provider marker red-team inputs never leak to logs or persisted data.

## Manual acceptance plan

Use one real-provider generated room containing a document, reward-bearing
container, remains, and an unsupported decorative object. Confirm story-specific
read/search feedback, one clue per attachment, one linked objective completion,
atomic item/clue/object/objective behavior, generic journal phrases, repeat
idempotency, leave/return and save/reload persistence, and safe Slice B behavior
after provider failure. Confirm no prompt, private fact, raw response, or display
text appears in logs.

## Failure, compatibility, and documentation notes

Any failure before final ADR-0094 catalog validation produces no new catalog and
does not fail the room. The committed ADR-0094 catalog wire shape has only
`clues` and `consequences`, despite an earlier ADR example including
`schemaVersion`. Follow the committed shape; do not introduce a required field or
migration. A small separate documentation correction to ADR-0094 may be proposed
after review.

## Verification after implementation

From `apps/web`, run focused objective/generation/objectPurpose/cache/red-team
tests, then:

```powershell
npm run test
npm run lint
npm run build
node node_modules/typescript/bin/tsc -b
git diff --check
```

Record actual test counts and exit codes. Do not commit or push without a later
explicit request.

## Explicit exclusions

No primary RoomSpec consequence schema, new provider call, automatic backfill,
free-text actions, clue clusters, provider-controlled shared clue IDs,
confidence/reliability, hypotheses, facts/fact visibility, memory promotion,
dialogue/relationship effects, authored/cross-room or multi-stage progression,
machines, barricades, exit unlocking, item consumption, crafting, or Slice D
mechanisms.

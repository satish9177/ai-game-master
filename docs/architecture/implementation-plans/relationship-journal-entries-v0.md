# Implementation Plan — `relationship-journal-entries-v0`

> `relationship-journal-entries-v0` is the **feature name**, not a Git branch —
> this work lands directly on `main` (see §1, "Lane").

> Status: **IMPLEMENTED (Slice 1) — pure, dry-at-runtime candidate contract only.**
> No `App.tsx`, journal-runtime, or UI edits exist. See
> [Closeout (Slice 2)](#closeout-slice-2) for the final file list, verification
> results, and known limitations.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out
> `npc-relationship-state-v0` ([plan](./npc-relationship-state-v0.md)),
> `relationship-valence-reducer-v0`
> ([plan](./relationship-valence-reducer-v0.md) · [ADR-0077](../decisions/ADR-0077-relationship-valence-reducer-v0.md)),
> and `relationship-visible-feedback-v0`
> ([plan](./relationship-visible-feedback-v0.md) · [ADR-0079](../decisions/ADR-0079-relationship-visible-feedback-v0.md)).
> Clones the **dry contract-first** spine of
> `valenced-dialogue-effect-candidates-v0`
> ([ADR-0075](../decisions/ADR-0075-valenced-dialogue-effect-candidates-v0.md)) and
> `room-environment-transition-model-dry-v0`
> ([ADR-0078](../decisions/ADR-0078-room-environment-transition-model-dry-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **locked and dry**. These invariants may not be relaxed without
explicit maintainer approval:

- **Pure domain helper only.** v0 adds one pure module under
  `domain/npcRelationship/`. It constructs candidate *data* and renders *closed
  text*; it wires into nothing.
- **Dry at runtime.** No production runtime/composition file imports the module
  in v0 — proven by a dedicated dry-at-runtime scan test, not merely asserted
  (mirrors ADR-0078).
- **Familiarity-only.** The only candidate the helper can ever produce is an
  **upward familiarity bucket crossing**. Trust/respect/fear are dry today
  (`relationship-valence-reducer-v0`, ADR-0077) and are **deferred** until those
  axes become runtime-emittable.
- **Generic, name-free, closed text only.** No NPC display names, room names,
  object names, spec text, provider/dialogue text, scores, deltas, bucket enum
  values, or effect/source kinds in rendered player-facing text.
- **No append path is created.** The existing journal system is a re-projection
  over authoritative state (§3); v0 does not touch it, does not add a
  `JournalView`/`JournalPanel` producer, and does not invent an append/storage
  path.
- **No authority / persistence / provider change.** No `WorldState`,
  `WorldEvent`, `WorldCommand`, memory, `Fact`/`fact_visibility`, persistence,
  migration, save-game, provider, or prompt change. No `schemaVersion` bump on
  any existing schema.
- **Reuse over new abstraction.** Reuse `familiarityBucket` / `FamiliarityBucket`
  from `domain/npcRelationship/dialogueContext.ts` and the strictly-upward
  crossing rule already proven in `app/relationshipFeedback.ts`.

---

## 1. Title and status

- **Feature:** `relationship-journal-entries-v0`
- **Lane:** worked on `main` directly (no feature branch).
- **Status:** **IMPLEMENTED (Slice 1 — pure/dry contract; Slice 2 — docs closeout).**
- **ADR:** [ADR-0082](../decisions/ADR-0082-relationship-journal-entries-v0.md)
  (next free number; ADR-0081 is `npc-relationship-persistence-v0`).

## 2. Problem statement

We want the player to be able to **review social consequences later** — e.g.
"an NPC became more familiar with you" — as journal-style entries rather than
only a single transient line that vanishes.

The motivating richness ("Malik became more wary of you", "the guard is more
afraid of you") spans trust/respect/fear. But at runtime **only `familiarity`
moves** (ADR-0077): the signed valenced rows in `RELATIONSHIP_EFFECT_DELTA_TABLE`
are dry because `classifyDialogueTurn` never emits them. So a trust/respect/fear
journal today would be **dead code with no live path** and would require bucket
helpers that do not exist.

There is also an architectural blocker: the existing journal system is a **pure
re-projection over authoritative `WorldState`/event-log** (§3). Relationship
state is deliberately **non-authoritative and not event-logged**, and it records
only *current* axes + `interactionCount` — never the *history* of bucket
crossings. A bucket crossing is an **event**, not a re-derivable state, so a
relationship journal cannot be a pure re-projection like the three existing
journals, and it cannot ride the `WorldEvent` log without violating the
authority boundary.

Given both facts, the safe, honest v0 is the same shape the repo has shipped
before for not-yet-wireable mechanics: **a pure, closed, tested contract that is
dry at runtime**, so the visible-journal decision (accumulation store, panel,
persistence) is made later as its own approved slice.

## 3. Current architecture recap

- **The journal system is projection-based, not append-based.** Three producers
  all emit the same `JournalView = { journalId, title, entries: { id, text }[] }`
  and feed the App's single `journal` slot rendered by one `JournalPanel`:
  - authored `JournalSpec` → `domain/journal/projectJournal.ts` (condition eval
    over `WorldState`);
  - generated play → `domain/journal/generatedConsequenceJournal.ts`;
  - append-only `WorldEvent[]` → `domain/journal/eventConsequenceJournal.ts`
    (flag `VITE_CONSEQUENCE_JOURNAL_FROM_EVENTS`, default OFF).
  Each is recomputed on refresh from authoritative state; **none is an append or
  storage API**, and all entry text comes only from closed hand-written phrase
  tables. `JournalEntryView` is `{ id, text }` — there is **no** npcId / axis /
  bucket / timestamp field.
- **Current live relationship runtime only moves familiarity.**
  `RELATIONSHIP_EFFECT_DELTA_TABLE` (`domain/npcRelationship/reducer.ts`) keeps
  every signed valenced row dry; `dialogueContext.ts` hardcodes
  `trustBucket: 'neutral'`, `respectBucket: 'neutral'`, `fearBucket: 'none'`.
  `familiarity` is **monotonic non-decreasing** (reducer guard forbids any
  decrease in v0). `familiarityBucket(n) → 'none' | 'low' | 'medium' | 'high'`
  already exists (thresholds `≤0 → none`, `≤33 → low`, `≤66 → medium`,
  `>66 → high`).
- **Prev + next buckets are already computed at one seam** (for the *future*
  wiring only, not touched in v0). `App.tsx handleNpcDialogueResolved` computes
  `priorRelationship` and `relationshipResult.state` for the active NPC per
  resolved turn and already derives the crossing for
  `relationshipFeedbackAfterReduction`.
- **Relationship persistence hydrates silently and must not create journal
  entries.** The load path re-seeds `relationshipsRef` directly, never calling
  the reducer or feedback derivation (ADR-0081); App-test assertions confirm the
  restore block contains neither `relationshipFeedbackAfterReduction` nor
  `setRelationshipFeedbackState`. Any future journal wiring must obey the same
  rule: **no journal candidate on hydration/load.** In v0 this holds trivially
  because the module is dry (nothing calls it).
- **Boundary note for the module's location.** The helper lives in **domain**,
  so it may import sibling domain (`dialogueContext.ts`) but **may not** import
  the app-layer gate `app/relationshipFeedback.ts` (dependencies point inward).
  v0 therefore keeps its own small bucket-rank/crossing check self-contained in
  the module, mirroring — not importing — the app gate's proven rule.

## 4. Final v0 scope

1. Add **one pure domain module**
   `apps/web/src/domain/npcRelationship/relationshipJournalCandidate.ts`.
2. It exposes a builder that returns **exactly one** candidate on a **strictly
   upward familiarity bucket crossing**, else `null`.
3. It exposes a **closed template table** keyed by `templateId` and a pure
   renderer that maps a candidate to **generic, name-free, closed text**.
4. The candidate carries safe internal-only metadata (`npcId`, `axis`,
   `direction`, `fromBucket`, `toBucket`, `templateId`, `dedupeKey`) that is
   **never** surfaced in player-facing text.
5. It is **dry at runtime**: no production file imports it; a dry-at-runtime scan
   test (Slice 1) proves this.

## 5. Explicit non-goals

- **No visible journal UI** — no panel, no toast, no rendered slot.
- **No journal append path** — v0 creates no storage/accumulation/append API.
- **No `App.tsx` wiring** — the module is imported by nothing but its own test.
- **No `JournalView` / `JournalPanel` producer or shape change** — the rich
  candidate fields stay internal to the helper; `JournalEntryView` is untouched.
- **No event-log / `WorldEvent` route** — relationship changes are
  non-authoritative and are never minted as events.
- **No `WorldState` mutation, `WorldCommand`, memory write, fact /
  `fact_visibility` derivation.**
- **No persistence / sidecar / schema / save-game change; no `schemaVersion`
  bump.**
- **No NPC display names / labels** in player text (generic voice only).
- **No world clock / `worldTime`** field in v0.
- **No trust / respect / fear entries** (those axes are dry; deferred — §12).
- **No LLM-written journal text, no provider/dialogue/prompt text, no raw
  scores/deltas/effect payloads** anywhere in the module.

## 6. Proposed module

`apps/web/src/domain/npcRelationship/relationshipJournalCandidate.ts` — pure,
total, deterministic. No I/O, no `Date.now`/`Math.random`, no logger, no React,
no Three.js, no world-session/persistence import. Imports only sibling domain
types (`FamiliarityBucket`) and its own closed tables.

## 7. Candidate shape

Closed, internal data (not a `JournalView` entry):

```ts
export const NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION = 1 as const

export type RelationshipJournalCandidate = {
  schemaVersion: typeof NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION // 1
  kind: 'npc_relationship_journal_candidate'
  npcId: string          // internal metadata only — NEVER rendered to the player
  axis: 'familiarity'    // v0: the only live axis
  direction: 'increased' // v0: familiarity is monotonic; only upward exists
  fromBucket: FamiliarityBucket
  toBucket: FamiliarityBucket
  templateId: RelationshipJournalTemplateId // closed enum, maps to closed text
  dedupeKey: string      // stable idempotency key (see §9)
}
```

Notes:
- `npcId` is a safe internal **slug** (the same identifier already logged by
  `deriveAndReduceRelationship`), **not** a display name. It is metadata for
  dedupe/scoping only and is **never** player-visible.
- No `worldTime`, no numeric axis value, no delta, no `interactionCount`, no
  effect id, no confidence — none of these appear in the candidate.

## 8. Template

Closed table only; v0 ships exactly one reachable template (familiarity-up):

```ts
export type RelationshipJournalTemplateId = 'familiarity_increased'

export const RELATIONSHIP_JOURNAL_TEMPLATES: Readonly<
  Record<RelationshipJournalTemplateId, string>
> = Object.freeze({
  familiarity_increased: 'Someone here seems more familiar with you.',
})
```

- Generic ("someone here"), epistemic ("seems"), name-free, score-free.
- `renderRelationshipJournalText(candidate)` returns
  `RELATIONSHIP_JOURNAL_TEMPLATES[candidate.templateId]` — text comes
  **exclusively** from this frozen table, never from any candidate field value
  or external input.

## 9. Rules

- **Candidate only on a strictly upward familiarity crossing.**
  `rank(toBucket) > rank(fromBucket)` over `none < low < medium < high`. The
  headline case is the first-interaction `none → low`.
- **No same-bucket candidate** (`from === to` → `null`).
- **No downward candidate** (`rank(to) < rank(from)` → `null`; structurally
  impossible for familiarity, but guarded).
- **One candidate max per call** — a single call returns `RelationshipJournal­Candidate | null`, never a list.
- **Stable dedupe key**, safe (IDs internal only), deterministic and identical
  for the same crossing:
  `relationship-journal:{worldId}:{sessionId}:{npcId}:{axis}:{direction}:{toBucket}`.
  Distinct across the three familiarity crossings; identical on recomputation of
  the same crossing.
- **No raw scores/deltas** in the candidate or the rendered text; the builder's
  only inputs are two `FamiliarityBucket` enum values plus the scope ids.

## 10. Runtime stance

- **No production runtime imports in v0.** The module is referenced only by its
  own test file. `App.tsx`, `derivedViews.ts`, the journal producers,
  `JournalPanel`, and the persistence/load path are all untouched.
- **Dry-at-runtime scan test is required in Slice 1** (mirrors ADR-0078's
  proof): an `import.meta.glob` over both `../../**/*.ts` and `../../**/*.tsx`
  production sources (excluding the module's own file and any `*.test.ts(x)`)
  asserts that no production source references
  `relationshipJournalCandidate` / `RelationshipJournalCandidate`. Scanning both
  extensions closes the gap where a future `.tsx` importer could sneak past a
  `.ts`-only glob.

## 11. Test plan (Slice 1)

- **Pure helper tests:** `none→low`, `low→medium`, `medium→high` each yield one
  candidate with the correct `fromBucket`/`toBucket`/`templateId`/`direction`;
  `from === to` and every downward pair yield `null`; at most one candidate per
  call.
- **Closed template tests:** `renderRelationshipJournalText` returns exactly the
  frozen constant for the reachable template; the template table is frozen and
  complete for every `RelationshipJournalTemplateId`.
- **No score/delta/text leak tests:** neither the candidate nor the rendered
  text contains any numeric axis value, delta, `interactionCount`, NPC display
  name, room/object name, provider/dialogue text, or bucket-internal number; the
  renderer output is a pure function of the closed enum fields (identical inputs
  → identical text; no clock/random).
- **Dedupe tests:** `dedupeKey` is stable/identical for the same
  `(worldId, sessionId, npcId, axis, direction, toBucket)`; distinct across the
  three crossings.
- **Dry-at-runtime import scan** (§10): no production source imports the module.
- **Authority boundary import tests:** the module imports only sibling
  `domain/npcRelationship/*` types + its own tables — **no** `world-session`,
  `interactions`, `encounters`, `dialogue`, `memory`, `persistence`,
  `WorldEvent`/`WorldCommand`, `app/**`, `renderer/**`, React, or Three.js
  import. (These are also enforced by the existing `domain/**` lint block; the
  test documents the intent.)

## 12. Implementation slices

1. **Slice 1 — pure module + tests + dry-at-runtime guard.** Add
   `relationshipJournalCandidate.ts` (candidate builder, closed template table,
   renderer, dedupe-key helper) and `relationshipJournalCandidate.test.ts`
   (§11). No wiring anywhere. Targeted verification:
   `npm.cmd run test -- relationshipJournalCandidate`, then `lint` + `build`.
2. **Slice 2 — docs closeout only.** Flip this plan and ADR-0082 to Implemented,
   and add the single ARCHITECTURE.md status line (implemented-only convention).

## 13. Deferred future work

Each item is its own maintainer-approved feature/ADR:

- **Visible ephemeral journal accumulation.** A new in-memory ref that collects
  candidates as reductions happen in `handleNpcDialogueResolved`, reset-mirrored
  at every point where `relationshipsRef.current = new Map()` runs plus room
  entry — exactly parallel to `relationshipFeedbackState`. Must stay silent on
  hydration/load.
- **Merge with `JournalView` / `JournalPanel`.** Decide precedence vs. the
  authored/generated/event producers for the single `journal` slot (or a
  separate panel), encoding dedupe in the existing `id` field — never widening
  `JournalEntryView`.
- **NPC display-label policy.** Only if a safe, spec-sourced name channel is
  approved (never provider/dialogue text).
- **Persistence decision.** Whether "review later" survives save/load; if so,
  its own sidecar decision (the relationship sidecar holds only current axes, not
  crossing history).
- **Trust / respect / fear entries** and their bucket helpers — gated on the
  valenced rows becoming runtime-emittable and `dialogueContext.ts` widening.
- **World clock / `worldTime`** on entries — only if a safe clock projection is
  wired at the reduction seam.
- **ARCHITECTURE.md status line** — added at closeout only, per the
  implemented-only convention.

## 14. Risk analysis

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Speculative multi-axis dead code | High (avoided) | v0 is familiarity-only; trust/respect/fear deferred until live |
| Accidental live wiring slips in | Medium | Dry-at-runtime scan test over `.ts` + `.tsx` fails the build if any production source imports the module |
| Rendered text leaks names/scores | Medium | Text comes only from the frozen closed table; leak-sweep test |
| Journal entry on hydration/load | Medium | Module is dry (nothing calls it); future wiring must clone the ADR-0081 silent-load rule |
| Domain importing app-layer gate | Low | Module keeps its own bucket-rank check; boundary import test + `domain/**` lint |
| Duplicate/again crossing re-emits | Low | `dedupeKey` includes `toBucket`; monotonic familiarity → each crossing is one-shot |

## 15. Final recommendation

Land Slice 1 as a pure, closed, tested, dry-at-runtime contract when approved.
It clones the proven dry-first spine (ADR-0075/ADR-0078), reuses
`familiarityBucket`, touches no authoritative/persisted/UI state, adds no logs,
and is fully coverable by pure + boundary + dry-scan tests without rendering the
game. The visible-journal decision (accumulation, panel, persistence) is left as
a clean, separately-reviewable next slice.

### Minimum Safe Change Check (planned)

- **Reuse:** `familiarityBucket` / `FamiliarityBucket`
  (`domain/npcRelationship/dialogueContext.ts`) and the strictly-upward crossing
  rule proven in `app/relationshipFeedback.ts` (mirrored, not imported).
- **Minimum new code:** one pure domain module + its test. No reducer change, no
  journal-producer change, no `App.tsx` change, no schema, no lint rule.
- **Safety boundaries unchanged:** no `WorldState` / `WorldEvent` /
  `WorldCommand` / memory / fact / `fact_visibility`; no persistence / migration
  / save-game / `schemaVersion` bump; no provider / prompt / NPC-behavior / UI /
  renderer change; no new logs; the module is dry at runtime.
- **Tests prove it:** §11, anchored by the leak-sweep, dedupe, dry-at-runtime,
  and boundary-import tests.

## Closeout (Slice 2)

**Feature complete for v0.** Slice 1 (pure module + tests) is implemented and
committed on `main`. Slice 2 (this closeout) is docs-only.

Implemented files:

- `apps/web/src/domain/npcRelationship/relationshipJournalCandidate.ts` (Slice 1)
  — `NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION`,
  `RelationshipJournalCandidate`, `RelationshipJournalCandidateInput`,
  `RelationshipJournalTemplateId`, `RELATIONSHIP_JOURNAL_TEMPLATES`,
  `buildRelationshipJournalCandidate`, `renderRelationshipJournalText`.
- `apps/web/src/domain/npcRelationship/relationshipJournalCandidate.test.ts`
  (Slice 1) — candidate-builder, closed-template, dedupe, leak-sweep,
  trust/respect/fear-exclusion, dry-at-runtime scan, and import-boundary tests.

Behavior summary:

- **Pure domain helper only.** The module builds candidate *data* and renders
  *closed text*; it is total, deterministic, and imports only the sibling
  `FamiliarityBucket` type plus its own frozen tables.
- **Familiarity-up bucket crossing only.** `buildRelationshipJournalCandidate`
  returns exactly one candidate on a strictly upward `FamiliarityBucket`
  crossing (`none→low`, `low→medium`, `medium→high`), else `null` (same-bucket
  and downward pairs).
- **Closed internal candidate shape.** `schemaVersion`, `kind`, `npcId`
  (internal slug only), `axis: 'familiarity'`, `direction: 'increased'`,
  `fromBucket`, `toBucket`, `templateId`, and a stable, scope-derived
  `dedupeKey`. No `worldTime`, numeric axis value, delta, or
  `interactionCount`.
- **Closed, generic rendered text.** `renderRelationshipJournalText` returns
  text exclusively from the frozen `RELATIONSHIP_JOURNAL_TEMPLATES` table;
  v0 ships one reachable entry
  (`familiarity_increased → "Someone here seems more familiar with you."`).
- **No NPC labels.** `npcId` is never rendered; the text is name-free and
  generic ("someone here").
- **No trust/respect/fear entries.** The candidate `axis` is always
  `'familiarity'`; the template table exposes no other template id — those
  axes stay dry per ADR-0077 until they become runtime-emittable.
- **No `worldTime`.** No clock/timestamp field exists on the candidate.
- **No runtime wiring.** Nothing outside the module's own test imports it.
- **Dry-at-runtime guard proves no production imports.** A dedicated
  `import.meta.glob` scan over all production `.ts`/`.tsx` sources (excluding
  the module and any `*.test.ts(x)`) asserts zero references to
  `relationshipJournalCandidate` / `RelationshipJournalCandidate`.

Safety summary (all unchanged / not introduced):

- No raw scores, no deltas, no `interactionCount` in the candidate or
  rendered text (leak-sweep test).
- No raw dialogue/prompt/provider/effect/feedback text anywhere in the
  module — text is a total function of the closed enum, sourced only from
  the frozen template table.
- No memory, `Fact`, or `fact_visibility` write or derivation.
- No `WorldEvent` or `WorldCommand` minted or read.
- No `WorldState` mutation of any kind.
- No persistence, schema, or save-game change; no `schemaVersion` bump on
  any existing schema (the candidate carries only its own local
  `NPC_RELATIONSHIP_JOURNAL_CANDIDATE_SCHEMA_VERSION`).

Verification:

```bash
npm run test -- relationshipJournalCandidate   # 1 file, 18 tests passed
npm run test -- npcRelationship                # 5 files, 104 tests passed
npm run build                                  # tsc -b && vite build — passed
npm run lint                                    # eslint . — passed, no findings
```

Known limitations (deferred, each its own maintainer-approved feature/ADR
per §13):

- Not visible to the player yet — no journal panel integration.
- No persistence — the candidate is not saved/loaded.
- No NPC name rendering — display-label policy is undecided.
- Trust/respect/fear entries are deferred until those axes are
  runtime-emittable (ADR-0077).
- Any future runtime wiring (ephemeral accumulation store, `JournalView`
  merge, persistence) must be separately approved — this closeout does not
  authorize it.

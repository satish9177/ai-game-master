# ADR-0075: Valenced Dialogue Effect Candidates v0

- **Status:** Accepted — Planned (Option A: contract + dry wiring; not yet implemented)
- **Date:** 2026-07-05
- **Deciders:** Project owner
- **Builds on (implementation plans; these features shipped without ADRs):**
  [`dialogue-semantic-events-v0`](../implementation-plans/dialogue-semantic-events-v0.md),
  [`structured-dialogue-effects-v0`](../implementation-plans/structured-dialogue-effects-v0.md),
  [`npc-relationship-state-v0`](../implementation-plans/npc-relationship-state-v0.md).

> Full plan and closeout live in
> [`valenced-dialogue-effect-candidates-v0`](../implementation-plans/valenced-dialogue-effect-candidates-v0.md).
> This ADR records the decision; implementation is a separate, maintainer-approved
> step and its closeout (status flip + ARCHITECTURE.md status line) is deferred.

---

## Context

`structured-dialogue-effects-v0` established an inert, non-authoritative
**candidate** layer (`StructuredDialogueEffect`) derived only from validated
`DialogueSemanticEvent` objects, with exactly two kinds
(`player_question_effect_candidate`, `npc_response_effect_candidate`). A future NPC
relationship reducer will need to move trust / fear / respect in response to richer
*valenced* dialogue signals — the player threatened, apologized, thanked, refused,
promised; the NPC warned, offered, refused.

There is no safe inert vocabulary for those signals today. Without it, a future
consumer would be pushed toward one of two unsafe shortcuts: re-deriving valence
from **raw dialogue text** (regex/keyword sniffing — a violation of the "no raw
text sniffing" goal and the logging-redaction boundary), or letting the **LLM
propose the valence label** (an untrusted model in the authority path). An earlier
draft of this feature took the regex-over-raw-text route and was rejected in
review.

Two facts about the current code shape the safe design:

1. `classifyDialogueTurn` derives semantic events from **structural signals only**
   (`promptId ∈ {ask-room, ask-help}`, `hasNpcReply`) and reads no dialogue text.
   It emits only `player_asked_question` and `npc_responded`; the other
   semantic-event kinds are defined-but-unemitted.
2. A `StructuredDialogueEffect.sourceKind` must be a valid
   `DialogueSemanticEventKind`. Of the 9 desired valenced candidates, 4 already have
   a matching source kind (`player_threatened_npc`, `player_promised_help`,
   `npc_warned_player`, `npc_refused_request`) and 5 do not — so adding the
   candidates forces adding 5 upstream semantic-event kinds too.

---

## Decision

Ship **Option A only** — contract additions plus a wired-but-dry derivation map. No
runtime emission of valenced candidates in v0.

- **Add 5 `DialogueSemanticEventKind` values** so every valenced candidate has a
  valid `sourceKind`: `player_apologized`, `player_thanked_npc`,
  `player_insulted_npc`, `player_refused_request`, `npc_offered_help`.
- **Add 9 `StructuredDialogueEffectKind` values:** `player_threat_candidate`,
  `player_apology_candidate`, `player_gratitude_candidate`,
  `player_insult_candidate`, `player_refusal_candidate`, `player_promise_candidate`,
  `npc_warning_candidate`, `npc_offer_candidate`, `npc_refusal_candidate`.
- **Extend the `sourceKind → candidateKind` map** (`derive.ts`,
  `EFFECT_KIND_BY_SOURCE_KIND`) from 2 to 11 entries. The map is **wired but dry**.
- **Both enum additions are additive → no `schemaVersion` bump** on either contract.

The decision commits to these boundaries:

- **Valence comes only from closed semantic-event kinds.** The candidate's valence
  is a pure, total function of the closed `sourceKind` enum via the map — never from
  raw text, regex/keyword matching, or heuristics over content.
- **The candidate `kind` carries the valence.** No separate `valence` field is added
  to either schema; a future reducer maps `kind → {trust, fear, respect}` delta
  under its own review. Keeping valence implicit in the closed enum is the safety
  property — there is no field for a model to populate.
- **`classifyDialogueTurn` remains unchanged in v0.** It still emits only
  `player_asked_question` and `npc_responded` and reads only structural signals, so
  no valenced *source* event is produced at runtime.
- **The source map is wired but dry.** Its valenced entries are reachable only by a
  directly injected semantic event of a valenced kind; no runtime code path produces
  one in v0. Consequently
  `deriveStructuredDialogueEffects(classifyDialogueTurn(input))` yields **zero**
  valenced candidates for every input — free text, unknown `promptId`, and
  `ask-room`/`ask-help` alike. This invariant is enforced by a dedicated
  classify → derive non-emission test, not merely asserted.
- **Free text is never classified for valence.** `playerLine` and NPC reply text
  never enter classification or the effects layer; the deriver's input type
  (`DialogueSemanticEvent[]`) carries no text, so text isolation is structural, not
  conventional.
- **The LLM / provider cannot propose valence.** `provenance.classifier` stays the
  literal `'deterministic-local'`; there is no `'llm'` classifier value and no
  provider/prompt change.
- **Relationship reducers remain untouched.** `domain/npcRelationship/reducer.ts`
  and `app/deriveAndReduceRelationship.ts` are not read for mutation or changed.
  Candidates stay `status: 'candidate'`, inert, consumed by nothing.

The dry map is the seam a future, separately-approved closed structured-action
source turns live — with no further schema change.

---

## Consequences

- The inert vocabulary a future relationship-reducer feature needs exists and is
  validated, without any runtime behavior change and without a text- or LLM-based
  valence path.
- Adding a valenced candidate for a new dialogue signal now has a clear, tested
  pattern: add its source semantic-event kind, add its candidate kind, add the map
  entry, and (separately) make some closed structured-action source emit the source
  event.
- The existing `derive.test.ts` `RESERVED_EVENT_KINDS` list shrinks from 7 to 3
  (`player_shared_claim`, `npc_revealed_rumor`, `npc_acknowledged_memory`) because 4
  previously-reserved kinds become mapped; this is an expected test edit.
- No authoritative-state, memory, fact, `fact_visibility`, persistence, migration,
  save-game, provider, prompt, UI, or lint-rule change is introduced.
- **Deferred (each its own maintainer-approved feature):** a closed
  structured-action source that makes emission live; relationship-reducer
  consumption of candidates (which must route through the existing `WorldCommand`
  boundary, never applied directly from a candidate); any persistence surface for
  candidates.

---

## Verification

No verification recorded yet — this ADR is docs-only and Planned. Implementation
verification (targeted `dialogueEvents`, `structuredDialogueEffects`, and
`evaluation` test runs plus lint) will be recorded in the implementation-plan
closeout when the slice is built and approved.

# Implementation Plan — `feature/valenced-dialogue-effect-candidates-v0`

> Status: **APPROVED / PLANNED — Option A (contract + dry wiring). Not yet implemented.**
> Docs-only slice: this plan plus [ADR-0075](../decisions/ADR-0075-valenced-dialogue-effect-candidates-v0.md).
> No runtime/source code is written until the maintainer approves implementation.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out `structured-dialogue-effects-v0`
> ([plan](./structured-dialogue-effects-v0.md)) and `dialogue-semantic-events-v0`
> ([plan](./dialogue-semantic-events-v0.md)); the eventual consumer is the
> separate, unapproved relationship-reducer feature after `npc-relationship-state-v0`
> ([plan](./npc-relationship-state-v0.md)).

---

## 0. Approval status and locked invariants (read first)

The design is **approved for Option A only** (contract + dry wiring). These
invariants may not be relaxed without explicit maintainer approval:

- **Valence comes only from closed semantic-event kinds.** No raw text classifier,
  no regex/keyword sniffing, no LLM-proposed valence.
- **The candidate `kind` carries the valence.** No separate `valence` field is
  added to either schema.
- **`classifyDialogueTurn` is unchanged.** It still emits only
  `player_asked_question` and `npc_responded`, and it reads only `promptId` /
  `hasNpcReply` — never `playerLine` or NPC reply text.
- **The `sourceKind → candidateKind` map is wired but dry.** All valenced entries
  are reachable only by *directly injected* semantic events; no runtime path emits
  a valenced source event in v0.
- **Zero runtime emission of valenced candidates in v0** — free text, unknown
  `promptId`, and `ask-room`/`ask-help` all yield no valenced candidate.
- **No authority path touched:** no `WorldState`, `WorldEvent`, `WorldCommand`,
  relationship reducer, memory, `Fact`, `fact_visibility`, persistence, migration,
  save-game, provider, LLM prompt, or UI change.
- **No `schemaVersion` bump** on either contract — the enum additions are additive.
- **No raw text** in candidate payloads (there is no text field), provenance, logs,
  or test assertions (static input fixtures aside). **Fail closed** on
  unknown/invalid input.

---

## 1. Problem statement

A future NPC relationship reducer needs to move trust / fear / respect in response
to *what kind of thing* happened in a dialogue turn — the player threatened,
apologized, thanked, refused, promised; the NPC warned, offered, refused. Today
the only signals that survive to a safe layer are `player_asked_question` and
`npc_responded`; the richer valenced signals have **no inert vocabulary**, so a
future consumer would be tempted to re-derive them from raw text (a logging /
"no text sniffing" violation) or from an LLM label (an untrusted model in the
authority path).

This feature adds that inert vocabulary **now**, sourced only from closed enums,
and proves — by construction and by test — that it emits **nothing** at runtime
until a separate, approved slice adds a legitimate closed structured-action source.
Establishing the boundary before any consumer exists is the same safe order used by
`dialogue-semantic-events-v0` and `structured-dialogue-effects-v0`.

## 2. Approved Option A design

- Add the 5 missing upstream `DialogueSemanticEventKind` values so all 9 valenced
  candidates have a valid `sourceKind` (a candidate's `sourceKind` **must** be a
  real semantic-event kind — this is the hard coupling that forces the upstream
  additions).
- Add the 9 `*_candidate` values to `StructuredDialogueEffectKind`.
- Extend the `EFFECT_KIND_BY_SOURCE_KIND` map in `derive.ts` from 2 to 11 entries
  (wire-now, per resolved open question 1) so the mechanism is complete and
  directly testable.
- **Do not touch `classifyDialogueTurn`.** Because no valenced *source* event is
  emitted at runtime, no valenced *candidate* is produced at runtime — the map is
  live but dry.
- No `valence` field: the closed `kind` **is** the valence; a future reducer maps
  `kind → {trust, fear, respect}` delta under its own review.
- Additive enums only → no `schemaVersion` bump on either contract.

## 3. Exact contract/schema changes

**`apps/web/src/domain/dialogueEvents/contracts.ts`** — append 5 members to
`DialogueSemanticEventKindSchema` (existing members and order unchanged; new
members appended):

```
player_apologized
player_thanked_npc
player_insulted_npc
player_refused_request
npc_offered_help
```

`DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION` stays `1`.

**`apps/web/src/domain/structuredDialogueEffects/contracts.ts`** — append 9 members
to `StructuredDialogueEffectKindSchema`:

```
player_threat_candidate
player_apology_candidate
player_gratitude_candidate
player_insult_candidate
player_refusal_candidate
player_promise_candidate
npc_warning_candidate
npc_offer_candidate
npc_refusal_candidate
```

`STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION` stays `1`.

No other schema field changes. Both schemas remain `.strict()`. No new
optional/text/`valence`/payload field. `StructuredDialogueEffect.sourceKind`
continues to reference `DialogueSemanticEventKindSchema`, which is exactly why the
5 upstream additions are prerequisites of the 9 candidate additions.

## 4. Dry `sourceKind → candidateKind` map

**`apps/web/src/domain/structuredDialogueEffects/derive.ts`** — extend
`EFFECT_KIND_BY_SOURCE_KIND` to 11 total entries. `deriveStructuredDialogueEffects`
logic is otherwise unchanged: it validates the source event, looks up the map,
constructs the candidate, and re-validates it.

| sourceKind | candidateKind | source status |
| --- | --- | --- |
| `player_asked_question` | `player_question_effect_candidate` | existing |
| `npc_responded` | `npc_response_effect_candidate` | existing |
| `player_threatened_npc` | `player_threat_candidate` | existing source, new map |
| `player_promised_help` | `player_promise_candidate` | existing source, new map |
| `npc_warned_player` | `npc_warning_candidate` | existing source, new map |
| `npc_refused_request` | `npc_refusal_candidate` | existing source, new map |
| `player_apologized` | `player_apology_candidate` | new source + new map |
| `player_thanked_npc` | `player_gratitude_candidate` | new source + new map |
| `player_insulted_npc` | `player_insult_candidate` | new source + new map |
| `player_refused_request` | `player_refusal_candidate` | new source + new map |
| `npc_offered_help` | `npc_offer_candidate` | new source + new map |

After this change the only semantic kinds mapping to **no** candidate are
`player_shared_claim`, `npc_revealed_rumor`, `npc_acknowledged_memory`. The existing
`derive.test.ts` `RESERVED_EVENT_KINDS` list (currently 7 kinds) **shrinks to these
3** — a required test edit, not a new file.

## 5. Runtime non-emission invariant

Stated precisely, and enforced by test (§7), not merely asserted:

> `classifyDialogueTurn` emits only `player_asked_question` (from
> `promptId ∈ {ask-room, ask-help}`) and `npc_responded` (from `hasNpcReply`). It
> reads `promptId` and `hasNpcReply` only — never `playerLine` or NPC reply text.
> Therefore, for every possible input,
> `deriveStructuredDialogueEffects(classifyDialogueTurn(input))` contains **zero**
> valenced candidates.

The map being live is safe because its valenced entries are only reachable by a
directly injected semantic event of a valenced kind, and no runtime code path
produces one in v0. The dry map is the seam a future approved structured-action
source turns live with **no further schema change**.

## 6. Safety / authority boundaries

- **No authoritative state can change.** No `WorldEvent` / `WorldCommand` / reducer
  / `WorldState`; `NPCDialogueService` stays `getWorldState`-only and is not
  touched; the relationship reducer (`domain/npcRelationship/reducer.ts`,
  `app/deriveAndReduceRelationship.ts`) is not touched.
- **No memory / fact / fact_visibility / relationship write path** is introduced;
  the memory firewall is unaffected.
- **Text isolation is structural.** The deriver's input type is
  `DialogueSemanticEvent[]`, which carries no text; there is no parameter through
  which raw dialogue could enter the effects layer. Valence is a pure function of
  the closed `sourceKind` enum.
- **Layer placement respects BOUNDARIES.** All runtime changes are pure `domain/**`
  enum/map additions importing only `zod` and existing `domain/dialogueEvents`
  types. Domain-imports-domain is already covered by the existing `domain/**` lint
  block — **no new lint rule required**, no new import edge.
- **No LLM valence.** `provenance.classifier` stays the literal
  `'deterministic-local'`; no `'llm'` value exists. Confidence stays copied from the
  source event, never computed from content.
- **Fail closed** at both boundaries: the validator drops anything that doesn't
  parse; the deriver emits nothing for unknown/reserved kinds.
- **No `schemaVersion` bump** anywhere.

## 7. Required tests

**Contract validation — semantic events**
(`domain/dialogueEvents/contracts.test.ts`):
- each of the 5 new kinds parses inside an otherwise-valid event;
- `.strict()` still rejects extra keys; unknown kind still rejected.

**Contract validation — candidate kinds**
(`domain/structuredDialogueEffects/contracts.test.ts`):
- each of the 9 new candidate kinds parses inside an otherwise-valid effect;
- `.strict()` preserved; unknown kind rejected; `schemaVersion` literal `1`;
  `status` only `'candidate'`; `classifier` only `'deterministic-local'`.

**Map consistency + direct injection**
(`domain/structuredDialogueEffects/derive.test.ts`):
- every `EFFECT_KIND_BY_SOURCE_KIND` key is a valid `DialogueSemanticEventKind`;
  every value is a valid `StructuredDialogueEffectKind`; all 9 valenced candidate
  kinds are reachable from exactly one source kind;
- **update `RESERVED_EVENT_KINDS`** to the 3 remaining unmapped kinds and keep the
  "reserved → no effect" assertion;
- **direct injection:** for each of the 9 valenced source kinds, an injected valid
  semantic event maps to the expected candidate and the result validates through
  `StructuredDialogueEffectSchema`;
- **per-kind actor/target assertions** (resolved open question 4): each
  direct-injection case asserts the expected `actor`/`target` for that kind —
  `player_*` sources ⇒ actor `player` / target `npc`; `npc_*` sources ⇒ actor `npc`
  / target `player` — documenting intent while confirming the deriver copies these
  through unchanged.

**Dedicated non-emission test** (new file, resolved open question 2 —
`domain/structuredDialogueEffects/nonEmission.test.ts`, spanning classify → derive):
- **free text** (`playerLine` set, `promptId` undefined) → zero valenced candidates;
- **unknown `promptId`** → zero valenced candidates;
- **`ask-room` / `ask-help` unchanged** → exactly the existing question/response
  candidates and no valenced ones;
- **adversarial free text** containing candidate/kind names (e.g.
  `"player_threatened_npc"`, `"threaten"`) as `playerLine` → zero valenced
  candidates (proves classification keys on structural `promptId`, not text);
- **flooding** — many free-text turns → output bounded and zero valenced candidates.

**Cross-cutting safety (extend existing evals):**
- `evaluation/logSafety.eval.test.ts` — the new kinds are the only new strings in
  `deriveAndLogStructuredDialogueEffects` output; no `playerLine` / NPC reply text
  logged;
- `evaluation/noSideEffects.eval.test.ts` — deriving valenced candidates (via direct
  injection) appends no `WorldEvent`, issues no command, writes no memory / fact,
  and touches no relationship state.

## 8. Implementation slices

This feature is **one** implementation slice; the ordering below is the intended
commit sequence within it (separate from this docs-only slice, which is what is
delivered now).

1. **Contract enums** — 5 semantic kinds + 9 candidate kinds + their validation
   tests (§3, §7). Compiles green; no wiring yet.
2. **Dry map + derive tests** — extend `EFFECT_KIND_BY_SOURCE_KIND`, shrink
   `RESERVED_EVENT_KINDS`, add map-consistency + direct-injection + per-kind
   actor/target tests (§4, §7).
3. **Non-emission + safety tests** — the dedicated `nonEmission.test.ts` plus the
   `logSafety` / `noSideEffects` eval extensions (§5, §7).
4. **Docs closeout** — flip this plan and ADR-0075 to Implemented and add the
   ARCHITECTURE.md status line, at implementation time only.

## 9. Deferred work

- **A closed structured-action source (the old "Option B").** A future approved
  slice that adds structured action `promptId`s and maps them in
  `classifyDialogueTurn` so valenced candidates emit at runtime — turning this
  slice's dry map live with **no further schema change**. This is where any UI
  action buttons / prompt wiring is honestly accounted for.
- **Relationship-reducer consumption.** Mapping candidate `kind →
  {trust, fear, respect}` delta in `domain/npcRelationship`. Out of scope here and
  must route through the existing validated `WorldCommand` path — never applied
  directly from a candidate.
- **Any persistence / save-game surface** for candidates. None in v0.

## 10. Open questions resolved

1. **Wire the map now vs. defer?** → **Wire now.** Map live, source dry; the
   non-emission invariant is directly testable.
2. **Home for the non-emission test?** → **Dedicated file**
   (`nonEmission.test.ts`) since it spans classify → derive.
3. **ADR now or at implementation?** → **Author the ADR in this feature**, using
   the next free number after confirming it is unused. Confirmed free:
   **ADR-0075** (highest existing is ADR-0074).
4. **`actor`/`target` for the new source kinds?** → **Add per-kind actor/target
   assertions** in the direct-injection tests (cheap, documents intent).

## 11. Final recommendation

**Approve implementation of this single slice as specified.** The design satisfies
every hard boundary: additive closed-enum vocabulary, no `schemaVersion` bump, no
authority / provider / UI / text path, and a test-enforced zero-runtime-emission
invariant. Recommend implementing in the slice order of §8, with verification:

```bash
npm.cmd run test -- dialogueEvents
npm.cmd run test -- structuredDialogueEffects
npm.cmd run test -- evaluation
npm.cmd run lint
```

`npm.cmd run build` may remain red due to the known pre-existing, unrelated
TypeScript failures noted in prior dialogue-chain closeouts; report status honestly
rather than claiming green.

### Minimum Safe Change Check

- **Reused:** `DialogueSemanticEventKindSchema`, `StructuredDialogueEffectSchema`,
  `validateStructuredDialogueEffect`, `deriveStructuredDialogueEffects`, the
  existing `derive.test.ts` harness/fixtures, and the `logSafety` / `noSideEffects`
  eval suites.
- **Minimum new code:** 5 + 9 enum members and 9 map entries — no new runtime files,
  functions, or abstractions; one new test file (`nonEmission.test.ts`).
- **Safety boundaries unchanged:** no `WorldEvent` / `WorldCommand` / reducer /
  `WorldState`; read-only dialogue service untouched; memory firewall and facts
  intact; no persistence / migration / `schemaVersion` bump; no provider / prompt /
  UI change; valence derives only from validated closed-enum semantic events and
  inspects no text.
- **Tests prove it:** §7, anchored by the runtime non-emission invariant (§5).

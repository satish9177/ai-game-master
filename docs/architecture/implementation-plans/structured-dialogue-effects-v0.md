# Implementation Plan — `feature/structured-dialogue-effects-v0`

> Status: **Slice 1 APPROVED (docs-only save). Not implemented.**
> Slice 1 = pure `domain/structuredDialogueEffects/` contracts + validator + tests.
> Slice 2 (derivation) and Slice 3 (runtime wiring/logging) are **separate future
> approvals** — not approved by this plan.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out `dialogue-semantic-events-v0`
> ([plan](./dialogue-semantic-events-v0.md)): contracts + validator + deterministic
> classifier + inert runtime derivation/log/discard.
>
> **No ADR stub in Slice 1** (matches the `dialogue-semantic-events-v0` precedent).

---

## 0. Approval status and scope gates (read first)

**Slice 1 is the only approved implementation slice.** It adds four new pure-domain
files and nothing else:

- `apps/web/src/domain/structuredDialogueEffects/contracts.ts`
- `apps/web/src/domain/structuredDialogueEffects/validate.ts`
- `apps/web/src/domain/structuredDialogueEffects/contracts.test.ts`
- `apps/web/src/domain/structuredDialogueEffects/validate.test.ts`

Slice 2 (pure derivation) and Slice 3 (inert runtime wiring/logging) are described
below so the contract shape is stable, but they are **deferred to separate
maintainer approvals** and must not be implemented under this plan.

### Locked invariants for every slice of this feature

None may be relaxed without explicit maintainer approval:

- **A `StructuredDialogueEffect` is NOT a `WorldEvent` and NOT a `WorldCommand`.**
  It is an inert, non-authoritative **candidate** — strictly below
  WorldCommand/WorldEvent/facts/memory in authority.
- **No `WorldState` mutation.** No event, command, reducer, or `WorldState` field
  is added or touched. `NPCDialogueService` stays `getWorldState`-only and is not
  touched.
- **No memory writes.** No memory record is created, updated, or promoted.
- **No fact derivation.** No `Fact` is produced; the `deriveFactFrom*` path is not
  called or extended.
- **No relationship update.** No relationship state is created or changed.
- **No quest / inventory / exit changes.** No quest flag, objective, inventory
  item, or exit lock/unlock is created, read for mutation, or modified.
- **No persistence / schema / migration / save-game changes.** No SQLite table, no
  migration, no save-game field, no `schemaVersion` bump anywhere.
- **No provider / LLM / prompt changes.** No new provider call, no prompt/template
  change, no network I/O, no hidden calls.
- **No raw text inspection.** Effects derive **only** from *validated*
  `DialogueSemanticEvent` objects — never from `playerLine`, NPC reply text,
  provider output, prompts, or memory text. The effects layer has no parameter
  through which raw dialogue text can enter.
- **No raw text logging.** Never log `playerLine`, NPC/player dialogue text,
  provider request/response bodies, prompt text, memory text, or PII. Only closed
  enums, booleans, counts, and safe ids may ever be logged.
- **Fail closed.** Unknown/invalid input yields **no effect**. Reserved/unemitted
  semantic-event kinds produce **no effect** until a future structured-provider-output
  slice is separately approved.

---

## 1. Feature goal

Introduce a pure, deterministic **structured dialogue effect** layer: a validated,
closed-enum representation of *what the game may later consider doing* in response
to a dialogue turn — derived **only** from already-validated
`DialogueSemanticEvent` objects. In v0 these effects are **inert candidates**:
nothing consumes them, nothing acts on them, nothing stores them. They are the
typed substrate a future, separately-approved gameplay-consumption feature could
read — but only after this candidate/validation boundary exists and is trusted.

## 2. Problem being solved

`dialogue-semantic-events-v0` answers *"what happened in the turn?"*
(`player_asked_question`, `npc_responded`) and deliberately stops there — a
semantic event is an observation, not an intent to act. A future
relationship/quest/memory feature would otherwise be tempted to jump straight from
raw dialogue (or from a semantic event) to a state change at its own call site,
re-deriving meaning unsafely. This feature inserts the **missing middle layer**: a
validated, non-authoritative *candidate effect* vocabulary, so any future consumer
reads closed, schema-checked candidates instead of sniffing text or improvising
authority. Establishing the boundary **before** any consumer exists is the safe
order — the same discipline that shipped semantic events inertly first.

## 3. Layer distinction (authority ladder)

| Concept | Authoritative? | Mutates state? | Persisted? | Derived from | Where |
| --- | --- | --- | --- | --- | --- |
| **DialogueSemanticEvent** | No | No | No | closed structural turn signals | `domain/dialogueEvents` |
| **StructuredDialogueEffect** (this feature) | **No** — candidate only | **No** | **No (v0)** | *validated* semantic events only | `domain/structuredDialogueEffects` (new) |
| **WorldCommand** | No by itself (an instruction) | Only via `WorldSession.appendEvent` → reducer | No | fixed-vocabulary planners | `domain/world` |
| **WorldEvent** | **Yes** (sole truth) | Yes (via reducer) | Yes (append-only log) | validated commands | `domain/world/events.ts` |
| **MemoryRecord** | No (supporting context) | No | Yes (SQLite/sidecar) | firewalled memory services | `domain/memory` |
| **Fact** | No (inert label) | No | No | `deriveFactFrom*` | `domain/facts` |
| **Relationship state** (future) | TBD (likely projection) | — | — | not built | — |

**Precise boundary between the two adjacent layers:**

- A `DialogueSemanticEvent` says *"the player asked a question"* — a past-tense
  observation of the turn.
- A `StructuredDialogueEffect` says *"the game **may** consider treating this turn
  as a help request"* — a labelled, non-authoritative candidate. To ever affect
  truth it would have to be picked up by a future consumer and routed through the
  **existing** validated `WorldCommand` path — never applied directly. In v0 there
  is no such consumer.

## 4. Proposed `StructuredDialogueEffect` model (Slice 1)

Structural, closed-enum only — **no free text**, matching the semantic-event and
fact conventions. Proposed shape (`zod`, `.strict()`), reusing
`DialogueSemanticEventKindSchema` from `domain/dialogueEvents/contracts` for
`sourceKind`:

```ts
// domain/structuredDialogueEffects/contracts.ts
export const STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION = 1 as const

StructuredDialogueEffectKindSchema = z.enum([
  'player_question_effect_candidate',
  'npc_response_effect_candidate',
])

StructuredDialogueEffectSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION),
  effectId: z.string().min(1),          // caller-stamped opaque id; NOT world-authoritative
  kind: StructuredDialogueEffectKindSchema,
  sourceEventId: z.string().min(1),     // the validated DialogueSemanticEvent.eventId it derives from
  sourceKind: DialogueSemanticEventKindSchema,  // reused from dialogueEvents/contracts
  status: z.literal('candidate'),       // single-value in v0: never 'applied'/'accepted'
  actor: z.enum(['player', 'npc']),
  target: z.enum(['player', 'npc', 'room', 'none']),
  scope: z.object({                     // same triple as memory/facts/semantic events
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    roomId: z.string().min(1),
    npcId: z.string().min(1).optional(),
  }).strict(),
  provenance: z.object({
    classifier: z.literal('deterministic-local'), // no 'llm' value in v0
    promptId: z.string().min(1).optional(),
    turnIndex: z.number().int().min(0).optional(),
  }).strict(),
  confidence: z.enum(['low', 'medium', 'high']),   // informational only; never gates authority
}).strict()
```

Decisions and rationale (locked by approval):

- **`status: z.literal('candidate')`** (decision 4) — a *single-value literal*, not
  an enum. It documents intent and reserves the field, but there is no
  `'applied'`/`'accepted'` value to reach in v0 (mirrors the "no `llm` classifier"
  / "no `system` source" precedents). A lifecycle enum is added only when a
  consumer exists.
- **`sourceEventId` + `sourceKind`** (decision 5) — the audit link back to the
  validated semantic event. This is the mechanism that enforces "effects derive
  only from validated semantic events": the deriver (future Slice 2) takes
  `DialogueSemanticEvent[]` and stamps their `eventId`/`kind` here. Carrying
  `sourceKind` lets tests and a future safe log assert the mapping without
  dereferencing the original event.
- **`effectId`** — caller-stamped (same convention as `eventId`/`factId`); tests
  inject fixed ids so the domain stays pure and deterministic.
- **`scope` / `actor` / `target` / `confidence` / `provenance`** — carried through
  from the source semantic event unchanged, so a future consumer can
  filter/attribute without re-deriving.
- **No `snippet` / free-text / effect-payload field.** No numeric
  `relationshipDelta`, no `memoryText`, no `questFlag`, no `objectId`. Candidates
  are pure labels. If a future approved consumer needs a payload, it is added then,
  behind its own review.

## 5. Closed effect-kind taxonomy for v0 (decision 6)

Exactly two kinds — the only two that map 1:1 from currently-*emitted* semantic
events:

- `player_question_effect_candidate` ← `player_asked_question`
- `npc_response_effect_candidate` ← `npc_responded`

**Deliberately excluded from the enum in v0** (do not add, even as reserved
values): `relationship_delta_candidate`, `memory_write_candidate`,
`quest_hint_candidate`, `npc_offered_hint`, `npc_refused_help`,
`npc_warned_player`, `player_promised_help`, `player_threatened_npc`,
`player_shared_claim`, `npc_shared_rumor`.

> Rationale: their source semantic-event kinds are reserved-and-unemitted, so an
> effect kind for them would be dead, untestable-from-real-input surface that
> invites premature consumption. The enum stays very small. When a
> structured-provider-output slice makes those semantic events emittable, the
> corresponding effect kinds get added under a fresh plan.

## 6. Which semantic-event kinds may produce effects in v0

Only the two the classifier emits today:

- `player_asked_question` → `player_question_effect_candidate`
- `npc_responded` → `npc_response_effect_candidate`

## 7. Which semantic-event kinds must produce no effects in v0

All seven reserved/unemitted kinds: `player_shared_claim`, `player_promised_help`,
`player_threatened_npc`, `npc_warned_player`, `npc_revealed_rumor`,
`npc_refused_request`, `npc_acknowledged_memory`. If such an event were ever passed
to the future deriver, it maps to **no effect** (fail-closed): the deriver switches
on a closed allowlist of two kinds and ignores everything else.

## 8. v0 includes only inert effect candidates

**Yes.** Every effect is `status: 'candidate'`, consumed by nothing, acted on by
nothing. There is no "apply", accept path, or gameplay hook.

## 9. v0 does not store effects anywhere

**No storage.** No persistence, no SQLite table, no migration, no save-game field,
no React state, no world/memory/relationship store, no `schemaVersion` bump. In
Slice 1 effects are only ever produced by tests. In a later Slice 2 they would be
transient values discarded after logging (same as semantic events today).

## 10. v0 logging of effects

- **Slice 1: no logging** — pure domain; problems are returned as data (like
  `validate.ts` for semantic events, `loadRoomSpec`, `validateRoom`).
- **Slice 2/3 (deferred): structural-safe log only** — count + distinct
  `kind`/`actor`/`target`/`confidence`/`sourceKind` enums + safe ids
  (`worldId`/`sessionId`/`roomId`/`npcId`/`promptId`), reusing the exact pattern in
  `app/deriveAndLogDialogueSemanticEvents.ts`. Never any text.

## 11. Runtime wiring

- **Slice 1 (approved):** pure contracts + validator + co-located tests. No
  derivation, no wiring, no logging, no persistence.
- **Slice 2 (separate approval):** a pure
  `deriveStructuredDialogueEffects(events: DialogueSemanticEvent[], { makeEffectId }): StructuredDialogueEffect[]`
  in the same domain folder. Unwired — called by tests only.
- **Slice 3 (separate approval, only if needed):** wire the deriver at the existing
  dialogue call site (the same seam that already calls
  `deriveAndLogDialogueSemanticEvents`), derive → safe-log → discard. Still
  consumes nothing, mutates nothing.
- **Any gameplay consumption is a distinct future feature** behind its own plan and
  approval, and must route through the existing `WorldCommand` boundary.

## 12. Safety / authority analysis

- **No authoritative state can change.** No `WorldEvent`/`WorldCommand`/reducer/
  `WorldState`; `NPCDialogueService` stays `getWorldState`-only and is not touched.
- **No memory / fact / relationship write path** is introduced; the memory firewall
  (`memory/**` cannot import `world-session`/`dialogue`) is unaffected.
- **Text isolation is structural, not conventional.** The deriver's input type is
  `DialogueSemanticEvent[]` — which itself carries no text — so there is no
  parameter through which raw dialogue could enter the effects layer. This is the
  key safety property.
- **Layer placement respects BOUNDARIES.** New code is pure
  `domain/structuredDialogueEffects/` importing `zod` and the existing
  `domain/dialogueEvents/contracts` types only. Domain-imports-domain is allowed;
  this is already covered by the existing `domain/**` lint block — **no new lint
  rule is required.**
- **Fail closed** at both boundaries: the validator drops anything that doesn't
  parse; the future deriver emits nothing for unknown/reserved kinds.

## 13. Failure / degradation behavior

- A malformed effect object → **dropped** by the validator (returns `null`), never
  thrown as content, never surfaced.
- A reserved/unknown source kind → **no effect** produced.
- Because nothing consumes effects in v0, any failure is inert by construction —
  there is no gameplay, render, memory, or state path to degrade.

## 14. Logging / redaction rules

- Slice 1: no logging (pure domain).
- Slice 2/3 (deferred): only safe structural fields — counts, closed enums, safe
  ids — exactly as `deriveAndLogDialogueSemanticEvents` does.
- **Never logged:** `playerLine`, NPC/player text, provider request/response
  bodies, prompt text, memory text, effect payloads (none exist), or PII.

## 15. Files likely to change (Slice 1 — all new)

- `apps/web/src/domain/structuredDialogueEffects/contracts.ts`
- `apps/web/src/domain/structuredDialogueEffects/validate.ts`
- `apps/web/src/domain/structuredDialogueEffects/contracts.test.ts`
- `apps/web/src/domain/structuredDialogueEffects/validate.test.ts`
- `docs/architecture/implementation-plans/structured-dialogue-effects-v0.md` (this plan)

**No ADR stub in Slice 1** (decision 7).

## 16. Files that must NOT change

`domain/world/**` (events/commands/reducer/state), `domain/world/saveGame.ts` +
`SaveGameSchema`, `world-session/**`, `domain/memory/**`, `domain/facts/**`,
`domain/dialogueEvents/**` (consumed read-only via type import — **not edited**),
`dialogue/NPCDialogueService.ts`, `domain/ports/NPCDialogueProvider.ts`, both
dialogue providers, `app/deriveAndLogDialogueSemanticEvents.ts`, `App.tsx`,
`RoomViewer.tsx`, `persistence/**`, `persistence/migrations/**`, `server/**`,
renderer engine internals, `eslint.config.js`, `package.json`. **No `schemaVersion`
bump anywhere.**

## 17. Tests to add (Slice 1)

- **contracts.test.ts**
  - a valid effect parses;
  - `kind` accepts its two members and rejects any excluded/unknown value;
  - `.strict()` rejects extra keys;
  - `status` accepts only `'candidate'`;
  - `provenance.classifier` accepts only `'deterministic-local'`;
  - `scope` requires the `(worldId, sessionId, roomId)` triple and treats `npcId`
    as optional;
  - `schemaVersion` must be the literal `1`;
  - `sourceEventId` and `sourceKind` are required and non-empty; `sourceKind`
    accepts any `DialogueSemanticEventKind` member.
- **validate.test.ts**
  - a well-formed effect round-trips through the validator;
  - malformed / extra-field / wrong-`status` / unknown-`kind` inputs are **dropped**
    (return `null`), not thrown;
  - tests inject fixed `effectId`s so the domain stays pure/deterministic.

Slice 2/3 tests (deriver allowlist maps the two emittable kinds, ignores the seven
reserved kinds, fails closed on empty/unknown input, inspects no text; app-helper
log-safety plus `noSideEffects`/`logSafety` evaluation extensions) are specified
when those slices are proposed for approval.

## 18. Verification (Slice 1)

```bash
npm.cmd run test -- structuredDialogueEffects
npm.cmd run lint
```

`npm.cmd run build` may remain red due to the known pre-existing, unrelated
TypeScript failures noted in the `dialogue-semantic-events-v0` closeout; report the
status honestly rather than claiming green.

## 19. Implementation slices

- **Slice 1 — APPROVED (docs-only save; not implemented).** Pure `contracts.ts` +
  `validate.ts` + tests. No derivation, wiring, logging, or persistence.
- **Slice 2 — DEFERRED (separate approval).** Pure
  `deriveStructuredDialogueEffects` over `DialogueSemanticEvent[]`, unwired, tested
  in isolation.
- **Slice 3 — DEFERRED (separate approval).** Inert runtime derive → safe-log →
  discard at the existing dialogue seam.
- **Gameplay consumption — SEPARATE FUTURE FEATURE**, must route through
  `WorldCommand`.

Non-negotiables across all slices (restated): a structured dialogue effect is not a
`WorldEvent` or `WorldCommand`; no `WorldState` mutation; no memory writes; no fact
derivation; no relationship update; no quest/inventory/exit changes; no
persistence/schema/migration/save-game changes; no provider/LLM/prompt changes; no
raw player/NPC/provider/prompt/memory text inspection or logging.

## 20. Open questions before implementing Slice 1

None. All prior open questions are resolved by the approval decisions:

1. `status` — keep as `z.literal('candidate')` (decision 4).
2. `sourceKind` — carried alongside `sourceEventId` (decision 5).
3. Effect-kind naming — `player_question_effect_candidate` /
   `npc_response_effect_candidate` with the explicit `_effect_candidate` suffix
   (decision 6).
4. ADR — no ADR stub in Slice 1 (decision 7).

## 21. Minimum Safe Change Check

- **Reused:** the shipped `DialogueSemanticEvent` contracts (`eventId`, `kind`,
  `scope`, `provenance`, `confidence`, and `DialogueSemanticEventKindSchema` for
  `sourceKind`) as the sole input surface; the
  `(worldId, sessionId, roomId, npcId)` scoping discipline from memory/facts; the
  `.strict()` + caller-stamped-id + "returned-as-data, no logging" pure-domain
  pattern of `validate.ts` / `loadRoomSpec` / `validateRoom`; the existing
  `domain/**` lint block (no new rule); the `deriveAndLog…` logging shape (for the
  deferred slices only).
- **Minimum new code:** one pure domain folder (`contracts` + `validate`) plus
  co-located tests. Two effect kinds. No deriver, no wiring, no persistence in
  Slice 1.
- **Safety boundaries unchanged:** no `WorldEvent`/`WorldCommand`/reducer/
  `WorldState`; read-only dialogue service untouched; memory firewall intact; facts
  unchanged; no persistence/migration/schema bump; no provider/prompt change;
  effects derive only from validated semantic events and inspect no text.
- **Tests prove it:** §17–§18.

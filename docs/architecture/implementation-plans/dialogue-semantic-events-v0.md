# Implementation Plan — `feature/dialogue-semantic-events-v0`

> Status: **Slice 1 approved for implementation. Slices 2 and 3 are NOT approved
> — each needs separate maintainer approval.**
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
> Builds on: `npc-dialogue-foundation-v0` ([ADR-0017](../decisions/ADR-0017-npc-dialogue-foundation-v0.md)),
> `npc-dialogue-free-text-input-v0` ([ADR-0069](../decisions/ADR-0069-npc-dialogue-free-text-input-v0.md)),
> `facts-and-fact-visibility-v0`, `npc-memory-dialogue-context-v0`.
>
> **Naming note (important):** this feature is distinct from the already-shipped
> `memory-semantic-events-v0`, which added the **authoritative** `item-discovered`
> `WorldEvent`. This feature adds a **non-authoritative, inert classification
> layer** and introduces **no `WorldEvent`, no `WorldCommand`, no reducer, and no
> schema/version change**.

---

## 0. Approval status and scope gates (read first)

This document describes three slices. Only the first is approved.

- **Slice 1 — pure domain contracts + validator + tests. ✅ APPROVED (the only
  implementation approved now).**
- **Slice 2 — deterministic local classifier (`classify.ts`) + tests. ⛔ NOT
  approved. Requires separate maintainer approval.**
- **Slice 3 — runtime / evaluation wiring at the dialogue call site. ⛔ NOT
  approved. Requires separate maintainer approval.**

Locked invariants for **every** slice of this feature (none may be relaxed
without explicit approval):

- **Semantic events are NOT `WorldEvent`s.** They are inert classifications of a
  dialogue turn, strictly below WorldEvents/facts/memory in authority.
- **No `WorldState` mutation.** No event, command, reducer, or `WorldState` field
  is added or touched. `NPCDialogueService` stays `getWorldState`-only (read-only).
- **No memory writes.** No memory record is created, updated, or promoted.
- **No relationship updates.** No relationship state is created or changed.
- **No structured dialogue effects.** This feature classifies; it does not act.
- **No provider / LLM behavior change.** No new provider call, no prompt change,
  no network I/O, no hidden calls.
- **No persistence / schema / migration.** No SQLite table, no migration, no
  save-game field, no `schemaVersion` bump anywhere.
- **No raw player / NPC / provider text logging.** Never log `playerLine`, NPC or
  player dialogue text, provider request/response bodies, prompt text, or PII.
  Only closed enums, booleans, counts, and safe ids may ever be logged.

Maintainer decisions locked for this plan:

1. New pure domain folder: `apps/web/src/domain/dialogueEvents/`.
2. Slice 1 only is approved: `contracts.ts`, `validate.ts`, and co-located tests —
   **no classifier**, **no runtime wiring**.
3. `eventId` is **caller-stamped**; tests may inject fixed ids.
4. The reserved event kinds stay in the closed enum now, but are **not emitted in
   Slice 1** (Slice 1 emits nothing — there is no classifier yet).
5. **No snippet / free-text field** in v0.
6. **No ADR stub** yet.

---

## 1. Feature goal

Introduce a pure, deterministic **dialogue semantic event** layer that *classifies
what happened* in a dialogue turn (e.g. "the player asked a question") into
closed-enum, structural observations. In v0 these events are **inert**: they
mutate nothing, persist nothing, and are consumed by nothing. They are the typed
substrate that later features (`structured-dialogue-effects-v0`,
`npc-relationship-state-v0`) will consume — but only after this
classification/validation boundary exists and is trusted.

**Slice 1 delivers only the contract and validator** — the vocabulary and its
fail-closed gate. No classification and no wiring are built in Slice 1.

## 2. Problem being solved

Today a dialogue turn produces only free `{ text: string }`
([ADR-0017](../decisions/ADR-0017-npc-dialogue-foundation-v0.md)) plus a closed
`promptId` / bounded `playerLine` on the request side
([ADR-0069](../decisions/ADR-0069-npc-dialogue-free-text-input-v0.md)). There is
no typed, safe representation of *what kind of interaction occurred*. Future
effects/relationship features would otherwise be forced to sniff meaning out of
raw NPC/player text at their own call site — an untrustworthy, unsafe heuristic
that the locked project rule already forbids ("the LLM proposes structured fields
only; the backend assigns authority"). This feature establishes the **safe,
validated, non-authoritative event vocabulary first**, so consumers never touch
raw text and unknown classifications fail closed to "no event."

## 3. Current dialogue flow (as inspected)

1. **Player input** — `NPCDialoguePanel` sends either a closed `promptId`
   (`ask-room` / `ask-help`, per ADR-0066/ADR-0067) *or* a bounded free-text
   `playerLine` (normalized by `normalizePlayerFreeText`: trim, control→space,
   collapse, clamp 240, empty→`null`, ADR-0069). Structural routing (`promptId`)
   is split from player-facing text (`playerLine`).
2. **Dialogue context** — `buildNPCDialogueReplyInput` (`app/`) assembles
   `NPCDialogueInput`; `NPCDialogueService.reply` reads authoritative `WorldState`
   via `getWorldState` and calls the pure `buildDialogueContext`
   (`domain/dialogue`) to project provider-safe context (room, quest, bounded
   room-memory recall).
3. **Provider / fake reply** — `NPCDialogueProvider.reply({ context, promptId,
   playerLine })` returns `{ text }`. `FakeNPCDialogueProvider` is default and
   deterministic; the opt-in real provider (ADR-0065) also returns text-only
   display data.
4. **History update** — conversation history (`NPCDialogueTurn[]`) lives in
   component state; the service receives *previous* turns only (ADR-0069) and
   never appends to world state.
5. **Memory / context interaction** — room-memory recall enters the prompt as
   bounded, hedged, non-authoritative BACKGROUND context, gated by fact
   visibility (`selectVisibleRoomMemories` → `filterVisibleFacts`). Dialogue
   **never** writes memory or truth.

Inspected invariant kept by this plan: `NPCDialogueService` is
`Pick<WorldSession, 'getWorldState'>` — it has **no append path**. Slice 1 adds no
new capability to it (and does not touch it at all).

## 4. Proposed semantic event model (v0 shape) — Slice 1

A pure domain type, `DialogueSemanticEvent`, **structural and closed-enum only —
no free text in v0** (decision 5):

```ts
// domain/dialogueEvents/contracts.ts  (Slice 1)
export const DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION = 1 as const

DialogueSemanticEventSchema = z.object({
  schemaVersion: z.literal(DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION),
  eventId: z.string().min(1),            // caller-stamped opaque id (decision 3); NOT world-authoritative
  kind: DialogueSemanticEventKindSchema, // closed enum, §5
  actor: z.enum(['player', 'npc']),      // who produced the utterance
  target: z.enum(['player', 'npc', 'room', 'none']),
  scope: z.object({                      // safe ids only; mirrors memory/fact scoping
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    roomId: z.string().min(1),
    npcId: z.string().min(1).optional(), // the NPC party to the turn
  }).strict(),
  provenance: z.object({
    classifier: z.literal('deterministic-local'), // v0 has exactly one; no 'llm' value
    promptId: z.string().min(1).optional(),        // closed routing id when present
    turnIndex: z.number().int().min(0).optional(),
  }).strict(),
  confidence: z.enum(['low', 'medium', 'high']),    // informational only; does NOT gate authority
}).strict()
```

Design choices and rationale:

- **`schemaVersion` / `kind` / `actor` / `target`** — closed enums, exhaustively
  checked; `.strict()` rejects unknown keys.
- **`eventId`** — caller-stamped (decision 3), matching memory/fact id
  conventions; tests inject fixed ids so the domain stays pure and deterministic.
- **`scope`** — the same `(worldId, sessionId, roomId[, npcId])` discipline used
  by memory/facts, so a later consumer can filter/attribute safely.
- **`provenance.classifier`** — literal `'deterministic-local'` in v0; there is
  deliberately **no `'llm'` classifier value** yet, mirroring the "no `system`
  source" precedent in `RoomMemorySourceSchema`.
- **`confidence`** — informational only (same status it has in memory/facts
  today); it never confers authority.
- **No `status` lifecycle field** — validity is binary: the validator either
  returns a parsed event or drops it (fail-closed, §12/§14). A candidate/valid
  lifecycle is unnecessary until a consumer exists.
- **No snippet / free-text field (decision 5).** Events are purely structural.
  If a future, separately-approved consumer genuinely needs a quote, a bounded,
  inert, never-logged, never-parsed `snippet` could be added then — **not now.**

## 5. Closed event-kind taxonomy for v0

The enum is closed and complete up front so the type is stable (decision 4). In
Slice 1 **nothing is emitted** — there is no classifier. When a classifier is
built (Slice 2, separate approval) it will emit only the provable subset; the rest
stay reserved for a later structured-output slice.

```ts
DialogueSemanticEventKindSchema = z.enum([
  'player_asked_question',
  'player_shared_claim',
  'player_promised_help',
  'player_threatened_npc',
  'npc_responded',
  'npc_warned_player',
  'npc_revealed_rumor',
  'npc_refused_request',
  'npc_acknowledged_memory',
])
```

**Intended deterministically-emittable subset (Slice 2, NOT built here)** — from
closed signals only:

- `player_asked_question` — when the turn carries a known question `promptId`
  (`ask-room`, `ask-help`).
- `npc_responded` — when the provider returned a reply turn (a structural fact: a
  reply exists), `actor: 'npc'`, no text inspection.

**Reserved but not emitted (require trustworthy structured signal, not
text-sniffing):** `player_shared_claim`, `player_promised_help`,
`player_threatened_npc`, `npc_warned_player`, `npc_revealed_rumor`,
`npc_refused_request`, `npc_acknowledged_memory`. They remain in the enum so the
contract is stable, but no classifier path produces them until a structured
provider-output slice is separately approved.

> Rationale: classifying free NPC/player prose into "threatened" / "revealed
> rumor" deterministically is exactly the untrustworthy heuristic AGENTS.md and
> the shipped `memory-semantic-events-v0` locked rule forbid. We refuse to guess.

## 6. Difference between the layers (authority ladder)

| Concept | Authoritative? | Mutates state? | Persisted? | Where |
| --- | --- | --- | --- | --- |
| **Dialogue semantic event** (this feature) | No | No | No (v0) | `domain/dialogueEvents` — inert classification of a turn |
| **WorldEvent** | **Yes** (sole truth) | Yes (via reducer) | Yes (append-only log) | `domain/world/events.ts` |
| **Memory record** | No (supporting context) | No | Yes (SQLite/sidecar) | `domain/memory` — inert recall text, firewalled |
| **Fact** | No (inert label) | No | No | `domain/facts` — visibility-scoped context label |
| **Relationship state** (future) | TBD (likely projection) | — | — | not built |
| **Structured dialogue effect** (future) | No by itself — must route through a validated `WorldCommand` | Only via existing command path | — | not built; consumes *validated* semantic events |

Key invariant: a semantic event is **strictly below** WorldEvents/facts/memory in
authority. It is an observation *about* a dialogue turn, never a source of truth.
A `player_shared_claim` remains a claim; it can at most — much later, and only if
approved — seed a `player_claim` memory/fact (both already non-authoritative).

## 7. Where semantic events would be derived from (Slice 2 design intent, not built here)

- **Player prompt id** ✅ — closed enum, trustworthy → primary Slice-2 signal.
- **Presence of a `playerLine`** ✅ (structural only) — tells us the player uttered
  free text, but **not what it means**; alone it does not classify a
  claim/promise/threat.
- **NPC response** — only the *structural fact that a reply exists*
  (`npc_responded`); **its text is not inspected.**
- **Fake provider metadata** ❌ — the fake returns text-only; no structured
  metadata to trust.
- **Deterministic local classifier** ✅ — the Slice-2 mechanism (pure function
  over the closed inputs above).
- **LLM output** ❌ **defer** — no text-sniffing; reserved kinds wait for an
  explicitly-approved structured-provider-output slice where the provider emits
  structured fields the backend validates.

None of this is implemented in Slice 1.

## 8. Recommended safest first slice

**Slice 1 = pure domain contracts + validator + tests only** (no classifier, no
wiring). This is the smallest reviewable unit and the only slice approved now.

## 9. Runtime wiring in v0?

**No.** Slice 1 (and the future Slice 2) are pure-domain and unwired. Runtime
derivation at the dialogue call site is **Slice 3, separate approval**. Even when
wired, Slice 3 would only *derive and log counts* — consuming nothing and mutating
nothing.

## 10. Should events be stored anywhere in v0?

**No.** No persistence, no SQLite table, no migration, no save-game field, no
schema-version bump anywhere. If Slice 3 is later approved, derived events are
transient in-memory values (discarded, or held in component state at most), never
parked or persisted.

## 11. Interaction with facts / memory

- In v0: **none.** Semantic events do not derive facts and do not write memory.
  They are a parallel inert layer.
- `player_shared_claim` (once emittable in a future slice) must **never** become
  world truth. The most it could ever do — only if a later slice is approved — is
  feed the existing `player_claim` memory/fact path, which is already
  non-authoritative and firewalled.
- Any future memory/fact bridge must go **through** the existing firewall and the
  `deriveFactFrom*` / memory-service boundaries, never around them.

## 12. Safety / authority analysis

- **No authoritative state can change.** No `WorldEvent`, `WorldCommand`, reducer,
  or `WorldState` field is added or touched. `NPCDialogueService` stays
  `getWorldState`-only (Slice 1 does not touch it at all).
- **No memory / relationship writes.** The memory firewall (`memory/**` cannot
  import `world-session`/`dialogue`) is unaffected; this feature adds no write
  path.
- **Layer placement respects BOUNDARIES.** Contracts + validator are **pure
  `domain/dialogueEvents/`** (import `zod` only; no React/Three/renderer/platform/
  DB). This is already covered by the existing `domain/**` lint block — **no new
  lint rule is required** for Slice 1.
- **Fail closed.** The validator drops anything that does not parse; an invalid
  event never surfaces and never becomes authority. (A classifier, when built in
  Slice 2, will likewise return `[]` on unknown/ambiguous input.)
- **No provider / LLM behavior change**, no hidden provider calls, no new network
  I/O.

## 13. Logging / redaction rules

- Slice 1 is pure domain and **does not log** (problems are returned as data, like
  `loadRoomSpec` / `validateRoom`).
- If Slice 3 is later approved, it may log **only** safe structural fields: `kind`
  (closed enum), `actor`, `target`, `confidence`, a boolean/`count`, and existing
  safe ids (`sessionId`, `roomId`, `npcId`, `promptId`).
- **Never logged:** `playerLine`, NPC or player text, provider request/response
  bodies, any future `snippet`, prompt text, or PII. **No raw player / NPC /
  provider text is ever logged.**

## 14. Failure / degradation behavior

- An event object that fails schema validation → **dropped** by the validator;
  never surfaced or thrown to a caller as content.
- Because nothing consumes events in v0, any failure is inert by construction —
  there is no gameplay, render, memory, or state path to degrade.
- (Slice 2 intent: malformed/ambiguous classifier input → no event emitted; this
  is not built in Slice 1.)

## 15. Files likely to change

- **Slice 1 (approved) — new files only:**
  - `apps/web/src/domain/dialogueEvents/contracts.ts`
  - `apps/web/src/domain/dialogueEvents/validate.ts`
  - `apps/web/src/domain/dialogueEvents/contracts.test.ts`
  - `apps/web/src/domain/dialogueEvents/validate.test.ts`
  - No existing file is edited in Slice 1.
- **Slice 2 (NOT approved) — would add:** `.../classify.ts`, `classify.test.ts`.
- **Slice 3 (NOT approved) — would add:** one call site in the app/dialogue
  composition layer (e.g. after `NPCDialogueService.reply` resolves) + one safe
  log line + a test. No domain change.

## 16. Files that must NOT change

`domain/world/**` (events/commands/reducer/state), `domain/world/saveGame.ts` +
`SaveGameSchema`, `world-session/**`, `domain/memory/**`, `domain/facts/**`,
`dialogue/NPCDialogueService.ts`, `domain/ports/NPCDialogueProvider.ts`, both
dialogue providers, `persistence/**`, `persistence/migrations/**`, `server/**`,
`renderer/**`, `eslint.config.js`, `package.json`. **No `schemaVersion` bump
anywhere.**

## 17. Tests to add (Slice 1)

- **contracts.test.ts** — a valid event parses; each closed enum accepts its
  members and rejects unknown values; `.strict()` rejects extra keys;
  `provenance.classifier` accepts only `'deterministic-local'`; `scope` requires
  the `(worldId, sessionId, roomId)` triple and treats `npcId` as optional;
  `schemaVersion` must be the literal `1`.
- **validate.test.ts** — a well-formed event round-trips through the validator; a
  malformed event is dropped (returns `null` / empty), not thrown; unknown/extra
  fields fail closed; tests inject fixed `eventId`s (decision 3).

(Classifier and log-safety tests belong to Slices 2 and 3 respectively and are
not part of this approved slice.)

## 18. Verification commands (from `apps/web`, once Slice 1 is implemented)

```bash
npm run test -- dialogueEvents      # new contracts/validate tests
npm run lint                        # domain purity / boundary imports intact
npm run build                       # tsc -b exhaustiveness + browser bundle
```

## 19. Implementation slices

- **Slice 1 — ✅ APPROVED.** Pure `contracts.ts` + `validate.ts` + tests. Unwired.
  Emits nothing. The only implementation approved now.
- **Slice 2 — ⛔ SEPARATE APPROVAL.** Pure deterministic `classify.ts` over closed
  local inputs + tests. Still unwired.
- **Slice 3 — ⛔ SEPARATE APPROVAL.** Optional runtime / evaluation wiring at the
  dialogue call site: derive + safe-log counts only; consume nothing; mutate
  nothing.

Non-negotiables across all slices (restated): semantic events are not
`WorldEvent`s; no `WorldState` mutation; no memory writes; no relationship
updates; no structured dialogue effects; no provider/LLM behavior change; no
persistence/schema/migration; no raw player/NPC/provider text logging.

## 20. Open questions before implementing Slice 1

None blocking — decisions 1–6 above resolve the design choices. Slice 2 and Slice
3 remain gated behind their own approvals.

## 21. Minimum Safe Change Check

- **Reused:** the existing closed `promptId` / bounded `playerLine` request fields
  (ADR-0069); the `(worldId, sessionId, roomId, npcId)` scoping discipline from
  memory/facts; the "returned-as-data, no logging" pure-domain pattern of
  `loadRoomSpec` / `validateRoom`; the existing `domain/**` lint block (no new
  rule).
- **Minimum new code:** one new pure domain folder (`contracts` + `validate`) plus
  co-located tests. No existing file is changed in Slice 1.
- **Safety boundaries unchanged:** no `WorldEvent`/reducer/`WorldState`; read-only
  dialogue service untouched; memory firewall intact; facts unchanged; no
  persistence/migration/schema bump; logging rules unchanged (structural fields
  only, never dialogue text).
- **Tests prove it:** §17.

# Implementation Plan — `feature/npc-relationship-state-v0`

> Status: **DESIGN — NOT APPROVED, NOT IMPLEMENTED.**
> This is a review artifact only. No runtime/source file is changed by this
> document. Implementation waits for maintainer approval, slice by slice.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds directly on the closed-out `structured-dialogue-effects-v0`
> ([plan](./structured-dialogue-effects-v0.md)) and `dialogue-semantic-events-v0`
> ([plan](./dialogue-semantic-events-v0.md)).
>
> **No ADR stub proposed for the first slice** (matches the semantic-events /
> structured-effects precedent). An ADR is written only when/if this feature
> touches an architectural boundary — i.e. if a later slice wires exposure into
> dialogue or persistence.

---

## 1. Title and status

**NPC Relationship State v0 — pure, deterministic, non-authoritative,
in-memory-only relationship projection over validated structured dialogue
effects.**

Status: **design only.** Not approved. Not built. Known-red `npm run build`
(pre-existing, unrelated TypeScript failures in other WIP files) is **out of
scope** and this plan does not claim to fix it.

---

## 2. Problem statement

The dialogue chain now produces, per turn:

1. validated `DialogueSemanticEvent[]` (what happened — inert), then
2. validated `StructuredDialogueEffect[]` (what the game *may* later consider —
   inert candidates), which are derived, logged as counts, and **discarded**.

Nothing consumes those candidates. We want NPCs to eventually *remember how they
feel* about the player — trust, fear, respect, familiarity — so dialogue and
future gameplay can react. The danger is obvious and is exactly what the previous
two features were built to prevent: a relationship feature is the natural place
for someone to jump straight from raw dialogue text (or an LLM "the NPC now
distrusts you" claim) to a mutation. That must never happen.

This plan defines the **smallest safe relationship substrate**: a pure domain
model plus a deterministic reducer that consumes **only validated structured
dialogue effects** and produces a bounded, clamped, non-authoritative relationship
projection. In v0 it is in-memory only, not persisted, not in `WorldState`, and
(in the first two slices) not read by anything.

---

## 3. Current architecture recap

Grounded in the code as it exists today:

- **Semantic events** — `domain/dialogueEvents/` (`contracts.ts`, `classify.ts`,
  `validate.ts`). The classifier (`classifyDialogueTurn`) currently emits **only
  two** kinds from real turns: `player_asked_question` (from prompt ids
  `ask-room`/`ask-help`) and `npc_responded` (from `hasNpcReply`). Seven other
  kinds (`player_threatened_npc`, `player_promised_help`, `npc_warned_player`,
  `npc_refused_request`, …) are **reserved-and-unemitted**.
- **Structured effects** — `domain/structuredDialogueEffects/`. The deriver maps
  **only** those two emitted semantic kinds to **two** candidate kinds:
  `player_question_effect_candidate` and `npc_response_effect_candidate`. Both are
  `status: 'candidate'`, closed-enum, **text-free**, and carry
  `scope { worldId, sessionId, roomId, npcId? }`, `actor`, `target`,
  `confidence`, `provenance`. **No valence, no magnitude, no payload.**
- **Runtime seam** — `App.handleNpcDialogueResolved` calls
  `deriveAndLogDialogueSemanticEvents` → `deriveAndLogStructuredDialogueEffects`.
  The effects are logged as counts/enums and **discarded**. No storage, no
  consumer.
- **Authoritative truth** — `WorldState` (`domain/world/worldState.ts`,
  `schemaVersion 1`, `.strict()`: player health/status, inventory, `roomStates`,
  `revision`, `updatedAt`) projected from the append-only `WorldEvent` log via
  `applyEvent`. **There is no relationship field anywhere in `WorldState` today.**
- **Memory** — `memory/**` is the precedent for "supporting context, never truth,
  no path to truth": firewalled from `world-session`/`dialogue`, scoped by
  `(worldId, sessionId, npcId|roomId)`.

**Key structural fact that shapes this whole plan:** the only candidates that
exist today (`player_question_effect_candidate`, `npc_response_effect_candidate`)
are **neutral interaction signals**. Neither carries a sign or a target-of-blame.
So the only relationship dimension a currently-emitted candidate can *honestly*
move is **familiarity** (you have interacted). Trust / fear / respect require
**valenced** candidate kinds (threat, promise, refusal, warning) that do not exist
yet and are deferred. Inventing trust/fear deltas from a neutral question would be
text-sniffing by proxy — precisely the boundary we are protecting.

---

## 4. Proposed v0 scope

**In scope (pure domain first):**

1. A pure, closed-enum **`RelationshipState` data model** for a single NPC's
   directed feeling toward the player, with four axes (trust, fear, respect,
   familiarity), bounded integer ranges, and a neutral baseline.
2. A pure, deterministic **reducer** `applyRelationshipEffects(state, effects,
   ctx)` that validates each effect, rejects/ignores anything out of scope or
   unknown, looks up a **closed integer delta table**, and produces a new clamped
   state. In v0 the delta table moves **familiarity only**; trust/fear/respect
   deltas are `0` for both emitted candidate kinds.
3. Deterministic **per-turn bounding, clamping, and per-`effectId` idempotency**
   inside the reducer.
4. Co-located deterministic tests.

**Runtime integration (second, separate approval):** an inert
`deriveAndReduceRelationship…` app helper wired at the *existing* dialogue seam
that derives (already happening) → reduces into a **transient, in-memory**
relationship map held in an App ref → logs safe counts → **does not persist, does
not mutate `WorldState`, does not render**.

**Dialogue exposure (third, separate approval):** read-only projection of the
in-memory relationship into dialogue context as a bounded, hedged,
non-authoritative signal (the same discipline as room-memory BACKGROUND in
ADR-0065). Deferred; specified only at a high level here.

---

## 5. Explicit non-goals

None of the following are in v0 (most are deferred to named future slices; some
are hard "never for this feature"):

- ❌ **No `WorldState` field, `WorldEvent`, `WorldCommand`, or reducer change.**
  Relationship is not authoritative truth in v0.
- ❌ **No persistence / SQLite table / migration / save-game field /
  `schemaVersion` bump** anywhere. (Deferred to a possible future
  `npc-relationship-persistence-v0`, argued in §14, not built here.)
- ❌ **No memory write** and no change to the memory firewall.
- ❌ **No fact derivation** from relationship changes; `domain/facts/**` untouched.
- ❌ **No new semantic-event or structured-effect kinds.** In particular, no
  valenced kinds (`player_threatened_npc`, etc.) are made emittable. Trust/fear/
  respect stay at baseline in v0 by construction, not by policy.
- ❌ **No provider / LLM / prompt / template / network change.**
- ❌ **No NPC-to-NPC relationships, no NPC→other-entity target.** v0 is NPC→player
  only.
- ❌ **No quest / inventory / exit / objective effect** from relationship values.
- ❌ **No UI surface** (no HUD, no meter, no journal line).
- ❌ **No raw dialogue/provider/prompt/memory text inspection or logging.**
- ❌ Not claiming to fix the known-red `npm run build`.

---

## 6. Data model proposal

Pure `zod` `.strict()` contracts in a new domain folder
`domain/npcRelationship/contracts.ts`. Closed-enum, integer-only, no free text.

```ts
export const NPC_RELATIONSHIP_SCHEMA_VERSION = 1 as const

// Bipolar axes: negative = hostile/contempt, 0 = neutral baseline, positive = warm/esteem.
export const RelationshipBipolarSchema = z.number().int().min(-100).max(100)
// Unipolar axes: 0 = none, 100 = max. Negative has no meaning for these.
export const RelationshipUnipolarSchema = z.number().int().min(0).max(100)

export const RelationshipAxesSchema = z
  .object({
    trust: RelationshipBipolarSchema,       // [-100, +100], baseline 0
    respect: RelationshipBipolarSchema,     // [-100, +100], baseline 0
    fear: RelationshipUnipolarSchema,       // [0, 100],     baseline 0
    familiarity: RelationshipUnipolarSchema,// [0, 100],     baseline 0
  })
  .strict()

// One NPC's directed feeling toward the player, scoped to a session.
export const NpcRelationshipStateSchema = z
  .object({
    schemaVersion: z.literal(NPC_RELATIONSHIP_SCHEMA_VERSION),
    scope: z
      .object({
        worldId: z.string().min(1),
        sessionId: z.string().min(1),
        npcId: z.string().min(1),
      })
      .strict(),
    subject: z.literal('npc'),              // who holds the feeling
    object: z.literal('player'),            // whom the feeling is about (v0: player only)
    axes: RelationshipAxesSchema,
    interactionCount: z.number().int().min(0), // safe provenance counter
  })
  .strict()
```

**Range decisions and rationale:**

- **trust, respect — bipolar `[-100, +100]`, baseline `0`.** These have a genuine
  negative pole (distrust, contempt).
- **familiarity — unipolar `[0, 100]`, baseline `0`, monotonic non-decreasing in
  v0.** You cannot become *less* acquainted; only decay (deferred) would lower it.
- **fear — unipolar `[0, 100]`, baseline `0`.** *Recommendation, and a deliberate
  deviation from the task's suggested `-100..+100` for fear.* Negative fear has no
  coherent meaning ("anti-fear" is really trust/comfort, already covered by
  `trust`). Keeping fear unipolar avoids two axes fighting over the same semantic
  space. Flagged in §15 Open Questions for confirmation.
- **All axes are integers.** No floats ⇒ `NaN`/`Infinity` cannot enter through
  normal reduction, and clamping is exact. The schema still rejects non-integers
  and out-of-range defensively.

**Directionality (v0):** exactly `subject:'npc' → object:'player'`. Both are
literals, so the type system forbids NPC→NPC or NPC→item in v0. Widening `object`
to an entity ref is a future slice, not a field we leave open now.

**Baseline / factory:** a pure `neutralRelationship(scope)` returns all axes at
baseline with `interactionCount: 0`. There is no "unknown NPC" implicit creation
outside the reducer.

---

## 7. Authority model

**Relationship state is a non-authoritative, in-memory projection. It is strictly
below `WorldState` and even below memory in authority.**

| Concept | Authoritative? | Mutates truth? | Persisted (v0)? | Derived from |
| --- | --- | --- | --- | --- |
| `WorldEvent` log / `WorldState` | **Yes** | Yes (reducer) | Yes | validated commands |
| `MemoryRecord` | No (context) | No | Yes (SQLite/sidecar) | firewalled services |
| **`NpcRelationshipState` (this feature)** | **No — projection** | **No** | **No** | *validated structured effects only* |
| `StructuredDialogueEffect` | No (candidate) | No | No | validated semantic events |

Locked authority invariants (none relaxed without explicit maintainer approval):

- Relationship state **never** becomes a `WorldEvent`, `WorldCommand`,
  `WorldState` field, `CanonSeed`, save-game field, SQLite row, or API payload in
  v0. `WorldSession` + event log remain the sole truth.
- Relationship values **never gate** navigation, interactions, encounters, quest
  flags, inventory, or exits in v0.
- The reducer has **no write path to truth**: it imports only `domain/**` (its own
  contracts + the structured-effect *types*) and `zod`. It cannot reach
  `world-session`/`interactions`/`encounters`/`dialogue`. (Whether the reducer
  should live under the memory-style firewall is §15 Open Question 4; the safe
  default is that it does not need `world-session`, so it must not import it.)
- **When do candidates become "authoritative"? They do not — not in this
  feature.** A structured effect remains an inert candidate. Relationship
  *reduction* is a projection, not an application to truth. For a relationship
  value to ever affect *truth* it would need a separate, future, explicitly
  approved consumer that routes through the **existing `WorldCommand` boundary** —
  never a direct mutation. v0 builds no such consumer.

---

## 8. Structured effect consumption rules

The reducer accepts `readonly StructuredDialogueEffect[]` plus a reduction context
`{ worldId, sessionId, npcId }` for the active turn. For each effect, **all** of
these must hold or the effect is **ignored** (fail-closed, never thrown):

1. **Validated shape.** Re-run `validateStructuredDialogueEffect` (defense in
   depth even though the deriver already validated). `null` ⇒ ignore.
2. **`status === 'candidate'`.** Any other status ⇒ ignore (there is no other
   value in v0; this future-proofs against a lifecycle enum landing later).
3. **`provenance.classifier === 'deterministic-local'.`** An `'llm'`/foreign
   classifier ⇒ ignore. (No such value exists in v0; enforced anyway.)
4. **Scope match.** `effect.scope.worldId === ctx.worldId` **and**
   `sessionId === ctx.sessionId`. Cross-world / cross-session ⇒ ignore (no leak).
5. **Valid, matching NPC id.** `effect.scope.npcId` present, non-empty, and
   `=== ctx.npcId`. Missing or mismatched ⇒ ignore. (v0 reduces one NPC per call,
   the NPC of the current dialogue turn.)
6. **Known effect kind in the closed delta table** (§9). Unknown kind ⇒ ignore.
7. **`object` target sanity.** v0 only credits familiarity for player↔npc
   interaction; effects whose `target`/`actor` are not in the
   player/npc interaction pair contribute `0` (still counted as processed for
   idempotency, but move no axis).

Effects are **never** read for their (nonexistent) text; they carry none. The
reducer's input type is `StructuredDialogueEffect[]`, which structurally cannot
carry `playerLine`/NPC reply/provider output — the same text-isolation property
the previous two features rely on.

---

## 9. Relationship reducer algorithm

Pure function, no I/O, no logger, no clock, no randomness, deterministic:

```ts
// domain/npcRelationship/reducer.ts
export interface RelationshipReductionContext {
  worldId: string
  sessionId: string
  npcId: string
}

export interface RelationshipReductionResult {
  state: NpcRelationshipState
  appliedCount: number   // effects that passed all gates
  ignoredCount: number   // effects rejected by §8
  clampedAxes: number    // how many axes hit a bound this turn (safe count)
}

export function applyRelationshipEffects(
  prior: NpcRelationshipState,          // caller supplies neutralRelationship() if none
  effects: readonly StructuredDialogueEffect[],
  ctx: RelationshipReductionContext,
): RelationshipReductionResult
```

**Closed integer delta table (v0):** per **accepted** effect kind, a fixed
per-axis integer delta. Trust/respect/fear are `0` for both kinds today because no
valenced candidate exists (§3).

| Effect kind | trust | respect | fear | familiarity |
| --- | :---: | :---: | :---: | :---: |
| `player_question_effect_candidate` | 0 | 0 | 0 | **+1** |
| `npc_response_effect_candidate` | 0 | 0 | 0 | **+1** |
| *(any other / unknown)* | — | — | — | *ignored* |

Deltas are **integer literals from a frozen table**, so a delta can never be
`NaN`, `Infinity`, fractional, or attacker-controlled. There is no path by which
effect data supplies a magnitude.

**Algorithm (deterministic, order-independent per turn):**

1. Start from `prior.axes` and an empty `seenEffectIds` set and per-axis
   `turnAccumulator = {trust:0, respect:0, fear:0, familiarity:0}`.
2. For each effect, run the §8 gate. If it fails, `ignoredCount++`, continue.
3. **Idempotency / dedupe:** if `effect.effectId ∈ seenEffectIds`, `ignoredCount++`,
   continue. Else add it. (Same candidate never counted twice within a call.)
4. Look up the delta row; add each axis delta into `turnAccumulator`.
5. **Per-effect magnitude guard:** each table delta is asserted to satisfy
   `|delta| ≤ MAX_PER_EFFECT_DELTA` (e.g. 5). This is a static invariant on the
   frozen table, checked once; a table edit that violates it fails a unit test.
6. `appliedCount++`.
7. After the loop, **per-turn clamp** each axis accumulator to
   `[-MAX_PER_TURN_DELTA, +MAX_PER_TURN_DELTA]` (e.g. `MAX_PER_TURN_DELTA = 3`),
   so no single turn can swing an axis more than a small bounded amount even under
   a flood of effects.
8. Add the clamped accumulator to the prior axis value, then **clamp to the axis
   range** (bipolar `[-100,100]`, unipolar `[0,100]`). Count how many axes hit a
   bound → `clampedAxes`.
9. **Monotonic familiarity guard (v0):** familiarity may only increase; if the
   computed familiarity is below prior, keep prior (defensive; the table can't
   produce a decrease today).
10. `interactionCount = prior.interactionCount + appliedCount` (bounded to a safe
    max to avoid unbounded growth over a very long session).
11. Return the new immutable state + safe counts. **Never mutate `prior`.**

**Everything numeric is bounded three times** — per-effect (static table
invariant), per-turn (accumulator clamp), and per-axis (range clamp) — and
deduped per `effectId`. This is the core of "unsafe magnitudes / NaN / Infinity /
oversized deltas / repeated effects" handling from the safety rules.

---

## 10. Runtime integration seams

**Slice 2 (separate approval).** One new app helper, wired at the *existing*
dialogue seam — no new call site:

- `App` already holds transient `StructuredDialogueEffect[]` inside
  `handleNpcDialogueResolved` (currently derived, logged, discarded).
- Add `app/deriveAndReduceRelationship.ts`: given those effects + the current
  `{ worldId, sessionId, npcId }` (from `currentWorldStateRef` +
  `activePlayRef`/dialogue event) + the prior relationship for that NPC, call
  `applyRelationshipEffects`, log safe counts, and store the result in a **new
  React ref** `relationshipsRef` keyed by `npcId` (a plain in-memory `Map`).
- The map is **session-local, ephemeral, and rebuilt from zero** on reload. It is
  **not** in `WorldState`, **not** saved, **not** rendered. Cleared/reset on new
  session or world switch exactly where the other session refs reset.

`App` is the composition root and may already import `domain/**` and app helpers,
so **no new lint rule is required** (same as the structured-effects wiring). The
engine, `RoomViewer`, `NPCDialogueService`, providers, and world-session are
untouched.

**Slice 3 (separate approval, exposure).** A pure read-only projector turns the
in-memory `NpcRelationshipState` for the active NPC into a small, hedged,
closed-vocabulary dialogue-context hint (e.g. bucketed bands like
`familiarity: acquainted`, never raw numbers, never text), fed into the existing
dialogue context the same bounded/hedged way room memory is (ADR-0065). Still
read-only, still non-authoritative, still no mutation. Detailed in its own plan.

---

## 11. Logging / debug rules

Reuse the exact safe-logging discipline of
`deriveAndLogStructuredDialogueEffects` / `deriveAndLogDialogueSemanticEvents`.

**May log (Slice 2):** `appliedCount`, `ignoredCount`, `clampedAxes`,
`interactionCount`, the distinct set of effect `kind`s processed, and the safe
scope ids already logged elsewhere (`worldId`, `sessionId`, `roomId`, `npcId`,
`promptId`). Optionally per-axis **bucket labels** (e.g. `trust:neutral`) — closed
enums, never raw values, and only if genuinely useful.

**Never log:** raw axis integers as free numbers tied to content? (axis *counts*
are safe; the recommendation is to log **bucket enums, not raw values**, to avoid
any inference channel), `playerLine`, NPC/player dialogue text, provider
request/response bodies, prompt text, memory text, NPC/room/object names, generated
JSON, API keys, or PII. The reducer itself (pure domain) logs **nothing** —
problems are returned as data (`ignoredCount`), matching `validate.ts` /
`loadRoomSpec` / `validateRoom`.

---

## 12. Test plan

All deterministic, co-located Vitest, injecting fixed ids/scopes.

**`domain/npcRelationship/contracts.test.ts`**
- valid state parses; `.strict()` rejects extra keys.
- bipolar axes accept `-100/0/100`, reject `-101/101/1.5/NaN/Infinity`.
- unipolar axes accept `0/100`, reject `-1/101/1.5`.
- `subject`/`object` accept only `'npc'`/`'player'`.
- `schemaVersion` must be literal `1`; scope triple required.

**`domain/npcRelationship/reducer.test.ts`**
- `neutralRelationship` returns all-baseline, `interactionCount 0`.
- one `player_question_effect_candidate` ⇒ `familiarity +1`, other axes unchanged.
- `npc_response_effect_candidate` ⇒ `familiarity +1`.
- **trust/fear/respect never move** from either emitted candidate (locks §3).
- **dedupe:** two effects with the same `effectId` count once.
- **per-turn clamp:** a flood of 100 familiarity effects raises familiarity by at
  most `MAX_PER_TURN_DELTA`, not 100.
- **range clamp:** starting near a bound, additional deltas clamp to `100`/`-100`/
  `0`; `clampedAxes` counts correctly.
- **scope rejection:** wrong `worldId`/`sessionId`/`npcId`, missing `npcId` ⇒
  ignored, `ignoredCount` increments, state unchanged.
- **unknown/foreign:** unknown kind, non-`candidate` status, `'llm'` classifier ⇒
  ignored.
- **purity:** `prior` object is not mutated; same inputs ⇒ byte-identical output.
- **static table invariant:** every delta satisfies `|delta| ≤ MAX_PER_EFFECT_DELTA`.
- **monotonic familiarity:** never decreases in v0.

**Slice 2 (when proposed):** `app/deriveAndReduceRelationship` log-safety test
(no text, only counts/enums/safe ids); extend `evaluation/noSideEffects.eval` and
`evaluation/logSafety.eval` to assert relationship reduction performs **no**
`WorldEvent`/`WorldState`/memory-write/network side effect and logs no text; a
redteam fixture proving a hostile dialogue turn cannot move trust/fear (only
familiarity, bounded).

**Verification commands:**
```bash
npm.cmd run test -- npcRelationship
npm.cmd run lint
```
`npm.cmd run build` may remain **red** due to known pre-existing, unrelated
TypeScript failures in other WIP files; report honestly, do **not** claim green,
do **not** broaden scope to fix it.

---

## 13. Implementation slices

- **Slice 1 — pure domain (this plan's core).** `domain/npcRelationship/contracts.ts`,
  `reducer.ts` (with the frozen delta table + constants), `neutral.ts` factory,
  and co-located tests. No wiring, no logging, no persistence. Unwired — called by
  tests only. **Smallest reviewable unit; approve this first.**
- **Slice 2 — inert runtime reduce/log/hold.** `app/deriveAndReduceRelationship.ts`
  + `relationshipsRef` in `App`, wired at the existing dialogue seam. Reduces →
  safe-logs → holds in memory → discards on reload. No `WorldState`/persistence/
  render change. Separate approval.
- **Slice 3 — read-only dialogue exposure.** Bucketed, hedged, non-authoritative
  projection into dialogue context. Separate approval and likely its own ADR.
- **Deferred future features (each its own plan/approval):** valenced effect kinds
  (to make trust/fear/respect actually move), relationship decay over time,
  persistence, NPC→NPC / NPC→entity, any gameplay gating (which must route through
  `WorldCommand`).

---

## 14. Risk analysis

- **Risk: relationship treated as truth.** Mitigation: in-memory projection only;
  no `WorldState` field, no event, no save; reducer has no import path to
  `world-session`. Locked in §7.
- **Risk: raw text controls state.** Mitigation: reducer input is
  `StructuredDialogueEffect[]`, which carries no text; text isolation is
  structural, not conventional (inherited from the two prior features).
- **Risk: LLM output silently mutates a feeling.** Mitigation: effects come only
  from the `deterministic-local` classifier; `'llm'` classifier is rejected; and
  even a hostile/incorrect NPC reply only ever produces a neutral
  `npc_response_effect_candidate` → `+1 familiarity`, bounded.
- **Risk: unbounded / poisoned magnitudes (NaN/Infinity/oversized/flood).**
  Mitigation: integer-only schema, frozen literal delta table, triple bounding
  (per-effect static invariant, per-turn clamp, per-axis clamp), per-`effectId`
  dedupe, bounded `interactionCount`.
- **Risk: cross-room/world/session leak.** Mitigation: strict scope gate (§8.4–5);
  session-local ref reset on session/world change.
- **Risk: overbuilding valence now.** Mitigation: v0 ships the full four-axis
  *shape* but the reducer only moves familiarity, honestly reflecting the two
  neutral candidates that exist. Trust/fear/respect wait for approved valenced
  kinds. This is "minimum safe code, not minimum code."
- **Risk: logging inference channel.** Mitigation: log bucket enums/counts, not
  raw axis values or any text.
- **Risk: scope creep into persistence.** Mitigation: persistence is explicitly a
  separate future slice; v0 is ephemeral by design so a reload is a clean reset.

---

## 15. Open questions

1. **fear polarity** — recommend **unipolar `[0,100]`** (negative fear is
   incoherent and overlaps `trust`), deviating from the task's suggested bipolar
   fear. Confirm?
2. **anger / debt axes** — recommend **defer both**. `anger` overlaps negative
   `trust`/`respect` plus `fear` and needs valenced input that doesn't exist;
   `debt` is really a quest/ledger concept, not a feeling, and belongs to a future
   gameplay feature, not this projection. Confirm deferral?
3. **v0 delta magnitude** — `+1` familiarity per accepted candidate,
   `MAX_PER_TURN_DELTA = 3`, `MAX_PER_EFFECT_DELTA = 5`. Confirm these starting
   constants (they are trivially tunable and covered by tests).
4. **reducer firewall placement** — the reducer needs no `world-session` import, so
   it simply must not add one. Do we also want a dedicated lint block (memory-style)
   forbidding `domain/npcRelationship/**` from importing application layers, or is
   the existing `domain/**` block (which already bans `react`/`three`/`renderer`/
   `platform` and, being domain, imports only domain) sufficient? Recommend: the
   existing `domain/**` block suffices for Slice 1 (no new rule); revisit if a
   later slice moves any relationship code out of `domain/`.
5. **exposure buckets (Slice 3)** — exact band thresholds and vocabulary are
   deferred to the Slice 3 plan; not decided here.

---

## 16. Final recommendation

**Proceed with Slice 1 only, as pure domain, after approval.** It is small,
deterministic, fully testable in isolation, adds no wiring, no persistence, no
`WorldState`/memory/provider surface, and requires no new lint rule. It commits to
the safe shape (four axes, bounded integers, NPC→player, frozen delta table,
triple bounding, dedupe, fail-closed scope gates) while honestly limiting v0
movement to **familiarity**, because the only structured effects that exist today
are neutral. Trust, fear, and respect remain at baseline until a separately
approved feature makes valenced candidates emittable — at which point only the
frozen delta table changes, behind its own review.

Slices 2 (inert reduce/log/hold) and 3 (read-only bucketed dialogue exposure) are
scoped here but each require their own approval. Persistence, decay, NPC↔NPC, and
any gameplay gating are explicitly out of this feature and, if ever built, must
route relationship influence through the existing `WorldCommand` boundary — never
a direct mutation.

---

## 17. Minimum Safe Change Check (per AGENTS.md)

- **Reused:** the closed `StructuredDialogueEffect` contract + its validator as the
  sole input surface; the `(worldId, sessionId, npcId)` scoping discipline from
  memory/facts/effects; the `.strict()` + caller-stamped-id + "problems returned as
  data, no logging" pure-domain pattern of `validate.ts` / `loadRoomSpec`; the
  `deriveAndLog…` safe-logging shape (Slice 2); the existing `domain/**` and
  composition-root lint allowances (no new rule).
- **Minimum new code:** one pure domain folder (`contracts` + `reducer` + `neutral`
  factory) plus co-located tests in Slice 1. Four axes, one frozen two-row delta
  table. No wiring, persistence, provider, or UI in Slice 1.
- **Safety boundaries unchanged:** no `WorldEvent`/`WorldCommand`/reducer/
  `WorldState`; read-only dialogue service untouched; memory firewall intact; facts
  unchanged; no persistence/migration/schema bump; no provider/prompt change;
  relationship derives only from validated structured effects and inspects no text.
- **Tests prove it:** §12.

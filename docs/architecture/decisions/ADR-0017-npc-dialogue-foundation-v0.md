# ADR-0017: NPC Dialogue Foundation v0 — talk intent opens a fake-provider dialogue panel (UI-only, no event)

- **Status:** Accepted — design approved / not yet implemented
- **Date:** 2026-06-22
- **Deciders:** Project owner

> This ADR is an **approved design / implementation brief**. It is binding for the
> implementer (Codex). No code is written yet; the maintainer commits manually.

## Context

The renderer's E/F intent flow now reaches the authoritative world-state truth
layer through three composition paths: a pure planner + headless service for
**object interactions** ([ADR-0014](./ADR-0014-object-interactions-v0.md)), the
two-phase **encounter** layer over the shared `Interaction`
([ADR-0015](./ADR-0015-encounter-system-v0.md)), and **multi-room navigation**
through an exit descriptor ([ADR-0016](./ADR-0016-multi-room-navigation-cache-v0.md)).
The engine emits a neutral `Interactable` with a passive `id`
([interaction.ts](../../../apps/web/src/domain/ports/interaction.ts)); the
composition root maps that `id` to per-feature data on the `LoadedRoom` and
resolves by precedence **exit → encounter → effect**.

An `npc` ([roomSpec.ts](../../../apps/web/src/domain/roomSpec.ts)) is
`{ type:'npc', name, interaction (key 'F'), color }`. Today pressing **F** on an
NPC that has no encounter/effect only opens the static
[`DialoguePanel`](../../../apps/web/src/renderer/ui/DialoguePanel.tsx) showing
`interaction.body` — demo text. **There is no NPC dialogue path**: no provider
seam, no service, no conversation surface.

This slice adds the **first small NPC dialogue foundation**: pressing F on an NPC
that carries a new optional `dialogue` marker opens a dedicated dialogue panel
whose lines come from a **deterministic fake/static provider** behind a domain
**port**, routed through a new **headless dialogue service**. It is built exactly
like every prior seam ([ADR-0010](./ADR-0010-generation-foundation-v0.md)
generation, ADR-0013 world-state, ADR-0014/0015/0016): prove the seam end-to-end
with a pure, deterministic core and an in-memory/fake stand-in for the real
external dependency — here an LLM — so the whole path is testable now with **no
model, no API key, no backend, no database, no memory, and no cost**. When a real
LLM client lands later it implements the *same* `NPCDialogueProvider` port at the
composition root with no downstream change.

## Maintainer-approved decisions (binding for this slice)

This brief was approved with these explicit choices:

1. **Event modeling (Q1) — UI-only, no event.** v0 appends **no** world-session
   event and adds **no** new world-session event type. ADR-0013's closed
   seven-event union stays stable. Conversation history lives in **component/app
   state only**. *(If implementation appears to need an event or a new event type,
   STOP and ask the maintainer first — per the standing constraint.)*
2. **Player-input model (Q2) — canned prompts / Continue.** v0 uses **authored
   canned reply prompts and/or a "Continue" affordance**. **No free-text player
   input** in this slice.
3. **Panel (Q3) — new `NPCDialoguePanel`.** Add a new **presentational**
   `renderer/ui/NPCDialoguePanel.tsx`. It must stay renderer/UI-only and import
   **no** world-session / dialogue-service / encounters / interactions code and no
   Three.js — only neutral view-model types.
4. **Precedence + demo data (Q4).** Composition precedence is
   **exit → encounter → dialogue → effect**. Add **one new friendly demo NPC**
   carrying `dialogue` so the feature is visible. **Do not** attach the demo
   dialogue to `steward-malik` — his existing encounter precedence would hide the
   dialogue path.

## Decision

Insert a thin, two-part dialogue layer parallel to ADR-0014/0015, and wire it at
the composition root over the **existing** F/talk interaction trigger. The
service is **read-only**: it reads `WorldState` for context and **never appends**.

```
 Engine (renderer)             — emits intent only; no dialogue/world-session import
   onRequestOpenInteraction(target: Interactable)        target carries a stable id
        │
        ▼  (composition maps id → NPCDialogueSpec from the LoadedRoom; precedence exit → encounter → dialogue → effect)
   open NPCDialoguePanel: show the NPC's opening line + optional canned reply prompts
        │
        ▼  player presses a canned prompt / Continue (or opens) → playerLine?
 NPCDialogueService.reply({ sessionId, npcId, npcName, dialogue, history, playerLine? })  — APPLICATION (headless)
        │   1. dialogue absent → rejected: missing-dialogue
        │   2. session.getWorldState(sessionId) → not ok → failed: not-found      (READ ONLY — no append)
        │   3. context = buildDialogueContext(state, { npcId, npcName, persona }, history)   (PURE DOMAIN)
        │   4. provider.reply({ context, playerLine }) → { text }                 (DATA ONLY, fake/static)
        ▼
   typed NPCDialogueResult { status:'replied'; turn:{ speaker:'npc'; text } }
        │
        ▼  composition appends the turn(s) to component-state history → NPCDialoguePanel re-renders
```

There is **no pure command-producing planner** here (unlike `planInteraction` /
`planEncounter`): dialogue produces **no `WorldCommand`s** and changes no state,
so — as ADR-0016 reasoned for navigation — a planner would be ceremony with
nothing to decide. The genuinely new, unit-testable domain logic is the pure
**`buildDialogueContext`** transformation; the new application logic is the
**read-only `NPCDialogueService`**; the rest is composition lookups and a
presentational panel.

### Architectural rules (binding)

1. **The renderer only emits intent.** The engine never imports the dialogue
   layer, the provider, or `world-session`, never holds a service, and never
   mutates `WorldState`. **No engine change and no `Interactable` change** is
   required — `target.id` already flows through `onRequestOpenInteraction`.
2. **UI-only, no write path.** v0 appends **no** `WorldEvent` and adds **no** new
   event type (decision 1). The dialogue service injects **only**
   `Pick<WorldSession,'getWorldState'>` and has no append path. The event log and
   the ADR-0013 seven-event union are untouched.
3. **LLM output is DATA, never code.** `NPCDialogueProvider.reply` returns a line
   of **display text** — never executable JS/Three/React or any scene script,
   never `eval`'d ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
   The fake provider is deterministic and performs **no network I/O**.
4. **`buildDialogueContext` is pure and total** — no I/O, no `Date.now`/
   `Math.random`/`crypto`, never mutates inputs, deterministic under fixed input
   (mirrors `planInteraction`/`applyEvent`).
5. **Expected failures are typed results, never thrown** (`missing-dialogue`,
   `not-found`, `provider-unavailable`). Genuine bugs may still throw.
6. **Dialogue config is data only.** `NPCDialogueSpec` is a zod-validated
   descriptor on the shared `Interaction` — never code. RoomSpec stays
   renderer-agnostic; no engine objects enter dialogue contracts or results.
7. **Logs carry ids/counts/codes only** — never dialogue text, `npcName`,
   `persona`, `greeting`, prompt `label`, `playerLine`, item names, status
   strings, or any narrative/user content (ADR-0013 rule 10,
   [ADR-0003](./ADR-0003-logging-abstraction.md)). The provider does not log; the
   service is the only logger and logs no content.
8. **Determinism / no randomness in v0.** The fake provider returns one canned
   line per (persona/npcId, turn index, prompt). If randomness is ever added it
   flows through a seeded `Rng` port at the application layer
   ([ADR-0010](./ADR-0010-generation-foundation-v0.md)), never `Math.random` in
   the domain or provider.
9. **Ports + constructor injection; no new framework** (AGENTS.md rule 13).
10. **The new `NPCDialoguePanel` is presentational only** (decision 3): no
    Three.js, no world-session/dialogue-service/encounters/interactions imports;
    it consumes neutral types and callbacks supplied by the composition root.

## Scope (v0)

**In scope:**

- `domain/dialogue/` (pure): the `NPCDialogueSpec` schema (the RoomSpec field),
  the `NPCDialogueContext` / `NPCDialogueRequest` / `NPCDialogueResponse` /
  `NPCDialogueTurn` types, and the pure `buildDialogueContext` function.
- `domain/ports/NPCDialogueProvider.ts`: the provider port (LLM-shaped seam),
  contract only.
- A `RoomSpec` change: optional `dialogue` on the **shared `Interaction`** object,
  alongside the existing `effect` / `encounter` / `exit`. No per-object-type
  schema change.
- `dialogue/` (application, headless): `FakeNPCDialogueProvider` and the
  read-only `NPCDialogueService` over `Pick<WorldSession,'getWorldState'>`, with
  its own lint block, plus full Vitest coverage.
- Composition wiring (commit 3): a pure `app/dialogue.ts` lookup +
  result-message helper; a new presentational `renderer/ui/NPCDialoguePanel.tsx`;
  `App` constructs the provider + service; `RoomViewer` builds the dialogue
  lookup, applies precedence exit → encounter → dialogue → effect, opens the
  panel, and holds conversation history in component state; one new demo NPC.
- ADR (this file) + architecture-doc / boundary / failure-mode / AGENTS updates
  (commit 4, after implementation).

**Out of scope / non-goals (must NOT be built in this slice):**

- ❌ A new world-session event or event type (decision 1) — **stop and ask** if
  one seems needed.
- ❌ Real / networked LLM provider; LLM-authored dialogue (lines are fake/static
  this slice).
- ❌ Real backend, DB/SQLite/Postgres, HTTP/`apps/api`, `packages/contracts`.
- ❌ Persistent NPC memory; vector memory / summaries / embeddings / retrieval.
- ❌ Speech / audio / TTS.
- ❌ Quest engine; relationship system (a `relationship` **placeholder** in the
  context shape only, unpopulated and unused in v0).
- ❌ Free-text player input (decision 2 — canned prompts / Continue only).
- ❌ Branching dialogue trees / scripted state machines; conversation save/load.
- ❌ `npcStates` ([ADR-0013](./ADR-0013-world-state-event-log-v0.md) deferral).
- ❌ Any new renderer builder/behavior; engine or `Interactable` change; renderer
  importing the dialogue layer or mutating state.
- ❌ GLTF/animation; first-person/free-camera; any camera/player work.

## Data model

Exact zod 4 calls are the implementer's choice; the constraints below are
binding. No world-state import is required by the dialogue contracts (context is
built at runtime from `WorldState`, not declared in the spec), so there is **no
import cycle** — `roomSpec.ts` imports `dialogue` contracts one-way, mirroring how
it imports `effects.ts` / `encounterSpec.ts`.

### `NPCDialogueSpec` (`domain/dialogue/contracts.ts`) — the RoomSpec field

Data only; all strings are display/seed content (NEVER logged):

```
NPCDialogueSpec = {
  persona?: string                       // a key the provider may use to pick lines
  greeting?: string                      // optional authored opening line
  prompts?: { id: non-empty string; label: non-empty string }[]   // optional canned player replies
}
```

- `prompts` are the authored canned player replies surfaced as buttons
  (decision 2). Empty/absent `prompts` means a plain **Continue** affordance.

### Runtime types (`domain/dialogue/contracts.ts`)

```
NPCDialogueTurn = { speaker: 'player' | 'npc'; text: string }

NPCDialogueContext = {
  roomId: string
  npcId: string
  npcName: string
  persona?: string
  player: {
    health: { current: number; max: number }
    status: string[]
    inventoryItemIds: string[]           // ids only — names are display, kept out of context/logs
  }
  history: NPCDialogueTurn[]             // prior turns this session (component-provided)
  relationship?: string                  // PLACEHOLDER for a future relationship system; unused in v0
}

NPCDialogueRequest  = { context: NPCDialogueContext; playerLine?: string }
NPCDialogueResponse = { text: string }   // DATA ONLY — a display line, never code
```

- `inventoryItemIds` carries item **ids**, not names, so neither the context nor
  any accidental log line exposes display item names (rule 7).
- `relationship` is declared so the shape is forward-compatible; v0 leaves it
  `undefined` and no code reads it.

### RoomSpec change (`domain/roomSpec.ts`)

- Add `dialogue: NPCDialogueSpecSchema.optional()` to the **shared `Interaction`**
  object, alongside `effect` / `encounter` / `exit`. Because `Interaction` is
  embedded in `npc` (required) and `scroll`, and optional on the other object
  types, any NPC can carry dialogue with no per-type change.
- An `Interaction` with `dialogue` and none of `effect`/`encounter`/`exit` is
  valid (a pure talker). An `Interaction` with none of the four stays valid
  (presentation-only).
- No `Interactable` view-model change and no engine change (rule 1).

## Provider port (`domain/ports/NPCDialogueProvider.ts`)

Domain-pure contract, mirroring `RoomGenerator`
([RoomGenerator.ts](../../../apps/web/src/domain/ports/RoomGenerator.ts)):

```
interface NPCDialogueProvider {
  reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse>
}
```

Its doc comment carries the trust-boundary rule (rule 3): the returned `text` is
**display DATA, never executable code**, and a v0 implementation performs **no
network I/O**. The real LLM client later implements this same port at the
composition root with no downstream change.

## Pure context builder (`domain/dialogue/buildDialogueContext.ts`)

`buildDialogueContext(state: WorldState, npc: { npcId: string; npcName: string;
persona?: string }, history: NPCDialogueTurn[]) → NPCDialogueContext`. Pure,
total, deterministic, never mutates inputs. Reads `roomId` from
`state.currentRoomId`; copies player `health`/`status` and maps
`state.inventory` to `inventoryItemIds`; passes `history` through; leaves
`relationship` undefined. (Domain → domain import of `WorldState` is allowed.)

## Fake provider (`dialogue/FakeNPCDialogueProvider.ts`)

A deterministic `NPCDialogueProvider` implementation — the dialogue analog of
`FakeRoomGenerator`. It selects a canned line from a small in-module table keyed
by `context.persona` (fallback `context.npcId`) and the turn index
(`context.history.length`), optionally varying on `playerLine` / prompt id. Same
request → byte-identical line. It may use the authored `greeting` for the first
turn. It is pure (no model, key, network, `Date.now`, or `Math.random`) and never
logs.

## Application service (`dialogue/NPCDialogueService.ts`)

Headless application layer, **read-only**, constructor-injected with
`Pick<WorldSession,'getWorldState'>`, an `NPCDialogueProvider`, and a `Logger`
(DI = constructor params). One method:

`reply(input: { sessionId, npcId, npcName, dialogue?, persona?, history,
playerLine? }) → Promise<NPCDialogueResult>`:

1. `dialogue` absent → `{ status: 'rejected', reason: 'missing-dialogue' }`.
2. `session.getWorldState(sessionId)` → not ok → `{ status: 'failed', reason: 'not-found' }`.
   **Read only — the service appends nothing.**
3. `context = buildDialogueContext(state, { npcId, npcName, persona }, history)`.
4. `response = await provider.reply({ context, playerLine })`; if it throws →
   `{ status: 'failed', reason: 'provider-unavailable' }`.
5. → `{ status: 'replied', turn: { speaker: 'npc', text: response.text } }`.

```
NPCDialogueResult =
  | { status: 'replied'; turn: NPCDialogueTurn }                 // turn.speaker = 'npc'
  | { status: 'rejected'; reason: 'missing-dialogue' }
  | { status: 'failed';   reason: 'not-found' | 'provider-unavailable' }
```

`missing-dialogue` is the caller-facing peer of `missing-effect` /
`missing-encounter` / `missing-exit` (the composition lookup miss).

**Logging:** `sessionId`, `npcId`, `roomId`, turn count, and result
`status`/`reason` **codes** only — never dialogue text, `npcName`, `persona`,
`greeting`, prompt `label`, `playerLine`, item names, or status strings (rule 7).

## Composition-root wiring (commit 3)

Keep it small; the renderer stays import-clean and the engine is untouched.

- **Pure helper (`app/dialogue.ts`):** `buildDialogueLookup(room): ReadonlyMap<
  string, { npcId: string; npcName: string; dialogue: NPCDialogueSpec; persona?: string }>`
  from `room.objects` (objects whose `interaction.dialogue` is present **and**
  that have an `id`; skip id-less / dialogue-less; dedup first-wins — mirrors
  `buildEncounterLookup` / `buildExitLookup`). Add `dialogueResultMessage(result)`
  for any transient line (display strings live here, e.g. `provider-unavailable` →
  "They have nothing to say right now."). Keep both pure and unit-testable without
  the DOM.
- **`renderer/ui/NPCDialoguePanel.tsx` (new, presentational — decision 3):**
  renders the conversation `turns` list, the optional canned reply-prompt buttons
  (or a Continue affordance), an optional transient message, and a close. Reuses
  the existing `panel-*` CSS. Props are neutral types + callbacks
  (`turns`, `prompts?`, `onSay(promptId | undefined)`, `onClose`); it imports
  **no** Three.js / world-session / service code (rule 10).
- **`App.tsx` (composition root):** construct **once**
  `const dialogueProvider = new FakeNPCDialogueProvider()` and
  `const npcDialogueService = new NPCDialogueService(worldSession, dialogueProvider, logger)`,
  and pass `npcDialogueService` to `RoomViewer` alongside the existing services.
- **`RoomViewer.tsx` (composition root):**
  - Build the **dialogue lookup** on room load, alongside the existing
    effect/encounter/exit lookups; clear it on teardown like the others.
  - In `onRequestOpenInteraction(target)`, apply **precedence exit → encounter →
    dialogue → effect** (decision 4): after the exit and encounter checks, if
    `target.id` resolves to a dialogue target, lock input, open the
    `NPCDialoguePanel`, seed component-state history, and call
    `npcDialogueService.reply({ … history: [], playerLine: undefined })` to fetch
    the opening line; append the returned `npc` turn to history. A canned prompt /
    Continue calls `reply(...)` again with the chosen `playerLine` and the
    accumulated `history`, appending the player line (if any) and the npc turn.
    Closing resets history and unlocks input. **Otherwise** fall through to
    today's effect path.
  - The engine effect is **unchanged in shape**. No engine import of the dialogue
    layer.
- **Engine (`renderer/engine/Engine.ts`): no change.** `DialoguePanel` / `Hud`:
  no change.
- **Example rooms (data only):** add **one new friendly NPC** with `dialogue`
  (and no encounter) to an example room so the path is visible — e.g. a herald /
  steward's aide in `throne-room`, or a fellow survivor in `ruined-safehouse` —
  with `id`, `name`, `interaction { key:'F', prompt, dialogue { persona, greeting,
  prompts } }`. **Do not** attach dialogue to `steward-malik` (decision 4). The
  new NPC renders through the existing trusted `npc` builder — no new builder, no
  new behavior.

Session lifecycle is unchanged: the persistent example session is reused;
conversation history is **component state**, reset when the panel closes or the
room changes.

## Failure modes (to add to [FAILURE-MODES.md](../FAILURE-MODES.md) after implementation)

New case **15 — NPC dialogue resolution** (peer of cases 12 / 13 / 14):

| Situation | Detection | Handling / result | Logging |
| --- | --- | --- | --- |
| Object/NPC has no `dialogue` | composition dialogue-lookup miss | `rejected: missing-dialogue`; fall through to effect or plain panel | code only |
| Id-less or unknown NPC id | lookup skip / miss | `rejected: missing-dialogue`; never key by an id-less object | code only |
| Missing session on the read | `getWorldState` → not-found | `failed: not-found`; no append (read-only) | code only |
| Provider throws / unavailable | service catch | `failed: provider-unavailable`; calm panel message | code only |
| Repeated talk (no idempotency) | n/a — dialogue is repeatable | a fresh `replied` line each turn; **no event, no flag, no state change** | code, turn count |
| Generated-room NPC | fake generator emits no `dialogue` | `missing-dialogue`; existing effect/plain-panel path | code only |

**Read-only consistency:** the service reads `WorldState` for context and
**appends nothing**, so dialogue can never mutate the authoritative log or diverge
the snapshot. Conversation history is presentation state only. Authored dialogue
text, `npcName`, `persona`, prompt labels, and `playerLine` are display-only and
never reach the logger (rule 7).

## Boundaries (to encode with the shipped code)

- `domain/dialogue/**` and `domain/ports/NPCDialogueProvider.ts` are covered by
  the existing `src/domain/**` lint block (zod only; no React/Three/renderer/UI/
  platform). No domain lint change needed.
- A `src/dialogue/**` `no-restricted-imports` block in
  [`eslint.config.js`](../../../apps/web/eslint.config.js) **mirroring the
  `src/encounters/**` block**: it may import domain contracts/ports,
  `world-session` (read path), and the `Logger` interface, but must **not** import
  `react`, `react-dom`, `three`, `three/*`, or `**/renderer/**`. `no-console`
  stays enforced (the service logs via `Logger`; the provider does not log).
- The engine keeps its existing block forbidding `react`/`react-dom`,
  `**/world-session/**`, `**/interactions/**`, and `**/encounters/**`; **add
  `**/dialogue/**`** to that forbidden list so the renderer can never gain the
  dialogue application/domain-app dependency. The renderer-intent-only rule holds
  **by construction** — the engine emits `target.id` and the composition root owns
  dialogue, exactly as it already owns the effect/encounter/exit lookups.
- `renderer/ui/NPCDialoguePanel.tsx` is covered by the existing `src/renderer/ui/**`
  block (no Three.js, no engine internals); it additionally imports no
  world-session/dialogue-service code (rule 10), enforced by review.
- No engine objects ever enter the dialogue contracts, the context, the request/
  response, or the result ([ADR-0008](./ADR-0008-renderer-portability-strategy.md)).

## Commit plan

Small, independently buildable/testable commits (AGENTS.md rule 12). Codex
implements; the maintainer commits manually. Each commit must leave `npm run
build`, `npm run lint`, and `npm run test` (in `apps/web`) passing. **This ADR is
created first (now), as accepted design / not yet implemented.**

1. **`feat(domain): add npc dialogue contracts and provider port`** —
   `domain/dialogue/contracts.ts` (`NPCDialogueSpec` schema + runtime types),
   `domain/dialogue/buildDialogueContext.ts` (pure), `domain/ports/
   NPCDialogueProvider.ts`, optional `dialogue` on the shared `Interaction` in
   `roomSpec.ts`, and unit tests. Pure domain; no wiring.
2. **`feat(dialogue): add fake provider and npc dialogue service`** —
   `dialogue/FakeNPCDialogueProvider.ts`, `dialogue/NPCDialogueService.ts`, the
   `src/dialogue/**` lint block + `**/dialogue/**` added to the engine block, and
   tests (fake provider determinism + data-only; service over `InMemoryWorldStore`
   + fake `Clock`/`IdGenerator` + fake provider; **read-only/no-append**
   assertion; log-safety). Headless.
3. **`feat(app): wire npc dialogue into the room viewer`** — the pure
   `app/dialogue.ts` lookup + result-message helper; the presentational
   `renderer/ui/NPCDialoguePanel.tsx`; `App` constructs the provider + service and
   passes it down; `RoomViewer` builds the dialogue lookup, applies precedence
   exit → encounter → dialogue → effect, opens the panel, and holds conversation
   history in component state; one new demo NPC with `dialogue`; helper test.
   **No engine change.**
4. **`docs(architecture): record npc-dialogue-foundation-v0`** — flip this ADR to
   *implemented*; add the dialogue layer to [ARCHITECTURE.md](../ARCHITECTURE.md),
   [BOUNDARIES.md](../BOUNDARIES.md) (layer row + lint note),
   [FAILURE-MODES.md](../FAILURE-MODES.md) (case 15), and the
   [AGENTS.md](../../../AGENTS.md) status paragraph + module table.

## Files likely to change

- **New:** `apps/web/src/domain/dialogue/contracts.ts` (+`.test.ts`),
  `apps/web/src/domain/dialogue/buildDialogueContext.ts` (+`.test.ts`),
  `apps/web/src/domain/ports/NPCDialogueProvider.ts`,
  `apps/web/src/dialogue/FakeNPCDialogueProvider.ts` (+`.test.ts`),
  `apps/web/src/dialogue/NPCDialogueService.ts` (+`.test.ts`),
  `apps/web/src/app/dialogue.ts` (+`.test.ts`),
  `apps/web/src/renderer/ui/NPCDialoguePanel.tsx`, this ADR.
- **Edited (core):** `apps/web/src/domain/roomSpec.ts`,
  `apps/web/src/domain/roomSpec.test.ts`, `apps/web/eslint.config.js`.
- **Edited (wiring, commit 3):** `apps/web/src/App.tsx`,
  `apps/web/src/renderer/RoomViewer.tsx`, and one of
  `apps/web/src/domain/examples/throneRoom.ts` /
  `apps/web/src/domain/examples/ruinedRoom.ts` (the new demo NPC); optionally
  `apps/web/src/index.css` only if the turns list needs a style beyond `panel-*`.
- **Docs (commit 4):** `ARCHITECTURE.md`, `BOUNDARIES.md`, `FAILURE-MODES.md`,
  `AGENTS.md`.
- **Not changed:** `apps/web/src/renderer/engine/Engine.ts` (no engine change, no
  new callback), `apps/web/src/domain/ports/interaction.ts`,
  `apps/web/src/domain/world/**` (no new event type),
  `apps/web/src/world-session/**`, `apps/web/src/renderer/ui/DialoguePanel.tsx`.

## Tests (Vitest; co-located; no browser/e2e)

- **Contracts/schema:** `NPCDialogueSpec` parses (optional `persona`/`greeting`/
  `prompts`; non-empty prompt `id`/`label`); an `Interaction` with `dialogue`
  parses and `dialogue` is optional; an `Interaction` carrying `dialogue` +
  `effect` (+`encounter`/`exit`) together parses (precedence is a composition
  concern); the updated example room still `loadRoomSpec` clean.
- **Context builder (`buildDialogueContext.test.ts`):** maps `WorldState` →
  context (room id from `currentRoomId`; player `health`/`status`; inventory →
  `inventoryItemIds`; `history` passthrough; `relationship` undefined); purity /
  no input mutation; determinism.
- **Fake provider (`FakeNPCDialogueProvider.test.ts`):** deterministic (same
  request → identical line); varies by persona/npcId, turn index, and prompt/
  `playerLine`; first turn may use `greeting`; returns plain text only (data-only
  assertion); does not throw on known input.
- **Service (`NPCDialogueService.test.ts`; fake `getWorldState` + fake provider +
  `InMemoryWorldStore`):** `replied` happy path returns the provider line as an
  `npc` turn; **read-only — the event log length is unchanged after N replies**;
  `missing-dialogue` when no spec; `failed: not-found` when the session is
  missing; `failed: provider-unavailable` when the provider throws; **log-safety**
  (assert dialogue text / `npcName` / `persona` / `greeting` / prompt `label` /
  `playerLine` / item names never reach the logger — mirrors the ADR-0013/0014/
  0015 prompt-safety tests).
- **Composition helper (`app/dialogue.test.ts`):** `buildDialogueLookup` maps
  `id → target`, skips id-less / dialogue-less objects, dedup first-wins;
  `dialogueResultMessage` per status.
- **Composition:** do **not** add WebGL/DOM e2e tests (consistent with
  `RoomViewer` having no unit test) — coverage is via the pure helpers + service.

## Docs to update after implementation (commit 4)

- [ARCHITECTURE.md](../ARCHITECTURE.md): a new "NPC Dialogue Foundation v0"
  section + a ✅ plug-in point (provider port, read-only service); module-summary
  rows.
- [BOUNDARIES.md](../BOUNDARIES.md): a `dialogue/` layer row, the new lint block,
  and the engine `**/dialogue/**` forbid note.
- [FAILURE-MODES.md](../FAILURE-MODES.md): case 15 (above) + the summary table row.
- [AGENTS.md](../../../AGENTS.md): the status paragraph and the module-boundary
  table (add the headless `dialogue/` layer).
- Flip this ADR's status to **Accepted — implemented**.

## Consequences

- Pressing F on a dialogue-bearing NPC opens a real conversation surface whose
  lines come from a deterministic fake provider behind a domain port, fully
  unit-tested, with the renderer still emitting only intent and **no change to the
  authoritative event log** (UI-only, no event type).
- The provider **port** is the seam where a real LLM client later slots in (behind
  the same `reply(request)` shape), with the parse/trust discipline already
  modeled — the model returns **text data**, never code
  ([ADR-0001](./ADR-0001-data-only-room-spec-trusted-renderer.md)).
- `buildDialogueContext` makes "what the NPC is told about the world" a
  deterministic, testable domain transformation that a future backend edge can
  reuse, and the context shape carries forward-compatible `relationship`/`persona`
  fields without committing to a relationship system now.
- Keeping v0 read-only avoids touching ADR-0013's closed union; when persistent
  NPC memory / summaries land later, they layer as **recall** over the existing
  log and the read-only context, never as a second write path (ADR-0013 rule 5).

## Alternatives considered

- **Append a `dialogue-turn-recorded` event / a new event type** — rejected
  (decision 1): dialogue is repeatable (no one-shot idempotency), and a new event
  expands ADR-0013's closed union; v0 is UI-only with history in component state.
  Revisit only with maintainer approval.
- **Reuse `room-state-changed.flags` to mark "talked to NPC X"** — rejected: a
  one-shot flag mismodels a repeatable conversation and would still be a state
  write with no v0 purpose.
- **A pure `planDialogue` domain planner** (peer of `planInteraction`/
  `planEncounter`) — rejected (same reasoning as ADR-0016's `planNavigation`):
  dialogue produces no `WorldCommand`s and changes no state, so a planner would be
  ceremony with nothing to decide. The genuinely new pure piece is
  `buildDialogueContext`; the new application piece is the read-only service.
- **Extend `DialoguePanel` with a `messages` prop instead of a new panel** —
  rejected (decision 3): a multi-turn conversation view with reply prompts is
  structurally different from the single-body interact/encounter panel; a
  dedicated presentational `NPCDialoguePanel` keeps SRP and the existing panel
  unchanged.
- **Free-text player input** — deferred (decision 2): authored canned prompts /
  Continue keep v0 small and the fake provider deterministic; a text input and a
  real model are a later slice.
- **Put dialogue before encounter in precedence** — rejected (decision 4):
  `exit → encounter → dialogue → effect` preserves every current behavior (an
  encounter NPC like `steward-malik` still confronts), and the demo dialogue rides
  a new NPC so the path is visible without collision.
- **Detect "talkable" by `type === 'npc'` instead of a `dialogue` field** —
  rejected: not data-driven; an explicit opt-in marker on the shared `Interaction`
  matches the `effect`/`encounter`/`exit` pattern and lets authors set
  persona/greeting/prompts as data.
- **Let the engine open dialogue directly** — rejected: it would make the renderer
  import the dialogue layer and break "renderer emits intent only"
  ([BOUNDARIES.md](../BOUNDARIES.md)). The engine emits `target.id`; the
  composition root owns dialogue.

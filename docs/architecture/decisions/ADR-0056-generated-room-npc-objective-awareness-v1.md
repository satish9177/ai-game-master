# ADR-0056: Generated Room NPC Objective Awareness v1 — closed objective-kind projection for NPC dialogue

- **Status:** Implemented
- **Date:** 2026-06-29
- **Deciders:** Project owner
- **Extends:**
  [ADR-0039](./ADR-0039-npc-dialogue-room-context-v0.md) (NPC Dialogue Room Context —
  the pure-projection → optional-packet pattern this feature follows),
  [ADR-0047](./ADR-0047-generated-story-objective-contract-v0.md) (Generated Story Objective
  Contract — the `QuestDialogueContext.hint` seam this feature nests within),
  [ADR-0051](./ADR-0051-generated-objective-per-room-v0.md) (Generated Objective Per Room —
  the per-room objective that makes this feature meaningful)
- **Related:**
  [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) (NPC Dialogue Foundation — the read-only
  service and `buildDialogueContext` pure projection),
  [ADR-0045](./ADR-0045-demo-quest-reactive-loop-v1.md) (Demo Quest Reactive Loop — wired
  `questStage` into `buildNPCDialogueReplyInput`),
  [ADR-0054](./ADR-0054-generated-room-object-state-v0.md) (Generated Room Object State —
  runs alongside this feature in the same generated room)

> Full pre-code design in the implementation plan
> [`generated-room-npc-objective-awareness-v1`](../implementation-plans/generated-room-npc-objective-awareness-v1.md).

---

## Context

Generated rooms can now carry a per-room local objective (ADR-0051) and can contain NPCs
(ADR-0040). The NPC dialogue path already has two safety-grounding packets:

- `RoomDialogueContext` — closed-enum room features and affordances (ADR-0039).
- `QuestDialogueContext` — objective status, `hint`, and `completionHint` for the authored demo
  quest and, when present, for generated objectives (ADR-0047).

The existing generated `hint` field on `QuestDialogueContext` is sanitized free text produced by
the objective generator. When an NPC has no authored quest-clue match, the provider either
surfaces that sanitized hint verbatim (tier 2) or falls back to generic persona/room/fallback
lines (tiers 3–4). There is no mid-tier, safe, structural nudge that says: "this room has an
active search-type objective — give the player a generic exploration prompt."

The gap: NPCs in generated rooms with an active objective can only surface the sanitized generated
hint or ungrounded fallback lines. They have no structural awareness of what *kind* of objective
is active — inspect, resolve, or reach — so they cannot give a deterministic in-world nudge whose
wording is controlled entirely by hand-written code.

---

## Decision

### Core rule

**Do not add any new dialogue plumbing.** The `QuestDialogueContext` → `NPCDialogueContext.quest`
thread already flows end-to-end: App → RoomViewer → `buildNPCDialogueReplyInput` →
`NPCDialogueService` → `buildDialogueContext` → `FakeNPCDialogueProvider`. This feature nests
one optional closed field within the existing `QuestDialogueContext` struct and adds nothing to
the functions that thread it.

### New closed types

```ts
// In domain/dialogue/contracts.ts

export type NPCObjectiveKind = 'inspect' | 'resolve' | 'reach' | 'general'

export type NPCObjectiveContext = {
  status: 'active' | 'complete'
  kind: NPCObjectiveKind
}
```

`NPCObjectiveKind` is mapped from `ObjectiveCondition` data only:

| `ObjectiveCondition` | `NPCObjectiveKind` |
| --- | --- |
| `room-flag` with flag starting `interaction:` | `inspect` |
| `room-flag` with flag starting `encounter:` | `resolve` |
| `room-visited` | `reach` |
| `has-item`, `has-status`, or any unknown | `general` |

The projection never reads `objectId`, `roomId`, objective text, object names, room names,
generated descriptions, or any free text. It reads only `condition.kind` and, for `room-flag`,
the flag prefix.

### Sibling field on `QuestDialogueContext`

```ts
export type QuestDialogueContext = {
  activeObjectiveId: string | null
  status: 'active' | 'complete'
  hint?: string
  completionHint?: string
  objective?: NPCObjectiveContext   // ← new optional field
}
```

Adding an optional field to an existing type is backward-compatible. `buildDialogueContext`
already spreads `{ ...questContext }`, so the field flows through without any change to that
function, `NPCDialogueService`, `RoomViewer`, or `buildNPCDialogueReplyInput`.

### Pure projection

```ts
// New file: domain/dialogue/buildNPCObjectiveContext.ts

export function buildNPCObjectiveContext(
  activeObjective: QuestObjective | null,
  status: 'active' | 'complete',
): NPCObjectiveContext | undefined
```

- Returns `undefined` when `activeObjective` is `null` (no active objective → no tier).
- Reads only `activeObjective.condition.kind` and the flag prefix for `room-flag` conditions.
- Never reads `activeObjective.id`, `activeObjective.text`, object ids, room ids, names, or
  generated text.
- Pure, side-effect-free, no logger, no I/O, no React.

### App wiring — generated per-room path only

App already computes `questStage` from `quest` (`QuestView`) and `questHints`. The `questHints`
non-null check already gates the generated per-room path exclusively. On that path, App also:

1. Derives `activeObjective` by looking up `quest.activeObjectiveId` in
   `questSpecRef.current?.objectives`.
2. Calls `buildNPCObjectiveContext(activeObjective, quest.status)`.
3. Attaches the result as `questStage.objective` when defined.

The authored/demo `questStage` never has `questHints` non-null, so `objective` is never attached
there. Authored NPC dialogue is byte-identical to today.

### FakeNPCDialogueProvider tier — additive fallback

A new closed tier is added at position 3 in the existing precedence (additive fallback, never
replaces existing tiers):

1. `PROMPT_LINES` (explicit prompt answers) — **unchanged**
2. `questClueLine` (generated `hint`, authored `QUEST_CLUE`, `completionHint`) — **unchanged**
3. **new:** `objectiveAwarenessLine` keyed on `(kind, status, history.length)` — only when
   `context.quest?.objective` is present and no richer tier matched
4. persona / room-grounded / generic fallback — **unchanged**

The fixed table (`OBJECTIVE_LINES`) is hand-written, finite, and closed. Example entries:

```ts
inspect: {
  active: [
    'Search this room carefully before you move on.',
    'The clue you need is probably somewhere nearby.',
    'Take a close look at anything that stands out.',
  ],
  complete: ['You found what you were looking for.', 'Well spotted.', ...],
},
resolve: {
  active: [
    'Be ready — something in here still needs dealing with.',
    'Do not leave this room until the matter is settled.',
    ...
  ],
  complete: ['That is done. Keep moving.', ...],
},
reach: {
  active: ['You may need to explore further before you are finished.', ...],
  complete: ['You have been where you needed to go.', ...],
},
general: {
  active: ['Check anything that looks important before you move on.', ...],
  complete: ['The work here is done.', ...],
},
```

The selected line is deterministic by `(kind, status, history.length % lines.length)`.

### Safety rules (binding)

1. **No raw objective JSON, no generated provider output, no user prompt.**
2. **No object ids, no object names, no room names, no generated descriptions.**
3. **No flag key, no `objectId`, no `roomId`** — `NPCObjectiveKind` is the only
   objective-derived field in the context struct.
4. **No mutation** — `NPCObjectiveContext` is inert read-only display context. It does not
   complete objectives, mutate world state, memory, inventory, or the event log.
5. **No logging** of `NPCObjectiveContext` fields or NPC dialogue text.
6. **Absent context degrades cleanly** — missing `quest`, missing `objective`, or `undefined`
   projection all skip the tier silently with no error, no log, and no behavior change.
7. **Demo/authored path unchanged** — App gate ensures `objective` is never attached in authored
   `questStage`. All existing fake provider tests remain green without modification.

---

## Architectural rules (binding)

1. `buildNPCObjectiveContext` is pure domain: no I/O, no logger, no React, no imports from
   `world-session`, `interactions`, `encounters`, `dialogue` services, or any application layer.
2. The projection reads only `QuestObjective.condition.kind` and the flag string prefix for
   `room-flag` — never `.id`, `.text`, any object id, room id, name, or generated text.
3. `NPCObjectiveContext` is attached as `questStage.objective` only on the generated per-room
   path (where `questHints` is non-null). The authored/demo path leaves `objective` absent.
4. The provider line table is hand-written and closed. It is never populated from generated
   content, the objective generator, provider output, or the quest spec at runtime.
5. `NPCDialogueService`, `buildDialogueContext`, `RoomViewer`, and `buildNPCDialogueReplyInput`
   are not changed — the optional field flows through the existing type spread.
6. No `RoomSpec` schema change, no quest/objective schema change, no save/load change.
7. No new log line for `NPCObjectiveContext` — presence is implicit in the existing safe
   `npc dialogue resolved` log; no new field exposes kind, status, or dialogue text.

---

## Scope (v1)

**In scope:**

- New types `NPCObjectiveKind` and `NPCObjectiveContext` in `domain/dialogue/contracts.ts`.
- Optional `objective?: NPCObjectiveContext` on `QuestDialogueContext`.
- New pure function `buildNPCObjectiveContext` + unit tests in `domain/dialogue/`.
- Fixed `OBJECTIVE_LINES` table and `objectiveAwarenessLine` tier in `FakeNPCDialogueProvider`.
- App attaches `objective` in `questStage` for the generated per-room objective path only.

**Out of scope / non-goals:**

- ❌ Real/LLM NPC dialogue provider or provider-prompt changes.
- ❌ Any `RoomSpec`, `QuestSpec`, `ObjectiveCondition`, or `GeneratedObjectiveSpec` schema change.
- ❌ Any world-state, event-log, memory, inventory, objective-state, or room-state mutation.
- ❌ Objective completion by the NPC.
- ❌ Exact object target identification in NPC lines.
- ❌ NPC acting as a navigation gate or objective gate.
- ❌ New ESLint/lint block (the new domain file is a peer of existing dialogue domain files).
- ❌ Save/load wiring changes.
- ❌ Backend/persistence changes.

---

## Files likely to change

- **Edited (domain):** `apps/web/src/domain/dialogue/contracts.ts` (new types + optional field)
- **New (domain):** `apps/web/src/domain/dialogue/buildNPCObjectiveContext.ts`,
  `apps/web/src/domain/dialogue/buildNPCObjectiveContext.test.ts`
- **Edited (dialogue layer):** `apps/web/src/dialogue/FakeNPCDialogueProvider.ts`
  (new tier + table), `apps/web/src/dialogue/FakeNPCDialogueProvider.test.ts`
- **Edited (composition):** `apps/web/src/App.tsx` (attach `objective` for generated per-room
  path)
- **Docs:** `ARCHITECTURE.md` (planned → implemented on closeout), this ADR.

## Files NOT to change

`domain/roomSpec.ts` · `domain/assembleRoom.ts` · `domain/validateRoom.ts` ·
`domain/repairRoom.ts` · `domain/generatedRoom*.ts` · `domain/quests/**` ·
`domain/dialogue/buildDialogueContext.ts` · `domain/dialogue/buildRoomDialogueContext.ts` ·
`dialogue/NPCDialogueService.ts` · `app/npcDialogueReplyInput.ts` · `renderer/RoomViewer.tsx` ·
`renderer/engine/**` · `generation/**` · `interactions/**` · `encounters/**` · `memory/**` ·
`persistence/**` · `server/**` · `world-session/**` · `eslint.config.js` · `package.json`

---

## Tests (Vitest, co-located, headless)

**`buildNPCObjectiveContext.test.ts`:**
- `room-flag` with `interaction:obj-1` flag → kind `inspect`
- `room-flag` with `encounter:combat-1` flag → kind `resolve`
- `room-flag` with unrecognised prefix → kind `general`
- `room-visited` → kind `reach`
- `has-item` → kind `general`
- null active objective → `undefined`
- `status: 'active'` and `status: 'complete'` both pass through correctly
- Pure: identical inputs → identical output (no randomness)

**`FakeNPCDialogueProvider.test.ts` additions:**
- `objective: { kind: 'inspect', status: 'active' }` → returned line ∈ `OBJECTIVE_LINES.inspect.active`
- `objective: { kind: 'resolve', status: 'complete' }` → returned line ∈ `OBJECTIVE_LINES.resolve.complete`
- `objective: { kind: 'reach', status: 'active' }` → returned line ∈ `OBJECTIVE_LINES.reach.active`
- `objective: { kind: 'general', status: 'active' }` → returned line ∈ `OBJECTIVE_LINES.general.active`
- No returned line contains an object id substring, flag key, raw room id, or generated description
- Deterministic: same `(kind, status, history.length)` → same line
- **Precedence — PROMPT_LINES wins:** when `playerLine` matches a `PROMPT_LINES` entry, the
  objective tier is not reached
- **Precedence — quest.hint wins:** when `quest.hint` is set, `questClueLine` returns it and the
  objective tier is not reached
- **Precedence — objective above persona:** when `quest.objective` is set and no `questClueLine`
  match exists, the objective tier line is returned (not persona or fallback)
- **Regression — absent `quest.objective`:** request with `quest: { status: 'active',
  activeObjectiveId: 'x' }` but no `objective` field → output byte-identical to current provider

**`App.test.tsx` / `App.helpers.test.ts` additions:**
- Generated per-room path with active objective → `questStage.objective` is defined with correct
  `kind` and `status`
- Generated per-room path with quest complete and no active objective → `questStage.objective`
  has `status: 'complete'` (or `undefined` if `buildNPCObjectiveContext` returns `undefined` for
  a null active objective)
- Authored/demo path → `questStage` has no `objective` field
- Generated path with `questHints` null (no objective attached) → `questStage.objective` is
  `undefined`

---

## Failure modes

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| `quest.objective` absent (authored, no generated objective) | field missing | skip tier; existing tiers handle response | none |
| `activeObjective` null (quest not active or fully complete) | null guard in projection | returns `undefined`; no tier | none |
| Unmappable condition kind | defensive branch in `kindFromCondition` | returns `general` (or `undefined`) | none |
| `questHints` null on App (authored/demo path) | guard in App | `objectiveContext` is `undefined`; no field on `questStage` | none |
| `questSpecRef.current` null during lookup | optional chain | `activeObjective` is `null`; projection returns `undefined` | none |
| Provider throws (existing path) | existing `provider-unavailable` catch | unchanged existing warn log | existing safe log only |

---

## Consequences

- Generated-room NPCs can give safe, deterministic in-world nudges keyed on objective kind and
  status, without revealing object ids, names, or generated content.
- The existing authored/demo NPC dialogue is byte-identical to today.
- The existing sanitized generated `hint` still surfaces as tier 2 (higher priority than the new
  tier) when no richer persona/clue match exists.
- The `QuestDialogueContext` type gains one optional field; all existing callers are unaffected.
- `buildDialogueContext`, `NPCDialogueService`, `RoomViewer`, and `buildNPCDialogueReplyInput`
  are untouched.
- No new state, no new persistence, no new schema, no new backend route.

## Alternatives considered

- **Put `NPCObjectiveContext` at the top level of `NPCDialogueContext` instead of nesting it in
  `QuestDialogueContext`** — rejected: requires changes to `buildDialogueContext`,
  `NPCDialogueService`, `buildNPCDialogueReplyInput`, and `RoomViewer`. Nesting in the existing
  `quest` sibling reuses the full existing thread with zero new plumbing.
- **Expose `objective.kind` as a generic hint string, not a closed enum** — rejected: violates
  the safety rule. The hint strings live only in the provider's fixed table, never in the context
  struct.
- **Replace the existing sanitized `hint` with the closed tier for generated rooms** — rejected
  by the maintainer (approved decision: additive fallback). The sanitized hint remains tier 2 and
  the new tier is tier 3.
- **Use a dedicated `generatedObjectiveContext` sibling on `NPCDialogueContext`** — unnecessary:
  the `quest` sibling is the correct semantic home; an objective is part of the quest context.

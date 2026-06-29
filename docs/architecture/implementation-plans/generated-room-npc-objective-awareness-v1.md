# Implementation Plan — `feature/generated-room-npc-objective-awareness-v1`

> Status: **implemented.**
> Maintainer approved the design on 2026-06-29.
> ADR: [ADR-0056](../decisions/ADR-0056-generated-room-npc-objective-awareness-v1.md).
>
> **Depends on (implemented and merged):**
> - `feature/generated-objective-per-room-v0`
>   ([ADR-0051](../decisions/ADR-0051-generated-objective-per-room-v0.md)) — per-room
>   objective attachment, `QuestHintState`, `questHints` state, and the
>   `questStage.hint`/`questStage.completionHint` seam are the substrate this plan
>   extends.
> - `feature/generated-story-objective-contract-v0`
>   ([ADR-0047](../decisions/ADR-0047-generated-story-objective-contract-v0.md)) —
>   `QuestDialogueContext`, `FakeNPCDialogueProvider.questClueLine`, and the full
>   quest → NPC dialogue thread are prerequisites.
> - NPC Dialogue Room Context v0
>   ([ADR-0039](../decisions/ADR-0039-npc-dialogue-room-context-v0.md)) — the
>   closed-packet pattern (`buildRoomDialogueContext` → `RoomDialogueContext`) is
>   the direct precedent this feature follows.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [ADR-0056](../decisions/ADR-0056-generated-room-npc-objective-awareness-v1.md).

---

## Closeout

All implementation slices are complete. No commits were made by the agent.

- **Slice 1 — Domain closed projection:** complete.
- **Slice 2 — Fake provider tier:** complete.
- **Slice 3 — App wiring:** complete.
- **Slice 4 — Docs closeout:** complete.

**Verification recorded during implementation:**
- `cmd /c npm run test -- buildNPCObjectiveContext` — passed.
- `cmd /c npm run test -- FakeNPCDialogueProvider` — passed.
- `cmd /c npm run test -- App` — passed.
- `cmd /c npm run test -- dialogue` — passed.
- `cmd /c npm run build` — passed.

**Final closeout gate:**
- `cmd /c npm run test` — passed during Slice 4 closeout (118 files, 1999 tests).
- `cmd /c npm run lint` — failed during Slice 4 closeout on `App.tsx` line 674
  (`react-hooks/refs`: render reads `questSpecRef.current`).
- `cmd /c npm run build` — passed during Slice 4 closeout.
- `cmd /c git diff --check` — passed during Slice 4 closeout; it reported line-ending warnings
  only.

**Manual smoke status:** pending. The checklist below is recorded for manual QA; it was not
executed during the docs closeout.

---

## Goal

Let generated-room NPCs give safe, deterministic in-world nudge lines when the current room
has an active generated objective and no richer authored hint or quest-clue match is available.

The NPC must not reveal the target object id, object name, room name, or any generated text.
The nudge is derived from the objective's closed *kind* (`inspect` / `resolve` / `reach` /
`general`) and closed *status* (`active` / `complete`) only.

Missing context must degrade silently to the existing dialogue behavior. Demo/authored paths
must remain byte-identical.

---

## Minimum Safe Change Check

**What existing code is reused:**

- `QuestDialogueContext` — gains one optional `objective?` field; all callers are unchanged.
- `buildDialogueContext` — already spreads `{ ...questContext }`, so the new field flows through
  with zero changes to this function.
- `NPCDialogueService` — passes `input.quest` to `buildDialogueContext` unchanged.
- `RoomViewer` — holds `questStageRef.current` and passes it to `buildNPCDialogueReplyInput`
  unchanged.
- `buildNPCDialogueReplyInput` — spreads `quest: questStage` unchanged.
- `App.tsx` `questSpecRef.current` — already holds the active `QuestSpec`; looking up the active
  objective by `quest.activeObjectiveId` is a two-line read.
- `FakeNPCDialogueProvider.questClueLine` — the new `objectiveAwarenessLine` helper is added as a
  peer with the same call-site pattern.

**What new code is actually necessary:**

- `NPCObjectiveKind` and `NPCObjectiveContext` — two type aliases in `contracts.ts`.
- `objective?: NPCObjectiveContext` — one optional field on `QuestDialogueContext`.
- `buildNPCObjectiveContext(activeObjective, status)` — one pure function (~20 lines).
- `OBJECTIVE_LINES` fixed table and `objectiveAwarenessLine(request)` helper in
  `FakeNPCDialogueProvider` — one table (~16 hand-written strings) and one helper (~8 lines).
- App: derive `activeObjective` from `questSpecRef`, call the projection, attach the result as
  `questStage.objective` — ~8 lines in the generated per-room path.

**Safety boundaries unchanged:**

- `WorldState` / event log / reducers — no new event, no schema field, no mutation.
- Domain purity — no React, no logger, no I/O in `buildNPCObjectiveContext`.
- Provider line table — hand-written, finite, closed; no generated text, no ids, no names.
- Authored/demo path — App gate; existing `FakeNPCDialogueProvider` tests unchanged.
- Logging — no new log lines for `NPCObjectiveContext`; existing safe logs unchanged.

**Targeted tests:**

- `buildNPCObjectiveContext.test.ts` — pure domain, no DOM, all condition kinds + null.
- `FakeNPCDialogueProvider.test.ts` additions — tier precedence, no-leak, regression.
- `App.test.tsx` / `App.helpers.test.ts` additions — `objective` present on generated path,
  absent on authored path.

---

## 1. Current repo facts (verified)

- **`domain/dialogue/contracts.ts`** — `QuestDialogueContext` has `activeObjectiveId`,
  `status`, optional `hint`, optional `completionHint`. Adding `objective?: NPCObjectiveContext`
  is the sole type change needed.
- **`domain/dialogue/buildDialogueContext.ts`** — `buildDialogueContext` already does
  `...(questContext !== undefined ? { quest: { ...questContext } } : {})`. The new optional
  field flows through with zero changes to this function.
- **`dialogue/NPCDialogueService.ts`** — calls
  `buildDialogueContext(..., input.roomContext, input.quest)`. No change needed.
- **`app/npcDialogueReplyInput.ts`** — spreads
  `...(questStage !== undefined ? { quest: questStage } : {})`. No change needed.
- **`renderer/RoomViewer.tsx`** — holds `questStageRef.current` typed as
  `QuestDialogueContext | undefined` and passes it to `buildNPCDialogueReplyInput`. The new
  optional field flows through the existing type without cast or change.
- **`App.tsx`** — computes `questStage` as `{ activeObjectiveId, status, ...questHints? }` in
  the JSX around line 673. `questSpecRef.current?.objectives` holds the full
  `QuestObjective[]`; looking up the active objective by id is a two-liner. The `questHints`
  non-null check already gates the generated per-room path exclusively.
- **`dialogue/FakeNPCDialogueProvider.ts`** — `questClueLine(request, key)` is called before
  persona lines. The new `objectiveAwarenessLine(request)` helper is inserted after
  `questClueLine` in the same pattern.
- **`domain/quests/questSpec.ts`** — `QuestObjective.condition: ObjectiveCondition`. For
  generated objectives, `assembleObjective` produces only `room-flag` (with `interaction:` or
  `encounter:` prefix) and `room-visited` conditions. The projection maps these to closed kinds
  and falls back to `general` for anything else.

---

## 2. Implementation slices

### Slice 1 — Domain closed projection

**Status:** Complete.

**Files:**
- `apps/web/src/domain/dialogue/contracts.ts` (edit)
- `apps/web/src/domain/dialogue/buildNPCObjectiveContext.ts` (new)
- `apps/web/src/domain/dialogue/buildNPCObjectiveContext.test.ts` (new)

**`contracts.ts` changes — add the two types and the optional field:**

```ts
export type NPCObjectiveKind = 'inspect' | 'resolve' | 'reach' | 'general'

export type NPCObjectiveContext = {
  status: 'active' | 'complete'
  kind: NPCObjectiveKind
}

// On QuestDialogueContext (existing type):
export type QuestDialogueContext = {
  activeObjectiveId: string | null
  status: 'active' | 'complete'
  hint?: string
  completionHint?: string
  objective?: NPCObjectiveContext  // ← new
}
```

**`buildNPCObjectiveContext.ts` (new file):**

```ts
import type { QuestObjective } from '../quests/questSpec'
import type { NPCObjectiveContext, NPCObjectiveKind } from './contracts'

export function buildNPCObjectiveContext(
  activeObjective: QuestObjective | null,
  status: 'active' | 'complete',
): NPCObjectiveContext | undefined {
  if (activeObjective == null) return undefined
  const kind = kindFromCondition(activeObjective.condition)
  if (kind == null) return undefined
  return { status, kind }
}

function kindFromCondition(
  condition: QuestObjective['condition'],
): NPCObjectiveKind | undefined {
  switch (condition.kind) {
    case 'room-flag':
      if (condition.flag.startsWith('interaction:')) return 'inspect'
      if (condition.flag.startsWith('encounter:')) return 'resolve'
      return 'general'
    case 'room-visited':
      return 'reach'
    case 'has-item':
    case 'has-status':
      return 'general'
  }
}
```

**`buildNPCObjectiveContext.test.ts` test cases:**

- `room-flag` flag `'interaction:obj-1'` → kind `'inspect'`
- `room-flag` flag `'encounter:zombie-1'` → kind `'resolve'`
- `room-flag` flag `'other:key'` → kind `'general'`
- `room-visited` → kind `'reach'`
- `has-item` → kind `'general'`
- `has-status` → kind `'general'`
- `null` active objective → `undefined`
- `status: 'active'` passes through
- `status: 'complete'` passes through
- Pure: same inputs → same output

**Verification:** `npm run test -- buildNPCObjectiveContext`

---

### Slice 2 — Fake provider tier

**Status:** Complete.

**Files:**
- `apps/web/src/dialogue/FakeNPCDialogueProvider.ts` (edit)
- `apps/web/src/dialogue/FakeNPCDialogueProvider.test.ts` (edit)

**Add `OBJECTIVE_LINES` table (hand-written, closed, before the class):**

```ts
import type { NPCObjectiveKind } from '../domain/dialogue/contracts'

const OBJECTIVE_LINES: Readonly<
  Record<NPCObjectiveKind, Readonly<Record<'active' | 'complete', readonly string[]>>>
> = {
  inspect: {
    active: [
      'Search this room carefully before you move on.',
      'The clue you need is probably somewhere nearby.',
      'Take a close look at anything that stands out.',
    ],
    complete: [
      'You found what you were looking for.',
      'Well spotted.',
      'Nothing else here demands your attention.',
    ],
  },
  resolve: {
    active: [
      'Be ready — something in here still needs dealing with.',
      'Do not leave this room until the matter is settled.',
      'Face what is here before you go further.',
    ],
    complete: [
      'That is done. Keep moving.',
      'You handled it. The way forward is clearer now.',
      'Good. That needed doing.',
    ],
  },
  reach: {
    active: [
      'You may need to explore further before you are finished.',
      'The answer may not be in this room.',
      'Keep moving — you will know the place when you reach it.',
    ],
    complete: [
      'You have been where you needed to go.',
      'The path has been walked.',
      'That part is done.',
    ],
  },
  general: {
    active: [
      'Check anything that looks important before you move on.',
      'Do not rush through here.',
      'Take your time. Something here deserves attention.',
    ],
    complete: [
      'The work here is done.',
      'You can move on.',
      'Nothing left to hold you here.',
    ],
  },
}
```

**Add `objectiveAwarenessLine` helper (after `roomGroundedFallback`):**

```ts
function objectiveAwarenessLine(request: NPCDialogueRequest): string | undefined {
  const objective = request.context.quest?.objective
  if (!objective) return undefined
  const tier = OBJECTIVE_LINES[objective.kind]?.[objective.status]
  if (!tier || tier.length === 0) return undefined
  const index = request.context.history.length % tier.length
  return tier[index]
}
```

**Insert call in `reply()` after `questClueLine` check, before `personaLines`:**

```ts
const questClue = questClueLine(request, key)
if (questClue) return { text: questClue }

const objectiveNudge = objectiveAwarenessLine(request)   // ← new tier 3
if (objectiveNudge) return { text: objectiveNudge }

const personaLines = PERSONA_LINES[key]
// ... (unchanged)
```

**Test additions (`FakeNPCDialogueProvider.test.ts`):**

- `objective: { kind: 'inspect', status: 'active' }` → line ∈ `OBJECTIVE_LINES.inspect.active`
- `objective: { kind: 'resolve', status: 'complete' }` → line ∈
  `OBJECTIVE_LINES.resolve.complete`
- `objective: { kind: 'reach', status: 'active' }` → line ∈ `OBJECTIVE_LINES.reach.active`
- `objective: { kind: 'general', status: 'active' }` → line ∈ `OBJECTIVE_LINES.general.active`
- No returned line contains an object id, flag key, room id, raw description, or generated text
  substring
- Deterministic: same `(kind, status, history.length)` → same line across calls
- **Precedence — PROMPT_LINES wins:** `playerLine` matching a `PROMPT_LINES` entry → objective
  tier not reached
- **Precedence — quest.hint wins:** `quest.hint` set → `questClueLine` returns it; objective
  tier not reached
- **Precedence — objective above persona:** `quest.objective` set with no `questClueLine` match
  → objective tier line returned, not persona or fallback
- **Regression:** request with `quest: { status: 'active', activeObjectiveId: 'x' }` but no
  `objective` field → output byte-identical to current provider (no objective tier triggered)

**Verification:** `npm run test -- FakeNPCDialogueProvider`

---

### Slice 3 — App wiring

**Status:** Complete.

**Files:**
- `apps/web/src/App.tsx` (edit)

**Import `buildNPCObjectiveContext` at the top of `App.tsx`.**

**In the JSX/computed section that builds `questStage` (around line 673), add the objective
context computation. The `questHints` non-null check is the gate — `objective` is attached only
when `questHints` is non-null, which is true only on the generated per-room path:**

```ts
// Derive active objective for generated per-room path only
const activeObjective =
  quest && questHints
    ? (questSpecRef.current?.objectives.find((o) => o.id === quest.activeObjectiveId) ?? null)
    : null
const objectiveContext =
  quest && questHints ? buildNPCObjectiveContext(activeObjective, quest.status) : undefined
```

**In `questStage` spread:**

```ts
questStage={quest ? {
  activeObjectiveId: quest.activeObjectiveId,
  status: quest.status,
  ...(questHints ? { hint: questHints.hint, completionHint: questHints.completionHint } : {}),
  ...(objectiveContext !== undefined ? { objective: objectiveContext } : {}),
} : undefined}
```

**Alternatively**, if the JSX grows too wide, extract to a small inline helper in the same file.
Do not create a new abstraction file for this alone.

**Test additions (`App.test.tsx` or `App.helpers.test.ts`):**

- Generated per-room path with active `room-flag`/`interaction:` objective →
  `questStage.objective` is `{ kind: 'inspect', status: 'active' }`
- Generated per-room path with quest `status: 'complete'` → `questStage.objective.status` is
  `'complete'`
- Generated per-room path with no active objective (all done) → `questStage.objective` is
  `undefined`
- Authored/demo path → `questStage` has no `objective` field
- Generated path with `questHints` null (no objective attached yet) → `questStage.objective`
  is `undefined`

**Verification:** `npm run test -- App`

---

### Slice 4 — Docs closeout

**Status:** Complete.

**Files:**
- `docs/architecture/ARCHITECTURE.md` (edit: move planned → implemented note in NPC Dialogue
  section)
- `docs/architecture/decisions/ADR-0056-generated-room-npc-objective-awareness-v1.md` (edit:
  update Status to Implemented)
- This file (edit: update status header to `implemented`)

---

## 3. Precedence reminder (additive fallback — approved)

```
1. PROMPT_LINES (explicit playerLine match)           — unchanged
2. questClueLine: generated hint / QUEST_CLUE / completionHint — unchanged
3. objectiveAwarenessLine (new — closed kind/status)  — new tier 3
4. PERSONA_LINES                                      — unchanged
5. roomGroundedFallback (room focus type)             — unchanged
6. FALLBACK_LINES                                     — unchanged
```

---

## 4. Safety checklist

Before handing off:

- [x] `buildNPCObjectiveContext` reads only `condition.kind` and `condition.flag` prefix — never
  `objectId`, `roomId`, `text`, or any generated content.
- [x] `OBJECTIVE_LINES` is hand-written and finite — no dynamic or generated strings.
- [x] `objectiveAwarenessLine` is inserted after `questClueLine` and before `personaLines` (tier 3).
- [x] `questStage.objective` is attached only when `questHints` is non-null (generated per-room
  path).
- [x] Authored/demo test: `questStage` produced on the demo/authored path has no `objective` field.
- [x] No new logger call carries `NPCObjectiveContext` fields, NPC text, or generated content.
- [x] `buildDialogueContext`, `NPCDialogueService`, `RoomViewer`, and `buildNPCDialogueReplyInput`
  are untouched.
- [x] `eslint.config.js` and `package.json` are untouched.

---

## 5. Manual smoke checklist

1. Prompt-generate a room that yields a per-room objective and an NPC. Talk to the NPC.
   **Expect:** a generic in-world nudge line (e.g. "Search this room carefully before you
   move on.") appears.
2. Complete the generated objective. Talk to the NPC again.
   **Expect:** a completion-flavored line (e.g. "You found what you were looking for.") appears.
3. Prompt-generate a room with an NPC but no objective (budget exceeded or objective dropped).
   Talk to the NPC.
   **Expect:** existing persona/room/fallback lines appear; no objective nudge.
4. Load the authored/demo example world. Talk to the friendly-aide NPC.
   **Expect:** existing authored quest-clue and persona lines appear unchanged.
5. Inspect any NPC line: confirm it contains no object id, flag key, raw room id, or generated
   description substring.
6. Confirm no new `console.*` output appears.

---

## 6. Failure modes

| Situation | Handling |
| --- | --- |
| `quest` absent on context (authored, no quest) | `objectiveAwarenessLine` returns `undefined`; existing tiers handle response |
| `quest.objective` absent (no per-room objective, or pre-attach) | `objectiveAwarenessLine` returns `undefined`; existing tiers handle response |
| `questHints` null on App (authored/demo path) | `objectiveContext` is `undefined`; `questStage` has no `objective` field |
| `activeObjective` null (all objectives resolved) | `buildNPCObjectiveContext` returns `undefined`; no `objective` attached |
| Unmappable `condition.kind` | `kindFromCondition` returns `'general'` (safe catch-all) |
| `questSpecRef.current` null during lookup | Optional chain yields `null`; projection returns `undefined` |
| Provider throws | Unchanged existing `provider-unavailable` path |

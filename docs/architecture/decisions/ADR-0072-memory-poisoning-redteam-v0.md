# ADR-0072: Memory Poisoning Redteam v0

- **Status:** Accepted - Implemented
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md),
  [ADR-0024](./ADR-0024-npc-memory-persistence-v0.md),
  [ADR-0025](./ADR-0025-living-world-room-memory-v0.md),
  [ADR-0065](./ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md),
  [ADR-0069](./ADR-0069-npc-dialogue-free-text-input-v0.md),
  [ADR-0070](./ADR-0070-runtime-room-memory-persistence-v0.md),
  [ADR-0071](./ADR-0071-room-memory-visible-feedback-v0.md).

> Full implementation closeout lives in
> [`memory-poisoning-redteam-v0`](../implementation-plans/memory-poisoning-redteam-v0.md).

---

## Context

Free-text NPC dialogue, room-memory recall, runtime room-memory save/load, and
visible memory feedback are now all shipped. The architecture already requires
memory to remain inert supporting context and dialogue to remain display-only,
but those claims need permanent executable evidence against adversarial text.

This feature adds that evidence as deterministic redteam tests. It changes no
runtime behavior, production source, schemas, providers, persistence, reducers,
renderer code, or UI components.

---

## Decision

Add a dedicated `apps/web/src/redteam/` test suite that pins the memory and
dialogue poisoning boundaries:

- Prompt context keeps hostile player text bounded in recent conversation.
- Room-memory prompt context stays hedged, bounded, single-line, and last.
- Header-mimic memory text cannot create `CURRENT ROOM`, `SYSTEM`, or
  `AUTHORITATIVE` sections.
- Raw ids, flags, gate data, RoomSpec-like JSON, provider-looking text,
  API-looking text, and inventory item ids do not enter prohibited prompt or
  fake-provider output paths.
- Fake dialogue routing safely handles `constructor`, `toString`,
  `hasOwnProperty`, and `__proto__`.
- `NPCDialogueService` remains read-only and dialogue/free text cannot append
  events, write memory, complete quests, mutate flags/items, or unlock gates.
- Runtime `roomMemoryJson` restore drops schema-valid poisoned records by the
  shipped counters (`droppedByScope`, `droppedBySource`, `droppedByText`,
  `droppedByCap`) and degrades whole invalid blobs to an empty memory store.
- Feedback output remains exactly `null`, `MEMORY_CREATED_MESSAGE`, or
  `MEMORY_RECALLED_MESSAGE`, including App-level wiring into
  `<MemoryFeedback>`.
- Captured logs across dialogue, promotion, recall, and sidecar restore do not
  contain hostile text markers, provider bodies, RoomSpec-like JSON, API-looking
  strings, gate markers, or flag markers.

---

## Findings

No confirmed runtime behavior gap was found in the tested attack classes. All
redteam tests pass against the current implementation, so this feature records
the existing boundaries as regression armor rather than introducing fixes.

One scope note: existing architecture and code treat stable diagnostic ids as
permitted structured log context in several services. The log-leak redteam
therefore asserts that hostile/raw content markers placed in player text,
memory text, provider-looking bodies, RoomSpec-like JSON, API-looking strings,
flag markers, and gate markers do not appear in logs; it does not redefine the
existing stable-id logging convention in this test-only ADR.

---

## Files

- `apps/web/src/redteam/fixtures.ts`
- `apps/web/src/redteam/promptContext.redteam.test.ts`
- `apps/web/src/redteam/fakeProvider.redteam.test.ts`
- `apps/web/src/redteam/dialogueAuthority.redteam.test.ts`
- `apps/web/src/redteam/memorySidecar.redteam.test.ts`
- `apps/web/src/redteam/feedback.redteam.test.ts`
- `apps/web/src/redteam/logLeak.redteam.test.ts`

No production source file changed.

---

## Verification

Automated verification performed:

```bash
npm.cmd run test -- redteam promptContext fakeProvider dialogueAuthority memorySidecar feedback logLeak
npm.cmd run test -- memoryFeedback roomMemorySaveState FakeNPCDialogueProvider NPCDialogueService llmDialoguePrompt
npm.cmd run lint
npx.cmd tsc --noEmit -p tsconfig.app.json
```

The first three commands passed. The `tsconfig.app.json` typecheck failed only
on pre-existing non-redteam errors in `assembleRoom.test.ts`,
`ensureGeneratedNpcPresence.ts`, and `OpenAICompatibleNPCDialogueProvider.test.ts`;
no error referenced changed redteam files.

---

## Consequences

Future dialogue, memory, prompt, save/load, feedback, and logging changes now
have a named redteam suite that fails loudly if they weaken these boundaries.
Any future confirmed gap should be handled as its own maintainer-approved fix
feature, not patched opportunistically inside this test suite.

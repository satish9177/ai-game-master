# Deterministic Meaningful Object Interactions v0 — Slice B Plan

- Status: Documentation review; do not implement application code until approved
- Date: 2026-07-15
- Decision: ADR-0093

## Goal and scope

Implement the ADR-0093 closed, deterministic interaction loop for generated documents, containers, and remains. This is Slice B only: document read, container open/search, and remains search. `inspect` remains repeatable and observation-only. No Slice C work begins.

## Minimum Safe Change Check

- Reuse: the committed `domain/objectPurpose` contracts, existing RoomSpec interaction parsing, `InteractionService`, `WorldSession`, the shared world event schema, `applyEvent`, existing inventory schema, existing room flags, save/load replay, and RoomViewer/Engine composition seams.
- New code: one pure runtime evaluator and state-key helper, one narrow composite command/event and projection, a small current-room compatibility adapter, and derived renderer view/intent plumbing.
- Unchanged boundaries: generated content remains data only; purpose-graph validation remains generation-time only; renderer stays trusted but non-authoritative; no browser persistence/backend path is added; save data remains the existing event log plus snapshot.
- Targeted proof: deterministic evaluator, command/event validation, atomic replay, legacy compatibility, import-boundary, interaction service, presentation, and renderer view-data tests.

## Planned files and responsibilities

The exact filenames may be adjusted only to use an already-existing local seam; the following are the intended change areas.

| Area | Planned responsibility |
| --- | --- |
| `apps/web/src/domain/objectPurpose/contracts.ts` or a colocated runtime contract | Export only the frozen types needed by the runtime evaluator. No graph import. |
| `apps/web/src/domain/objectPurpose/meaningfulObjectRuntime.ts` (new) | Pure eligibility, legacy mapping, derived state/actions, canonical flag helper, and closed transition derivation. |
| `apps/web/src/domain/world/events.ts` | Add the single `meaningful-object-applied` command/event schemas to the existing shared union. |
| `apps/web/src/domain/world/applyEvent.ts` | Atomically project one meaningful-object flag and optional inventory item from one event. |
| `apps/web/src/world-session/WorldSession.ts` | Build and validate the closed command against authoritative current state; derive the event state rather than accepting it. |
| `apps/web/src/interactions/InteractionService.ts` and related interaction helper | Resolve an object through the current loaded room, run the pure evaluator, validate the existing `take-item` reward when applicable, and dispatch one command. Preserve old paths for ineligible objects. |
| `apps/web/src/domain/ports/interaction.ts`, `apps/web/src/renderer/Engine.ts`, `apps/web/src/renderer/RoomViewer.tsx`, and app composition | Carry derived choices to the renderer and object/action intents back to the application path. Renderer has no evaluator or transition logic. |
| Focused tests beside the files above | Cover all required state, authority, replay, import, and renderer boundaries. |

`ARCHITECTURE.md`, providers, prompts, room generation, visual vocabulary, cache format, save-envelope schemas, and Slice C files are not changed in this phase. After code is implemented and verified, a separate approved documentation update may add the shipped Slice B architecture wording.

## Exact runtime flow

1. App composition asks the application/domain adapter for the current room’s derived meaningful-object view data. The pure evaluator receives trusted RoomSpec interaction data and current `WorldState` flags, not prose.
2. RoomViewer/Engine displays only those derived choices and returns an `{ objectId, action }` intent. It does not decide whether an object is eligible or whether an action changes state.
3. `InteractionService` re-resolves the object in the currently loaded room. It rejects stale room/object/action input, determines eligibility and current derived state again, and uses a validated existing `take-item` effect only for a permitted `search` reward.
4. The service sends `MeaningfulObjectAppliedCommand` to `WorldSession`. The command has `roomId`, `objectId`, `family`, `action`, and optional validated `InventoryItem`; it has no `nextState` and no prose field.
5. `WorldSession` verifies `roomId === currentRoomId`, the closed family/action table, item/action constraints, and current terminal state. It uses trusted transition derivation to construct one event.
6. The event appends once. `applyEvent` writes the encoded state flag and optional inventory item together. App composition refreshes derived view data from authoritative state.

`inspect` does not use steps 4–6: it renders closed observation feedback and appends no event. An unavailable stale read/search action returns deterministic already-complete feedback and appends no event.

## State transitions and atomicity

The only state-changing pairs are document/read -> read, container/open -> open, container/search -> looted, and remains/search -> looted. A container’s derived state precedence is looted, then open, then closed. A document is read or unread; remains are looted or unsearched.

The event schema is exactly the ADR-0093 `MeaningfulObjectAppliedEvent`: its payload records `roomId`, `objectId`, `family`, `action`, trusted derived `state`, and optional `InventoryItem`. The command schema is exactly the ADR-0093 `MeaningfulObjectAppliedCommand`; no caller may supply or override a state.

The event is not composed from the existing separate `item-added`, `item-discovered`, and `room-state-changed` commands because sequential application can be partial. A failed validation occurs before append. A successful replay applies both flag and optional item from the same event; it cannot commit just one of them.

## Canonical state keys and compatibility

All code uses:

```ts
`meaningful-object:${encodeURIComponent(objectId)}:${state}`
```

where `state` is exactly `read`, `open`, or `looted`. Raw IDs are never interpolated directly. Tests include `:`, `/`, `%`, and Unicode IDs.

Legacy state mapping is intentionally narrow:

| Legacy condition | New state | Visible-action result |
| --- | --- | --- |
| Generic `interaction:<id>` inspect flag | none | New Read/Search remains available where otherwise eligible. |
| Validated one-shot `take-item` on container/remains | looted | Search reward is withheld to prevent re-grant. |
| Existing explicit one-shot read contract, if present | read | Read is treated complete. |
| All other legacy flags | none | Existing behavior remains unchanged. |

The current effect union has no explicit one-shot read contract, so this plan does not create a document mapping merely from generic inspect behavior.

## Import and authority boundaries

Production runtime may import frozen `domain/objectPurpose` contracts and the approved pure runtime evaluator only. It must never import the purpose graph, graph validator, validator issue codes, or diagnostic APIs. The existing dry-at-runtime scan will be refined or split to test actual module specifiers: it keeps disallowing direct runtime imports of graph/validator modules while permitting the minimum contracts/evaluator import path.

Only the application/domain/WorldSession path evaluates eligibility, derives availability/transitions, validates an item, and changes state. RoomViewer and Engine receive derived view data, send intent, and refresh presentation after authority changes. They do not calculate rewards or write world state.

## Persistence and room-return plan

No `WorldState` fields or save-envelope shapes change. Existing room-state flags and inventory are projected from the additive shared event. Existing snapshot reconstruction, event-log replay, browser save parking, and generated room-cache restoration consequently retain object state and any granted item on save/load and return visits.

Audit result before implementation: `domain/world/events.ts` is the sole authoritative event/command union. `WorldSession`, in-memory persistence, SQLite persistence, save/load validation, and server routes use that shared schema/type; no second server union or persistence validator needs updating. If this premise changes during implementation, stop and report rather than creating an incompatible log path.

## Test plan

- Pure evaluator table: all eligible type/family combinations, current-state action availability, unsupported/decorative/authored preservation, and closed feedback.
- State helper: canonical keys are collision-safe for `:`, `/`, `%`, and Unicode object IDs; state precedence is deterministic.
- Legacy matrix: generic inspect does not imply terminal state; equivalent one-shot container/remains reward prevents re-grant; no invented document mapping.
- Command/event: no caller-supplied/overridden next state; invalid pair fails; item on read/open fails; a search item differing from the validated existing reward fails; stale/terminal transitions append nothing.
- Atomic replay: one event reconstructs both the state flag and inventory item; invalid input appends neither.
- Service/current-room path: wrong room, unknown object, ineligible object, and invalid item are rejected before append; existing interactions remain on their old path.
- Import boundary: production runtime imports only contracts/evaluator and never graph, validator, issue, or diagnostic modules.
- Renderer: it receives already-derived action choices and only emits intent; it contains no state-transition, eligibility, or reward logic.
- Save/load and return visit: read/open/looted flags and a search reward survive existing save/replay/cache workflows.

## Manual acceptance plan

In an eligible generated room, inspect each family repeatedly; read a document once; open then search a container; search remains; and confirm repeated state actions produce deterministic already-complete feedback without duplicate items. Leave and return, then save/load, and confirm the same derived choices remain. Check a decorative/authored/exit/encounter/dialogue object to confirm its old interaction remains intact. Confirm visible actions never include take or use and that no generated prose decides the result.

## Verification after implementation

From `apps/web`:

```powershell
npm run test -- objectPurpose
npm run test -- interactions
npm run test
npm run lint
npm run build
node node_modules/typescript/bin/tsc -b
git diff --check
```

Use the smallest relevant focused test names that exist after implementation; record exact test counts and exit codes. Do not commit or push without a later explicit request.

## Deferred

This plan does not implement reveal-clue runtime, objective progression, journal projection, Slice C events, machines, barricades, exit unlocking, provider/prompt changes, generated dependency-pattern attachment, free-text actions, clue clusters, hypotheses, item consumption, crafting, combat, physics, or dialogue unlocks.

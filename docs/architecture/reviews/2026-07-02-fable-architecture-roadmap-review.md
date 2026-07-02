# Review — Architecture, Bug-Risk, and Roadmap (Fable, 2026-07-02)

> **Status: advisory review record — NOT an ADR.** This document records the
> findings of a read-only review so they are not lost in chat. It makes no
> architecture decision by itself. Any implementation arising from it still
> goes through the normal design → implementation-plan → maintainer approval →
> ADR flow (`AGENTS.md`, `CLAUDE.md`).
>
> Reviewer: Claude (Fable 5), read-only session. Date: 2026-07-02.
> Companion: [memory layer plan assessment](./2026-07-02-memory-layer-plan-assessment.md)
> (same session, same advisory status).

---

## 1. Review scope

- Read-only review: **no runtime/source/test files were changed.**
- Covered: `AGENTS.md`, `docs/architecture/ARCHITECTURE.md`, `BOUNDARIES.md`,
  ADR-0060 through ADR-0066, the implementation plans for
  `real-npc-dialogue-room-memory-awareness-v0`, `npc-talk-affordance-polish-v0`,
  and `generated-npc-dialogue-seed-variety-v0`, the external future-reference
  and memory-design documents, and the relevant source across
  `app/`, `domain/`, `dialogue/`, `generation/`, `memory/`, `renderer/`.
- Verification at review time: full suite green — **141 test files /
  2,529 tests passed** (`npm run test`, exit 0).

## 2. Overall health

**Strong.** The load-bearing boundaries are real in code, not just in docs:

- Data-only `RoomSpec` → trusted hand-written renderer boundary
  (`assembleRoom` pipeline; no executable content from generation).
- Append-only event log + `WorldSession`/DB current state as the only truth;
  UI panels are read-only projections.
- Memory firewall: `memory/**` has no `world-session` import (lint-enforced);
  `domain/memory` exports no command/event producers; recall is bounded,
  deterministic, and hedged in prompts.
- Fake-first / opt-in BYOK provider pattern, identical adapter shape across
  room/objective/gate/dialogue providers (injected transport, hard timeout,
  no retry, fixed safe error codes).

## 3. Demo blockers found

1. **Generated NPCs can exist without `interaction.dialogue`**, so pressing F
   opens the plain `DialoguePanel` ("greeting/body + Close only", as observed
   in manual smoke). Both the fake generator (emits its own NPC ~75% of the
   time with no `dialogue` spec) and the real-provider room prompt (never
   mentions the `dialogue` field) produce dialogue-less NPCs, and any existing
   NPC suppresses `ensureGeneratedNpcPresence` insertion — so most generated
   rooms have an untalkable NPC.
2. **Dialogue provider calls bypass the usage guardrails**, and `RoomViewer`
   auto-calls the provider on every dialogue open (one uncounted real-provider
   call per F-press, plus a "double greeting" UX oddity).
3. **Room memory is in-memory only and does not survive save/load** — the
   shipped memory-aware dialogue (ADR-0065) silently loses all recall after
   Continue/Load.

## 4. Current bug/risk list

| # | Finding | Severity | Suggested home |
|---|---|---|---|
| 1 | Generated NPCs without dialogue specs open the plain body panel (`FakeRoomGenerator.ts` NPC emission; `llmRoomPrompt.ts` has no dialogue guidance; `ensureGeneratedNpcPresence` any-NPC guard; `buildDialogueLookup` requires `interaction.dialogue`) | **HIGH** | `feature/generated-npc-dialogue-spec-v0` |
| 2 | Dialogue LLM calls outside the usage guard; auto reply-on-open in `RoomViewer` | **HIGH** (real-provider path) | `feature/dialogue-usage-guardrails-v0` |
| 3 | `providerGateStatus`/`providerGate` dropped from `ActivePlay` on navigation (`App.tsx` `handleNavigate` `nextPlay`) — a rejected (fail-open) provider gate silently becomes an enforced deterministic gate after leave-and-return, contradicting ADR-0064's fail-open rule | MEDIUM | small bugfix/rider (2-line carry + App-level regression test) |
| 4 | `playerLine` carries the prompt **id** (`ask-room`) into the real dialogue prompt, duplicating the label already in history; fake needs the id, real needs text | MEDIUM | fold into `feature/npc-dialogue-free-text-input-v0` |
| 5 | Fake provider has no reply lines for the six `generated-*` personas or `ask-room`/`ask-help`, so the ADR-0066 varied questions get non-sequitur generic answers on the default zero-key path | MEDIUM | fold into `feature/generated-npc-dialogue-spec-v0` or a small follow-up |
| 6 | Room memory lost on save/load (`InMemoryRoomMemoryStore`; nothing parked in the save slot) | MEDIUM | `feature/runtime-room-memory-persistence-v0` |
| 7 | Persona subtitle map in `NPCDialoguePanel` is inert in gameplay (`RoomViewer` never passes `persona`) — documented in the talk-polish plan; ADR-0066's Consequences wording overstates player visibility | LOW | documented limitation; optional one-prop wiring slice |
| 8 | Prompt double-submit lock (`inFlightRef`) only engages when the usage guard is enabled (fake path can double-submit; `requestVersion` keeps the outcome correct) | LOW | opportunistic fix |
| 9 | Trivia: mojibake status marker in `ARCHITECTURE.md` (Theme Vocabulary entry); `assembleRoom` reports `skippedObjectCount` from a pre-2.13 stage room (same array reference today, cosmetic) | LOW/trivia | opportunistic fix |

Missing tests noted: the product invariant "a generated room with an NPC has a
*talkable* NPC"; provider-gate persistence across navigate-away-and-return;
dialogue-call budget behavior (after fix 2); direct tests for `App.helpers.ts`
and `buildPromptGeneratedRoomSource.ts`.

## 5. Roadmap correction — recommended next order

1. `feature/generated-npc-dialogue-spec-v0`
2. `feature/dialogue-usage-guardrails-v0`
3. `feature/npc-dialogue-free-text-input-v0`
4. `feature/runtime-room-memory-persistence-v0`
5. `feature/room-memory-visible-feedback-v0`
6. `feature/generated-per-room-objective-save-load-v0`
7. `feature/memory-poisoning-redteam-v0`
8. `feature/npc-behavior-state-v0`
9. `feature/npc-idle-animation-v0`
10. `feature/npc-local-wander-v0`

Rationale highlights:

- Free-text input should **not** be literally next: typed input at NPCs most
  players cannot talk to (finding 1), with uncapped spend (finding 2), lands
  badly. Both prerequisites are small slices.
- `runtime-room-memory-persistence-v0` is promoted from the long-term list:
  it is the missing half of two already-shipped features (memory-aware
  dialogue + save/load) and fits the existing ADR-0059/0060 sidecar-parking
  pattern (re-validated on load, never authoritative).
- The previously planned layout/placement/composition items are substantially
  shipped (ADR-0031/0032/0033/0034/0044); remaining nits can be one cleanup
  slice later rather than four features.

## 6. Features to defer from v1

- `npc-patrol-route-v0`
- `npc-player-awareness-v0`
- `hostile-npc-chase-lite-v0`
- `npc-day-night-routine-v0`
- `world-clock-day-night-v0`
- `structured-dialogue-effects-v0` — defer until the poisoning/red-team suite
  exists and a dedicated reducer/allowlist/caps ADR is written. It will be the
  first path where LLM output influences truth; today's guarantee is
  structural (the dialogue service has no write path) and must be superseded
  narrowly and deliberately, never by free-text sniffing.

## 7. Missing roadmap items

- `generated-npc-dialogue-spec-v0` (finding 1)
- `dialogue-usage-guardrails-v0` (finding 2)
- Provider-gate carry bugfix (finding 3)
- Open-source-launch polish slice: README demo path, screenshots/GIF,
  `.env.example`, zero-key quickstart
- Long-session evaluation gates (e.g. "1000 events → prompt still small",
  "restart → NPC still hostile"), per the future-reference document §19

## 8. Safety review summary

- **Provider/LLM boundaries: sound.** All provider output converges on a
  validating boundary (`assembleRoom`, zod objective/gate schemas +
  satisfiability check, display-only dialogue text). No live path found where
  generated/provider content bypasses validation, including save/load restore
  paths (parked blobs are re-validated).
- **Memory boundaries: sound.** Firewalled writes, double scope filtering,
  bounded deterministic recall, hedged non-authoritative prompt sections.
- **WorldState mutation boundaries: sound.** `NPCDialogueService` holds only
  `getWorldState`; no append path exists under either provider. A
  dialogue-less NPC's F-press falls into the interaction path, which rejects
  with `missing-effect` and touches no state.
- **No live path found where dialogue mutates WorldState.**
- **Watch items:** free-form `describeError(err)` logging for engine/room
  throws (provider errors are already fixed codes; engine throws are
  free-form Three.js messages — a fixed-code mapping would be strictly
  safer), and the future `structured-dialogue-effects-v0` boundary change
  (see §6).

## 9. Recommended next feature

**`feature/generated-npc-dialogue-spec-v0`.**

Reason: it fixes the smoke-observed "NPC shows only greeting/body + Close"
issue and makes every generated NPC talkable — the smallest slice with the
largest demo delta, pure-domain and deterministic (reuses ADR-0066's closed
tables and hash), and a prerequisite for free-text input landing well.

## 10. Proposed slices for `generated-npc-dialogue-spec-v0`

1. **Slice 1 — docs plan.** Implementation plan; record the root cause; add a
   known-limitation note to ADR-0066 (generator-emitted NPCs previously lacked
   dialogue).
2. **Slice 2 — domain normalizer.** Attach a deterministic closed-table
   dialogue spec to the first dialogue-less generated NPC (keep the
   generator's sanitized name; select persona/greeting/prompts by `room.id`
   hash + `themePack` + anchor type; never overwrite an existing `dialogue`).
   New talkability-invariant and no-leak tests.
3. **Slice 3 — pipeline threading / diagnostics.** Wire for all generated
   paths (prompt room **and** adjacent rooms) with a count/boolean-only
   diagnostic; `assembleRoom` end-to-end coverage.
4. **Slice 4 — fake-provider reply coherence (if needed).** Closed reply
   tables keyed by the new personas + prompt ids + `context.room.focus.type`.
5. **Slice 5 — docs closeout.** ADR + `ARCHITECTURE.md` status entry + manual
   smoke checklist that explicitly includes a generator-emitted-NPC room.

## 11. Non-authoritative note

This review is advisory input to roadmap planning. It is **not** an ADR and
decides nothing by itself. Implementation of anything above requires the
normal flow: maintainer-approved design/implementation plan first, one small
feature slice at a time, ADR at closeout where the repo convention calls for
one.

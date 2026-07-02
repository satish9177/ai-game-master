# Implementation Plan — `feature/npc-dialogue-free-text-input-v0`

> Status: **Draft — design for maintainer review. No code written.**
> ADR: **required at closeout** (not drafted yet; expected next number in
> `docs/architecture/decisions/`).
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [AGENTS.md](../../../AGENTS.md).
> Direct precedents:
> [ADR-0017](../decisions/ADR-0017-npc-dialogue-foundation-v0.md) — dialogue is
> read-only display data; [ADR-0065](../decisions/ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md)
> — the real provider + prompt digest this feature feeds player text into;
> [ADR-0067](../decisions/ADR-0067-generated-npc-dialogue-spec-v0.md) — the
> greeting + prompt-buttons `NPCDialoguePanel` contract that must not regress;
> [ADR-0068](../decisions/ADR-0068-dialogue-usage-guardrails-v0.md) — the
> `requestDialogueAttempt` gate every free-text send must pass through.

## Summary

- **Why this feature exists.** Dialogue today is fixed prompt buttons plus a
  no-prompts "Continue". The player cannot actually *say* anything, and the real
  provider currently receives the raw prompt **id** (`ask-room`) instead of any
  player-facing text — so real replies answer a machine token, not the player.
  This feature adds bounded typed input and fixes the prompt-id leak in one slice.
- **What it depends on.** dialogue-usage-guardrails-v0 (shipped — the gate is the
  spend boundary for the new send path); ADR-0065 real provider + prompt builder
  (shipped); ADR-0067 `NPCDialoguePanel` for generated NPCs (shipped).
- **What it intentionally does not do.** No `WorldState` mutation, no memory
  write, no save/load persistence of turns, no quest/gate/item effects from
  dialogue, no streaming, no NPC-initiated conversation, no free-text anywhere
  except the open `NPCDialoguePanel`.

---

## 1. Goal

Let the player type a short message to the NPC in the open `NPCDialoguePanel`
and receive an in-character reply, with the same safety and spend properties as
the existing prompt buttons: gated by `requestDialogueAttempt`, read-only over
`WorldState`, display-text only, and bounded before it reaches any provider.
Simultaneously fix the existing defect where the **real** provider's
`RECENT CONVERSATION` section renders the structural prompt id (`ask-room` /
`ask-help`) as if the player had said it.

## 2. Current repo facts (verified against source)

- **No text input exists.** `renderer/ui/NPCDialoguePanel.tsx:80–106` renders
  prompt buttons when `prompts` is non-empty, else a single "Continue" button
  (`onSay(undefined)`). There is no input element.
- **The prompt-id defect.** `renderer/RoomViewer.tsx:343–403` (`handleNPCSay`):
  the visible player turn uses `prompt.label` (`:357–359`), but the provider call
  passes `playerLine: prompt?.id` (`:373`). The fake provider *routes* on that id
  (`dialogue/FakeNPCDialogueProvider.ts:156–158`, `PROMPT_LINES[key]?.[request.playerLine]`),
  which is why the id is sent — but the real prompt builder *interpolates* it as
  conversation text (`generation/llmDialoguePrompt.ts:104–106`,
  `player: ${clampText(request.playerLine, 240)}`). Routing and display text are
  currently the same field; they must be split.
- **The duplicate-current-turn hazard.** `RoomViewer` currently appends the
  submitted player turn to UI history before calling the service, while
  `llmDialoguePrompt` renders prior `history` and then appends `playerLine` as
  the current player line. After replacing prompt ids with prompt labels, the
  service input must therefore pass **previous turns only** in `history`; the
  just-submitted player utterance travels through `playerLine` exactly once.
- **The guardrail gate exists and is already wired.** `RoomViewer` receives
  `requestDialogueAttempt?: () => boolean` (`renderer/RoomViewer.tsx:68`) and
  `handleNPCSay` calls it before every reply (`:352–355`), showing
  `DIALOGUE_AT_CAP_MESSAGE` (`app/dialogue.ts:16`) when blocked. `App.tsx:449–465`
  owns the gate over the shared session meter (ADR-0068).
- **The service is read-only.** `dialogue/NPCDialogueService.ts:45–95` only calls
  `session.getWorldState`; there is no `appendEvent`/`WorldCommand` path. Its
  logs carry ids/status/turn counts only — never `playerLine` or reply text.
- **Contracts.** `domain/dialogue/contracts.ts:78–81`:
  `NPCDialogueRequest = { context, playerLine?: string }` (plain TS type, not a
  zod schema). `app/npcDialogueReplyInput.ts` builds `NPCDialogueInput`
  pass-through.
- **Real prompt bounds already exist.** `generation/llmDialoguePrompt.ts:6–7`:
  `MAX_RECENT_TURNS = 6`, `MAX_DIALOGUE_LINE_CHARS = 240` clamp every history
  line and the player line.
- **The fake never echoes input.** `FakeNPCDialogueProvider.reply`
  (`dialogue/FakeNPCDialogueProvider.ts:152–184`) uses `playerLine` only as a
  table lookup key and a `stableIndex` hash offset; the raw string is never
  returned. All reply text comes from closed hand-written tables.

## 3. Final behavior

- The open `NPCDialoguePanel` shows, below the existing prompt buttons /
  Continue: a single-line text input plus a **Send** button.
- Send is disabled while `busy`, and while the input is empty or
  whitespace-only. Input is clamped to `MAX_PLAYER_FREE_TEXT_CHARS = 240` both
  by the input's `maxLength` and by the pure normalizer (defense in depth).
- Sending may append/show a `Player` turn containing the typed (normalized)
  text immediately in UI state, then calls the provider through the existing
  pending/request-id machinery; the NPC reply appends as an `NPC` turn exactly
  like prompt-button replies. The service call's `history` excludes that
  just-submitted player turn.
- Prompt buttons and Continue keep working unchanged. Prompt buttons now send
  `playerLine: prompt.label` (player-facing text) plus a new structural
  `promptId: prompt.id`; the real provider therefore sees "What is this place?"
  instead of `ask-room`.
- `promptId` is the fake-provider routing key; `playerLine` is the current
  player-facing utterance. Real provider prompts see the current utterance
  through `playerLine` exactly once, after previous-turn history.
- Free-text Send normalizes/clamps first. If the normalized text is `null` or
  empty, the handler returns before `requestDialogueAttempt`, so empty or
  whitespace-only sends cannot consume a real-provider usage attempt. Only after
  a valid text, prompt-button, or Continue action is established does the usage
  gate run.
- The fake provider handles arbitrary typed text safely: unknown text misses the
  prompt table and falls through the existing quest/objective/persona/room/memory
  /fallback tiers. It never echoes the raw input.
- Fake-provider prompt-table routing must use own-property checks
  (`Object.hasOwn` or equivalent) before reading the free-text-controlled prompt
  line lookup (`PROMPT_LINES[key][routeKey]`). Today `playerLine` is a controlled
  prompt id; with free text, arbitrary typed text can be `constructor`,
  `toString`, `hasOwnProperty`, `__proto__`, etc. Those strings must not
  accidentally resolve prototype members as prompt lines.
- Dialogue remains read-only display data. Nothing typed can mutate
  `WorldState`, write memory, resolve objects, complete objectives, or unlock
  gates. Turns remain component state and vanish on close (unchanged).

## 4. Safety boundaries (unchanged, and how)

- **No `WorldState` mutation.** The only new call path terminates in
  `NPCDialogueService.reply`, which has no append capability (ADR-0017/0065).
  No `interactions`/`encounters` service is touched by the new path.
- **No memory write.** No `RoomMemoryService`/`NpcMemoryService` reference is
  added anywhere in this feature. Free text is *not* recorded as a
  `player_claim` in v0 — that would be a separate, ADR-gated feature.
- **Usage guardrails apply.** The free-text send reuses the exact ADR-0068 gate;
  there is no ungated provider path.
- **Bounded input to providers.** `normalizePlayerFreeText` trims, strips
  control characters, and clamps to 240 chars before the text enters history or
  `playerLine`; `llmDialoguePrompt` re-clamps at 240 and keeps only the last 6
  turns.
- **No duplicate current line.** `NPCDialogueService` inputs distinguish
  previous-turn `history` from the current `playerLine`. UI state may append the
  current player turn immediately, but the history passed to the service must
  contain only previous turns, excluding the just-submitted player turn.
- **Prototype-key safe fake routing.** `FakeNPCDialogueProvider` must treat the
  free-text-controlled `PROMPT_LINES[key][routeKey]` lookup as a closed
  own-property map. Free-text strings such as `constructor`, `toString`,
  `hasOwnProperty`, or `__proto__` fall through the normal safe tiers; they
  never become returned text and never expose a function/object/prototype value.
  `PERSONA_LINES[key]`, `QUEST_CLUE[key]`, and `stableIndex(playerLine, ...)`
  are not the same risk: those keys are controlled or the helper is safe for
  arbitrary strings.
- **No leakage.** `promptId` is never interpolated into prompt text. No log
  gains player text, reply text, prompt content, ids-as-content, or provider
  bodies; existing count/id-only log shapes are unchanged.
- **Renderer/UI boundary.** `NPCDialoguePanel` stays presentational (one new
  callback prop + local input state); `RoomViewer` stays intent-only.
- **Fake/no-key demo keeps working.** The fake path is deterministic, zero-cost,
  uncounted, and fully exercises the new input.

## 5. Non-goals

- ❌ Persisting dialogue turns or typed text (no save/load change of any kind).
- ❌ Writing memory from free text (`player_claim` capture is a future feature).
- ❌ Any quest/gate/item/flag effect from dialogue text, typed or replied.
- ❌ Multi-line input, chat scrollback persistence, or message editing.
- ❌ Streaming, retry loops, provider router, or `NPCDialogueService` rewrites.
- ❌ Free text to the plain `DialoguePanel` (non-NPC interactions).
- ❌ Content moderation/filtering beyond bounding (out of scope for local BYOK v0;
  note in ADR).

## 6. File-level change plan

| File | Change |
| --- | --- |
| `apps/web/src/domain/dialogue/playerFreeText.ts` (new) | `MAX_PLAYER_FREE_TEXT_CHARS = 240`; pure `normalizePlayerFreeText(raw: string): string \| null` (trim → strip C0/C1 control chars → collapse repeated whitespace → clamp → null when empty). |
| `apps/web/src/domain/dialogue/playerFreeText.test.ts` (new) | Unit tests for the normalizer. |
| `apps/web/src/domain/dialogue/contracts.ts` | Add optional `promptId?: string` to `NPCDialogueRequest` (type-only; no zod change). |
| `apps/web/src/dialogue/NPCDialogueService.ts` | Add `promptId?` to `NPCDialogueInput`; treat `history` as previous turns only and `playerLine` as the current utterance; pass through to `provider.reply({ context, playerLine, promptId })`. No logging change. |
| `apps/web/src/app/npcDialogueReplyInput.ts` | Pass through optional `promptId`. |
| `apps/web/src/dialogue/FakeNPCDialogueProvider.ts` | Route/offset on `request.promptId ?? request.playerLine` wherever the prompt route is used today. `promptId` is the routing key; `promptId ?? playerLine` is only for backward compatibility. `PROMPT_LINES[key][routeKey]` lookup must use an own-property check (`Object.hasOwn` or equivalent) before reading the table so prototype keys fall through safely. `PERSONA_LINES[key]`, `QUEST_CLUE[key]`, and `stableIndex(playerLine, ...)` do not need this treatment. Preserve current behavior for existing callers byte-for-byte. |
| `apps/web/src/renderer/ui/NPCDialoguePanel.tsx` | Local input state + Send button + Enter-to-send; new `onSayFreeText: (text: string) => void` prop; disabled on busy/empty; `maxLength={MAX_PLAYER_FREE_TEXT_CHARS}`; input cleared after send. |
| `apps/web/src/renderer/RoomViewer.tsx` | Prompt path sends `playerLine: prompt.label`, `promptId: prompt.id`, and previous-turn history only. New `handleNPCFreeText(text)` (normalize/clamp → if `null`, return before gate → gate → UI player turn with typed text → `reply` with `playerLine: text` and previous-turn history only), sharing the pending/request-id/error handling with `handleNPCSay` (extract a small shared helper rather than duplicating). |
| Tests (edited) | `NPCDialoguePanel.test.tsx`, `RoomViewer.test.ts`(x), `NPCDialogueService.test.ts`, `FakeNPCDialogueProvider.test.ts`, `llmDialoguePrompt.test.ts`, `npcDialogueReplyInput.test.ts`. |

### Minimum Safe Change Check

- **Reused:** `requestDialogueAttempt` gate, `NPCDialogueService`, pending/
  request-id machinery, `DIALOGUE_AT_CAP_MESSAGE`, `dialogueResultMessage`,
  prompt-builder clamps, fake provider tiers, panel styling/`panel-btn` classes.
- **New code:** one small pure normalizer module, one optional contract field,
  one panel input block, one RoomViewer handler.
- **Boundaries unchanged:** read-only dialogue, memory firewall, logging
  redaction, renderer trust, no schema/persistence change.
- **Targeted tests:** listed in §10.

## 7. Data/state model changes

- `NPCDialogueRequest`/`NPCDialogueInput` gain optional `promptId` (TS types
  only). No zod schema, no `schemaVersion`, no persisted shape changes.
- New UI-local state: the panel's controlled input value. Not lifted, not
  persisted.

## 8. Save/load implications

None. Turns and typed text are component state and are lost on panel close and
on save/load — same as today. No `SlotWrapper` or blob change.

## 9. Provider/LLM implications

- Real provider (`OpenAICompatibleNPCDialogueProvider`) is untouched; its input
  improves: `playerLine` is now genuine bounded player text.
  `buildDialoguePromptMessages` needs **no structural change** — verify with a
  test that `promptId` never appears in any built message.
- Fake provider keeps deterministic routing via `promptId ?? playerLine`
  (back-compat with existing tests/authored routing keyed on `ask-hall` etc.).
- Routing precedence is `promptId` first. The `playerLine` fallback exists only
  for backward compatibility with callers/tests that still pass the old prompt
  id as `playerLine`.
- Required prompt-builder regression coverage belongs in the same slice as the
  `promptId`/`playerLine` split: real prompts must render previous-turn history,
  then the current `playerLine` exactly once. The current prompt-button label or
  typed text must not be duplicated by also appearing in the history payload.
- Cost: one metered call per send — identical to a prompt-button click under
  ADR-0068. No new call class, no auto-calls.

## 10. Tests required

- `playerFreeText`: trims; strips control chars; collapses whitespace; clamps at
  240 without inventing content; empty/whitespace/control-only → `null`.
- `NPCDialoguePanel`: input renders alongside prompts and alongside Continue;
  Send disabled when busy/empty/whitespace; Enter submits; `onSayFreeText`
  receives the typed value; input clears after send; existing prompt/Continue
  tests stay green.
- `RoomViewer`: free-text send appends a Player turn with the typed text (not an
  id) in UI state but passes previous-turn history only to the service; empty or
  whitespace-only free-text send returns before `requestDialogueAttempt`; blocked
  gate → `DIALOGUE_AT_CAP_MESSAGE`, no `reply` call; prompt button now passes
  `playerLine === prompt.label`, `promptId === prompt.id`, and previous-turn
  history only; stale request-id/pending guards apply to free text; free text
  calls no interaction/encounter service.
- `NPCDialogueService`: `promptId` passthrough; `history` remains previous turns
  only while `playerLine` carries the current utterance; logs unchanged
  (captured logger: no player text).
- `FakeNPCDialogueProvider`: routing behavior byte-identical when `promptId`
  carries the old id; promptId routing for `ask-room` / `ask-help` still works;
  arbitrary hostile text (`<script>`, "SYSTEM:", 10k chars pre-clamp) never
  appears in the reply; typed `constructor` does not return a function as text;
  typed `toString`, `hasOwnProperty`, and `__proto__` fall through safely;
  deterministic replies for same input.
- `llmDialoguePrompt`: typed text lands only in `RECENT CONVERSATION`, clamped;
  prompt button label appears once, not twice, in `RECENT CONVERSATION`; typed
  text appears once, not twice; raw prompt id `ask-room` does not appear in the
  real prompt; existing memory/section tests green.

## 11. Manual smoke checklist

1. Fake provider: open a generated NPC, type "hello there" → Player turn shows
   typed text; deterministic NPC reply appends; meter stays 0.
2. Prompt buttons and Continue still reply; generated NPCs still open
   `NPCDialoguePanel` (ADR-0067 regression).
3. Empty/whitespace input: Send disabled; Enter does nothing; real-provider
   usage count is unchanged.
4. Paste 1,000 chars → input holds 240; sent turn shows the clamped text.
5. Real provider (BYOK): type a question → network tab shows the typed text (not
   `ask-room`) in the request digest; exactly one request; meter +1.
6. At cap: Send shows the calm message, no request, panel stays usable.
7. Console: no player text, reply text, key, or provider body in logs.

## 12. Rollback notes

Single revert restores prior behavior (prompt-id sent as `playerLine`, no input
UI). All changes are additive/local; nothing persisted depends on them; no
schema/migration rollback needed. The contract's optional `promptId` is inert if
unused.

## 13. Implementation slices

1. **Docs (this plan)** — maintainer review checkpoint.
2. **Domain + contracts:** `playerFreeText.ts` (+tests); `promptId` on
   contracts/service/reply-input; fake-provider routing via
   `promptId ?? playerLine` (+tests proving byte-identical legacy behavior).
3. **UI + wiring:** `NPCDialoguePanel` input/Send; `RoomViewer` free-text handler
   and prompt-path `label`/`promptId` split; service calls pass previous-turn
   history only; prompt-builder tests prove prompt labels/typed text appear once
   and raw prompt ids do not appear (+tests).
4. **Closeout:** docs (`ARCHITECTURE.md` status entry), **ADR**, manual smoke
   run.

## 14. Dependencies on earlier/later features

- **Depends on (shipped):** ADR-0065 (real provider), ADR-0067 (panel spec for
  generated NPCs), ADR-0068 (`requestDialogueAttempt`).
- **Enables (later):** `memory-poisoning-redteam-v0` (feature 9) requires this
  free-text surface to exist; a future `player_claim` memory-capture feature
  would build on the normalized text seam — explicitly out of scope here.

## 15. Open questions / risks

- **Fake-provider reply variety for prompted sends:** using
  `promptId ?? playerLine` for hash offsets keeps legacy behavior exact;
  confirm the maintainer prefers exactness over simplifying to `playerLine`.
- **Prompt-injection via typed text** reaching the real model is mitigated
  (fixed system prompt, section ordering, clamps) but not preventable at the
  text level; the architectural guarantee remains that no reply can mutate
  state. Redteam coverage lands in feature 9.
- **Send-vs-prompt affordance:** should prompt buttons hide once the player
  starts typing? v0 keeps both visible (smallest change); revisit after play.
- **`aria-label`/focus order** for the new input needs a quick a11y pass in the
  panel tests.

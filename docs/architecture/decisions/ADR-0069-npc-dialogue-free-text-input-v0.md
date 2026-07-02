# ADR-0069: NPC Dialogue Free Text Input v0

- **Status:** Accepted - Implemented (manual smoke pending maintainer verification)
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Extends:**
  [ADR-0017](./ADR-0017-npc-dialogue-foundation-v0.md) (NPC dialogue is
  read-only display data),
  [ADR-0065](./ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md) (the real
  dialogue prompt/provider path),
  [ADR-0067](./ADR-0067-generated-npc-dialogue-spec-v0.md) (generated NPCs open
  `NPCDialoguePanel` with greeting and prompt buttons),
  [ADR-0068](./ADR-0068-dialogue-usage-guardrails-v0.md) (user-triggered real
  dialogue calls are usage-gated).

> Full design and closeout notes live in
> [`npc-dialogue-free-text-input-v0`](../implementation-plans/npc-dialogue-free-text-input-v0.md).

---

## Context

NPC dialogue previously supported fixed prompt buttons and a no-prompts
Continue action. The player could not type a line to the NPC. The same path also
overloaded one field: prompt buttons sent the structural prompt id, such as
`ask-room`, as `playerLine`. That kept the deterministic fake provider routing,
but the real prompt builder rendered that id as if the player had spoken it.

ADR-0068 already established the spend boundary: user-triggered prompt/Continue
dialogue calls pass through `requestDialogueAttempt`, while opening a dialogue
shows only the static greeting and makes no provider call. This feature reuses
that gate and does not create a new provider selection or call class.

---

## Decision

Add bounded single-line free-text input to `NPCDialoguePanel` and thread it
through the existing `RoomViewer` dialogue reply path. Split structural routing
from player-facing text:

- `promptId` is the fake-provider routing key.
- `playerLine` is the current player-facing utterance.
- Prompt buttons send `promptId: prompt.id` and `playerLine: prompt.label`.
- Typed sends send `promptId: undefined` and
  `playerLine: normalizePlayerFreeText(rawText)`.
- `history` passed to `NPCDialogueService.reply` contains previous turns only,
  excluding the just-submitted player turn.

The UI may append the current player turn immediately after normalization and
usage-gate success, but the real prompt builder sees that current utterance only
through `playerLine`, exactly once.

---

## Behavior

- `NPCDialoguePanel` renders a single-line text input and Send button below the
  prompt buttons/Continue area.
- Enter submits the text form. The input is disabled while dialogue is pending.
- Escape closes the panel even when focus is inside the text input.
- Empty or whitespace-only input normalizes to `null` and returns before
  `requestDialogueAttempt`, so it cannot consume real-provider usage.
- Valid typed text reuses the same guarded `RoomViewer` path as prompt buttons
  and Continue.
- If `requestDialogueAttempt` returns `false`, no typed player turn is appended,
  no provider call is made, and the existing dialogue cap message is shown.
- Prompt buttons and Continue remain available and keep their previous
  user-visible behavior.

---

## Free-Text Normalization

Free text is normalized by `normalizePlayerFreeText` in
`apps/web/src/domain/dialogue/playerFreeText.ts`:

- trim leading/trailing whitespace;
- convert ASCII control characters, including newline, carriage return, and tab,
  to spaces;
- collapse repeated whitespace;
- clamp to `MAX_PLAYER_FREE_TEXT_CHARS = 240`;
- trim again after clamping;
- return `null` for empty output.

The panel input also uses `maxLength={MAX_PLAYER_FREE_TEXT_CHARS}` as UI defense
in depth, but `RoomViewer` calls the normalizer too so direct handler calls
cannot bypass normalization.

---

## Safety Boundaries

- **No authoritative state change.** NPC dialogue remains display text only. It
  cannot change quests, memory, items, gates, flags, rooms, or `WorldState`.
- **No memory write.** Typed player lines are not captured as `player_claim`
  memories in v0. Memory capture would require a separate ADR and firewall
  design.
- **No persistence.** Typed text and dialogue turns remain component/UI state.
  Save/load, schemas, SQLite, backend persistence, and localStorage save parking
  are unchanged.
- **No renderer-engine change.** The trusted Three.js renderer and engine intent
  seams are untouched.
- **No provider-selection change.** The fake provider remains default; the real
  provider remains opt-in through the existing configuration.
- **Usage gate preserved.** Valid typed sends, prompt buttons, and Continue all
  use the same `requestDialogueAttempt` gate before provider calls. Empty typed
  sends return before the gate.
- **Logging restrictions unchanged.** No logs may include typed player text, NPC
  reply text, prompt bodies, provider request/response bodies, keys, PII, room
  names, object names, or narrative content. Existing count/status/id-only
  diagnostics remain the allowed shape.

---

## Fake-Provider Prototype-Key Safety

Free text can be arbitrary strings such as `constructor`, `toString`,
`hasOwnProperty`, and `__proto__`. Fake-provider prompt routing therefore uses
`routeKey = request.promptId ?? request.playerLine` and own-property checks for
the free-text-controlled prompt-line lookup before reading
`PROMPT_LINES[key][routeKey]`.

Unknown or prototype-key route strings fall through the existing safe fake tiers;
no function, object, prototype value, or raw typed key can become NPC response
text. `PERSONA_LINES[key]`, `QUEST_CLUE[key]`, and stable hashing for arbitrary
strings are not the same risk because those keys are controlled or the helper is
safe for arbitrary input.

---

## Consequences

- The real provider now sees player-facing prompt labels and typed player lines
  rather than structural prompt ids.
- The prompt builder renders previous conversation history and then the current
  `playerLine`; prompt labels and typed text appear once, not twice.
- The free-text surface increases the amount of player-authored text that can
  reach the real model, but output remains non-authoritative and cannot mutate
  game state.
- Future memory capture/redteam work can build on the normalized text seam, but
  v0 deliberately does not write memory or persist free text.
- Manual smoke is still pending maintainer verification.


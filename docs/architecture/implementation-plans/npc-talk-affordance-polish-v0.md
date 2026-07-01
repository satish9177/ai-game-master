# Implementation Plan — `feature/npc-talk-affordance-polish-v0`

> Status: **planned, not implemented.**
> Maintainer approved docs-only planning on 2026-07-01. Decisions locked at approval:
> include an optional role subtitle, but only through a closed hand-written persona-to-label
> map (unknown/absent persona renders no subtitle; the raw persona slug is never rendered); no
> ADR required for this slice — this implementation plan is the source of truth.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md).
> Builds on the shipped
> [real-npc-dialogue-room-memory-awareness-v0](./real-npc-dialogue-room-memory-awareness-v0.md)
> plan / [ADR-0065](../decisions/ADR-0065-real-npc-dialogue-room-memory-awareness-v0.md). This
> slice is presentation-only and does not touch any provider, service, memory, or schema code
> from that feature.

---

## Goal

Make the moment-to-moment "identify → open → converse" NPC talk loop read clearly, without
changing memory, provider safety, persistence, or gameplay truth. The existing proximity + F-key
open flow and provider/service architecture already work correctly; this slice only polishes
`NPCDialoguePanel`'s presentation (name safety, optional role subtitle, turn readability, a
visible responding/failure/empty state) plus one composition-layer name-fallback fix.

---

## 1. Current repo facts (verified against source)

- **Open flow already works and is not changing.** `Engine.updateProximity`
  (`renderer/engine/Engine.ts:191-206`) picks the nearest interactable each frame and calls
  `onActiveInteractionChange`; `Hud.tsx` renders `Press <E/F> · <affordance label> · <prompt>`.
  `affordanceFor` (`domain/interactions/affordance.ts:23-35`) already maps
  `interaction.dialogue` or `objectType === 'npc'` to `'talk'`, and `AFFORDANCE_LABEL.talk =
  'Talk'`. Pressing the matching key fires `onRequestOpenInteraction`
  (`Engine.ts:208-216`), and `RoomViewer`'s handler
  (`renderer/RoomViewer.tsx:217-259`) resolves it against `npcDialogueLookupRef` and opens
  `NPCDialoguePanel`. **No click-to-talk, no raycast selection exists today, and none is added.**
- **`NPCDialoguePanel`** (`renderer/ui/NPCDialoguePanel.tsx`) is presentational only, already
  receives neutral props (`npcName`, `turns`, `prompts?`, `message?`, `busy`, `onSay`, `onClose`)
  from `RoomViewer`, and already closes on Escape/backdrop/Close button
  (`RoomViewer.tsx:112-259, 370-436, 489-499`). It has no service/provider/memory import today
  and none is added.
- **Object-id leak in the name fallback (bug this plan fixes).** `buildDialogueLookup`
  (`app/dialogue.ts:14-29`) sets `npcName = ('name' in object && object.name) ? object.name :
  object.id`. A name-less, id-bearing NPC (the common case for a generated room) would render its
  raw internal object id as the panel title — the only concrete `AGENTS.md` "no object ids in
  UI" violation found in this code path. (A name-less *and* id-less NPC is already dropped from
  the lookup map entirely and is out of scope.)
- **`busy` already exists but is invisible.** `RoomViewer` already tracks
  `npcDialoguePending`/`setNPCDialoguePending` (`RoomViewer.tsx:126, 230-231, 244-245, 253-254,
  387-388, 404-405, 416-417`) and passes it as `NPCDialoguePanel`'s `busy` prop. Today `busy` only
  disables the prompt/Continue buttons (`NPCDialoguePanel.tsx:59, 65`) — there is no visible
  "responding…" indicator and no `aria-busy`.
- **Failure path is already safe, just visually flat.** `dialogueResultMessage`
  (`app/dialogue.ts:31-36`) already maps `NPCDialogueResult` to two calm, fixed strings ("They
  have nothing to say right now." / "This conversation is unavailable.") with no raw
  reason/error text; the panel renders it as a plain `<p className="panel-result">`.
  `NPCDialogueService.reply` (`dialogue/NPCDialogueService.ts:45-95`) is unchanged and stays
  read-only (`session.getWorldState` only, no `appendEvent`).
- **`NPCDialogueSpec.persona`** (`domain/dialogue/contracts.ts:12-21`) is an author-supplied
  free-form optional `string`, not a closed enum. `FakeNPCDialogueProvider.PERSONA_LINES`
  (`dialogue/FakeNPCDialogueProvider.ts:5-16`) already has two known authored slugs today:
  `'friendly-aide'` and `'survivor'`. This plan's role-subtitle map reuses those two slugs as its
  initial closed set; it does not import from `FakeNPCDialogueProvider` (that module is
  provider-layer, not UI-layer — the map is a small independent hand-written table in the UI
  layer) and does not change that provider file.
- **No existing test file for the panel.** `renderer/ui/NPCDialoguePanel.tsx` has no
  `NPCDialoguePanel.test.tsx` today (confirmed: no match found). `DialoguePanel.test.tsx` exists
  as a sibling and is a reasonable structural reference for panel-test conventions (render,
  Escape, backdrop, button clicks) but is not imported or reused directly.
- **CSS today** (`index.css:126-278`): `.hud`, `.hud-key`, `.hud-affordance`, `.hud--resolved`,
  `.hud-resolved` for the Hud; `.panel-backdrop`, `.panel`, `.panel-head`, `.panel-title`,
  `.panel-close`, `.panel-body`, `.panel-turns`, `.panel-choices`, `.panel-result`, `.panel-foot`,
  `.panel-btn` shared by both `DialoguePanel` and `NPCDialoguePanel`. This plan adds a small
  number of **new, additive** classes; it does not edit the shared selectors above (both existing
  panels must keep rendering identically).

---

## 2. Scope

### To implement

1. **`app/dialogue.ts` — neutral name fallback.** Replace `object.id` as the `npcName` fallback
   with a fixed neutral constant (`DEFAULT_NPC_NAME = 'Stranger'`, or similar single hand-written
   string). No object id may reach `npcName` under any input.

2. **`renderer/ui/NPCDialoguePanel.tsx` — presentational polish only.**
   - Keep the existing prop signature; optionally add one new optional prop for the role
     subtitle input (either compute the label inside the panel from a new small prop like
     `persona?: string` passed down from `RoomViewer`, or resolve it in `RoomViewer`/`app/dialogue.ts`
     and pass a pre-resolved `roleLabel?: string` — final call in Slice 2, default to resolving in
     `app/dialogue.ts` next to the name fix so the panel stays a pure display component with no
     lookup logic of its own).
   - Add a small closed `PERSONA_ROLE_LABEL: Readonly<Record<string, string>>` map (e.g.
     `{ 'friendly-aide': 'Aide', survivor: 'Survivor' }`) used only to resolve the optional
     subtitle. Unknown, absent, or unrecognized persona → no subtitle rendered. The raw persona
     string is never interpolated into the UI.
   - Render turns with clearer speaker distinction (existing `turn.speaker === 'player' ? 'You' :
     npcName` logic kept; only styling/structure clarified).
   - Add a visible "responding…" state driven by the existing `busy` prop: a small status element
     (inside the existing `aria-live="polite"` region already on `.panel-turns`, or a sibling
     region) plus `aria-busy={busy}` on the panel container. Buttons keep their existing
     `disabled={busy}`.
   - Add an explicit empty-state affordance when there are no authored `prompts` (currently a bare
     "Continue" button) so it reads as an intentional "nothing more to ask right now, continue" or
     similar closed hand-written string, not a dead end.
   - `message` (failure text) keeps rendering through the existing safe
     `dialogueResultMessage` strings — no new copy semantics, only presentation (e.g. a status
     styling class).

3. **`index.css` — additive classes only** for the new responding/empty/role-subtitle states.
   No edits to existing shared `.panel*`/`.hud*` selectors.

4. **New test file `renderer/ui/NPCDialoguePanel.test.tsx`.**

5. **Extend `app/dialogue.test.ts`** for the neutral name fallback (and role-label resolution, if
   resolved in this file per the Slice 2 decision above).

### Out / non-goals (locked at approval)

- No click-to-talk / raycast NPC selection — proximity + E/F remains the only open path; no new
  engine→React seam.
- No typed free-text player input — authored `dialogue.prompts` / `Continue` remains the only
  input model.
- No generated/LLM-authored starter suggestions — no content invention, no new provider call.
- No `NPCDialogueService`, `NPCDialogueProvider`, `FakeNPCDialogueProvider`,
  `OpenAICompatibleNPCDialogueProvider`, `llmDialoguePrompt`, `selectDialogueProvider`,
  `buildDialogueContext`, `buildRoomDialogueContext`, or `npcDialogueReplyInput` changes.
- No new memory storage, migration, `schemaVersion` bump, NPC private memory,
  `event_visibility`, `facts`/`fact_visibility`, or LLM-written memory.
- No world-state mutation from dialogue; the service stays read-only.
- No raw `RoomSpec` JSON, object ids, flag/gate JSON, provider request/response body, prompt
  text, or memory text in UI or logs beyond what is already intentionally user-visible dialogue
  text.
- No authored/demo dialogue behavior regression.
- No new dependency, no renderer/engine change, no `Engine.ts` change.

---

## 3. Minimum Safe Change Check

- **Reused:** existing `NPCDialoguePanel` prop shape (`turns`, `prompts?`, `message?`, `busy`,
  `onSay`, `onClose`) · existing `busy`/`npcDialoguePending` state already threaded through
  `RoomViewer` · existing `dialogueResultMessage` safe strings · existing `.panel*` CSS
  scaffolding · existing proximity/E-F open flow, unchanged · existing `NPCDialogueSpec.persona`
  field, read-only.
- **New code (minimum):** one neutral name constant + fallback change in `app/dialogue.ts` · one
  small closed persona→label map · a handful of new CSS classes · presentational-only panel
  markup changes (no new state machine, no new service call).
- **Safety boundaries unchanged:** `NPCDialogueService` remains read-only with no `appendEvent`
  path · providers (fake and real) untouched · memory firewall untouched (`memory/**`,
  `domain/memory/**` not imported by any changed file) · no schema/migration change · logging
  redaction unaffected (no changed file adds a `console.*` call or a logger line) · renderer
  engine boundary unaffected (`renderer/engine/**` untouched).
- **Targeted tests:** new `NPCDialoguePanel.test.tsx` covering render/name/turns/busy/failure/
  empty/prompts/close/Escape/role-subtitle; extended `dialogue.test.ts` covering the neutral name
  fallback and absence of any raw object id in `npcName`.

---

## 4. Files touched by the planned slices

**New files:**

- `apps/web/src/renderer/ui/NPCDialoguePanel.test.tsx`

**Modified files:**

- `apps/web/src/app/dialogue.ts` — neutral `npcName` fallback constant; optional role-label
  resolution if resolved here (see Slice 2).
- `apps/web/src/app/dialogue.test.ts` — extended coverage for the fallback.
- `apps/web/src/renderer/ui/NPCDialoguePanel.tsx` — presentational polish described in §2.
- `apps/web/src/index.css` — new additive classes only.

**Optional, deferred unless the maintainer asks for it in a later slice:**

- `apps/web/src/renderer/ui/Hud.tsx` — a `talk`-affordance modifier class for a louder cue. Not
  part of this plan's committed scope; flagged as a possible low-value follow-up only.

---

## 5. Files NOT to touch

`domain/ports/NPCDialogueProvider.ts` · `domain/dialogue/contracts.ts` ·
`domain/dialogue/buildDialogueContext.ts` · `domain/dialogue/buildRoomDialogueContext.ts` ·
`dialogue/NPCDialogueService.ts` · `dialogue/FakeNPCDialogueProvider.ts` ·
`generation/OpenAICompatibleNPCDialogueProvider.ts` · `generation/llmDialoguePrompt.ts` ·
`app/selectDialogueProvider.ts` · `app/npcDialogueReplyInput.ts` · `app/llmConfig.ts` ·
`domain/memory/**` · `memory/**` · `persistence/**` · `domain/world/**` (all schemas) ·
`domain/quests/**` · `renderer/engine/**` · `renderer/ui/DialoguePanel.tsx` ·
`renderer/RoomViewer.tsx` (no prop/behavior change required; only its existing `busy` state is
consumed, unchanged) · `world-session/**` · `interactions/**` · `encounters/**` · `server/**` ·
`eslint.config.js` · `package.json`.

---

## 6. Implementation slices

Each slice is independently shippable and independently testable. Do not merge slices.

---

**Slice 1 — Docs (this slice)**
`docs: add implementation plan for NPC talk affordance polish v0`

New file: this plan.

No source code. Status: **complete** (this document).

---

**Slice 2 — Neutral NPC name fallback**
`fix(app): neutral NPC name fallback instead of raw object id`

Modified: `app/dialogue.ts`, `app/dialogue.test.ts`.

Replace the `object.id` fallback in `buildDialogueLookup` with a fixed neutral display string
(`DEFAULT_NPC_NAME`). Decide and lock in this slice whether the optional role-label resolution
(persona → closed label) lives in `app/dialogue.ts` (added to `NPCDialogueTarget`) or inside
`NPCDialoguePanel.tsx` directly; either is acceptable, but pick one so Slice 3 has a fixed
contract. Recommended: resolve in `app/dialogue.ts` so `NPCDialoguePanel` stays a pure display
component with no lookup/table logic beyond rendering a given string.

Tests (`dialogue.test.ts`):
- A name-less, id-bearing NPC (`{ id: 'aide', /* no name */ }`) resolves to `DEFAULT_NPC_NAME`,
  never `'aide'`.
- A named NPC keeps its authored name, unchanged from today.
- (If role-label resolution lands here) a known persona (`'friendly-aide'`) resolves to its
  fixed label; an unknown/absent persona resolves to `undefined` — never the raw persona string.
- Existing lookup test (duplicate-id-skip, name-less-and-id-less-drop) remains green, unmodified
  in behavior.

Verification: `npm run test -- dialogue`, `npm run lint`, `npm run build`

---

**Slice 3 — `NPCDialoguePanel` presentational polish**
`feat(ui): NPCDialoguePanel polish — role subtitle, responding state, empty state`

New file: `renderer/ui/NPCDialoguePanel.test.tsx`.
Modified: `renderer/ui/NPCDialoguePanel.tsx`, `index.css`.

Implements the presentational changes in §2.2 using the contract locked in Slice 2. No new
service/provider call; no new `RoomViewer` prop wiring beyond passing through the already-decided
role-label input.

Tests (`NPCDialoguePanel.test.tsx`):
- Renders `npcName` as the panel title/heading.
- Renders each entry in `turns` with the correct speaker label (`You` vs `npcName`), in order.
- `busy=true` shows a visible responding indicator (assert by text/role, not just a CSS class)
  and disables both the prompt buttons and the `Continue` button; `aria-busy` reflects `busy`.
- `busy=false` hides the responding indicator.
- `message` (failure string) renders visibly and distinctly when present; absent when
  `message` is undefined.
- Empty-prompts case (`prompts` undefined or `[]`) renders the closed empty-state affordance
  (not a bare, unexplained "Continue") and clicking it calls `onSay(undefined)`.
- Non-empty `prompts` renders one button per prompt with the correct label, and clicking one
  calls `onSay(prompt.id)`.
- `onClose` fires on the Close button click and on `Escape` keydown (mirrors existing
  `DialoguePanel.test.tsx` Escape-handling pattern).
- Role subtitle renders only for a known/mapped persona input and never renders a raw,
  unmapped persona string; absent/unknown persona input renders no subtitle element at all.
- No test asserts on any object id, raw persona slug, or provider/memory text appearing in
  rendered output.

Verification: `npm run test -- NPCDialoguePanel`, `npm run lint`, `npm run build`

---

**Slice 4 — Regression sweep and manual smoke**
`docs: close out NPC talk affordance polish v0`

No new production files. Update `docs/architecture/ARCHITECTURE.md` with a short "NPC Talk
Affordance Polish v0" status paragraph in the existing feature-map style, noting it is
presentational-only (UI + one composition-layer fallback) with no provider/service/memory/schema
change.

Checks:
- Full existing dialogue/panel test suites remain green:
  `npm run test -- dialogue`, `npm run test -- NPCDialoguePanel`,
  `npm run test -- NPCDialogueService`, `npm run test -- FakeNPCDialogueProvider`.
- Grep-level sweep: no new `console.*` call, no new `platform/logger` import, and no raw object
  id / persona slug literal rendered in `renderer/ui/NPCDialoguePanel.tsx` or `app/dialogue.ts`.
- Manual smoke checklist (dev, local run):
  1. Authored demo room: approach the aide NPC → Hud shows `Press F · Talk · …`; press F → panel
     opens with the real authored name and greeting turn.
  2. Choose an authored prompt → visible responding indicator appears, buttons disable, reply
     appends, indicator clears.
  3. Rapidly reopen/switch NPCs and press Escape mid-response → no stale reply lands in the
     wrong panel (existing `requestId` guard in `RoomViewer` still holds; unchanged code path).
  4. NPC with no authored prompts → the empty-state affordance reads as intentional, not a dead
     end.
  5. Generated-room NPC with no authored `name` → panel title shows the neutral fallback (e.g.
     "Stranger"), never a raw object id.
  6. Force a provider failure (fake path: simulate rejection in a dev harness, or real path with
     a broken/incomplete config) → calm fallback message shown, panel stays usable, no world
     state change, no raw error/prompt/memory text in the browser console.
  7. Fake-provider default end-to-end path (no `.env.local` real config) behaves exactly as
     before this slice, aside from the presentational changes.

Verification: `npm run test`, `npm run lint`, `npm run build`; manual smoke as above (dev-only,
not part of CI).

---

## 7. Verification commands (full slice set)

```bash
# Slice 2
npm run test -- dialogue

# Slice 3
npm run test -- NPCDialoguePanel

# Slice 4 — regression
npm run test -- NPCDialogueService
npm run test -- FakeNPCDialogueProvider
npm run lint
npm run build

# Broader regression before calling the feature done
npm run test
```

Run from `apps/web`. Prefer the targeted test commands per slice; run the full `npm run test`
only once at final closeout (Slice 4), per `AGENTS.md`'s "prefer targeted verification" rule.

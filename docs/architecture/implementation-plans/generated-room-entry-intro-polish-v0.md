# Implementation Plan — `feature/generated-room-entry-intro-polish-v0`

> Status: **implemented.**
> Maintainer approved the design on 2026-06-29.
>
> **Depends on (implemented and merged):**
> - Room Inspect Summary v0
>   ([ADR-0035](../decisions/ADR-0035-room-inspect-summary-v0.md)) — `buildRoomSummary`,
>   `buildSummaryText`, and `RoomIntroPanel` are the existing presentation layer this plan
>   polishes.
> - Generated Room Display Sanitization v0
>   ([ADR-0042](../decisions/ADR-0042-generated-room-display-sanitization-v0.md)) — the
>   `sanitizeGeneratedDisplayText` pass already runs before the intro is shown; this plan
>   layers above it without weakening it.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [ADR-0055](../decisions/ADR-0055-generated-room-entry-intro-polish-v0.md).

---

## Goal

Stop the generated-room entry intro panel from leaking implementation-flavor text like
`"You enter the Generated room — post-apoc | tense | survivors."` The fix is a small pure
normalization of the room-name clause inside `buildRoomSummary`, with no changes to generation,
schema, pipeline, backend, or UI wiring.

---

## Minimum Safe Change Check

**What existing code is reused:**
- `buildRoomSummary` / `buildSummaryText` — the existing text producer; unchanged except for
  one call-site swap.
- `withArticle` — still used by `introRoomNoun` for all non-marker, non-tagged names.
- `RoomIntroPanel` / `AppRoomIntro` / `buildRoomIntroView` — unchanged; the fix is
  upstream in the pure domain function.
- Existing `roomSummary.test.ts` fixtures — extended, not replaced.

**What new code is actually necessary:**
- `introRoomNoun(roomName: string): string` — one pure exported function (~15 lines) in
  `domain/roomSummary.ts`.
- One-line change in `buildSummaryText`: replace `withArticle(roomName)` with
  `introRoomNoun(roomName)`.
- New Vitest cases in `domain/roomSummary.test.ts`.

**Safety boundaries unchanged:**
- `RoomSpec` schema (`schemaVersion` stays `1`).
- Generation pipeline (`FakeRoomGenerator`, `OpenAICompatibleRoomGenerator`, `llmRoomPrompt.ts`).
- `assembleRoom`, `validateRoom`, `repairRoom`, layout normalizers, sanitizer — all untouched.
- `sanitizeGeneratedDisplayText` — not weakened; these two mechanisms are complementary.
- App/UI wiring — `buildRoomIntroView`, `AppRoomIntro`, `AppRoomEntryOverlay`, `RoomIntroPanel`
  unchanged.
- Logging — no new log surface.

**Targeted tests:**
- `npm run test -- roomSummary` covers `introRoomNoun` cases + end-to-end regression on
  `buildRoomSummary` intro clause. No DOM, no React, no network.

---

## 1. Current repo facts (verified)

- **`domain/roomSummary.ts`** — `buildSummaryText(roomName, focal, supports)` builds the full
  summary string. The intro clause is:
  ```ts
  const intro = `You enter ${withArticle(roomName)}.`
  ```
  `withArticle` only prepends `"the "` if the name has no leading article; it does not
  filter content.
- **`FakeRoomGenerator.ts:281`** — the fake sets:
  ```ts
  name: label ? `Generated room — ${label}` : 'Generated room'
  // label = clampPrompt(prompt, 60)
  ```
  `prompt` is the `worldBibleToGeneratorSeed` projection (e.g. `"post-apoc | tense | survivors"`).
  The name therefore leaks both the `"Generated room"` marker and the ` | `-separated seed tags.
- **`sanitizeGeneratedDisplayText.ts:19`** — `SAFE_ROOM_NAME = 'Generated room'`. The sanitizer
  only rewrites `room.name` when it contains a `gen-xxxxxxxx` structural id. The fake name has no
  structural id, so it passes through untouched.
- **`domain/roomSummary.test.ts`** — already has cases asserting that `object.name`,
  `interaction.*`, and injected malicious strings do not appear in the summary text. These are
  extended, not replaced.
- **Authored / fallback names** (`"Throne Room"`, `"Ransacked Safe House"`, `"A quiet stone
  antechamber"`) — none start with `"Generated room"` (case-insensitive) and none contain ` | `.
  Rule 4 (`withArticle`) produces correct output for all of them.

---

## 2. Scope

### In scope (this plan)

1. **`introRoomNoun`** — new pure exported function in `domain/roomSummary.ts`.
2. **`buildSummaryText` wire** — one call-site change in `domain/roomSummary.ts`.
3. **Tests** — new cases in `domain/roomSummary.test.ts`.
4. **Docs closeout** — ADR-0055 status flip, this plan status, `ARCHITECTURE.md` status legend.

### Explicitly not in scope

See ADR-0055 "Out of scope" section.

---

## 3. Slices and closeout

Both slices are complete. No commits were made as part of this plan.

### Slice 1 — Source: `introRoomNoun` + test cases

**Status:** Complete.

**Files changed:**
- `apps/web/src/domain/roomSummary.ts`
  - Add exported pure function `introRoomNoun(roomName: string): string` implementing the
    four normalization rules from ADR-0055.
  - In `buildSummaryText`, replace `` `You enter ${withArticle(roomName)}.` `` with
    `` `You enter ${introRoomNoun(roomName)}.` ``.
- `apps/web/src/domain/roomSummary.test.ts`
  - Add `introRoomNoun` describe block with all cases from the ADR test plan.
  - Add `buildRoomSummary` end-to-end regression cases for the leaked-name scenario.

No wiring change; no UI/renderer/generation/schema/pipeline change.

**Verification:**
```bash
# from apps/web
npm run test -- roomSummary
npm run lint
npm run build
```

---

### Slice 2 — Docs closeout

**Status:** Complete.

**Files changed:**
- `docs/architecture/decisions/ADR-0055-generated-room-entry-intro-polish-v0.md` — status:
  **Implemented**.
- `docs/architecture/implementation-plans/generated-room-entry-intro-polish-v0.md` (this file) —
  status: **implemented**.
- `docs/architecture/ARCHITECTURE.md` — move the entry from 🔜 planned to ✅ implemented in the
  status legend; add a brief section body in the correct position (after ADR-0054).

**Verification:**
```bash
npm run build
git diff --check
```

**Closeout verification actually run:**
- `cmd /c npm run test -- roomSummary` — passed during Slice 1 source verification.
- `cmd /c npm run build` — passed during Slice 1 source verification and again during Slice 2
  docs closeout.
- `cmd /c npm run lint` — failed during Slice 1 source verification on unrelated/pre-existing
  `App.tsx` `react-refresh/only-export-components` errors and one
  `react-hooks/exhaustive-deps` warning; no lint failure was reported from the touched
  `roomSummary` source/test files.
- `cmd /c git diff --check` — passed during Slice 2 docs closeout.

---

## 4. Implementation detail — `introRoomNoun`

```ts
// Normalization rules (ordered, first match wins):
// 1. Empty/whitespace → 'the room'
// 2. Starts with 'generated room' (case-insensitive) → 'the room'
//    Covers 'Generated room' (bare sanitizer constant) and
//    'Generated room — post-apoc | tense | survivors' (fake name with seed tags)
// 3. Contains '|' → take text before first '|', trim, apply withArticle
//    Covers 'Ashfall Market | post-apoc | grim' → 'the Ashfall Market'
// 4. Otherwise → withArticle(trimmed)  (authored/real-provider names unchanged)
export function introRoomNoun(roomName: string): string {
  const trimmed = roomName.trim()
  if (trimmed.length === 0) return 'the room'
  if (/^generated room\b/i.test(trimmed)) return 'the room'
  const pipeIndex = trimmed.indexOf('|')
  if (pipeIndex !== -1) {
    const leading = trimmed.slice(0, pipeIndex).trim()
    return leading.length > 0 ? withArticle(leading) : 'the room'
  }
  return withArticle(trimmed)
}
```

`withArticle` is the existing private helper in the same file; it remains private.

---

## 5. Tests

```
introRoomNoun
  ✓ '' → 'the room'
  ✓ '   ' → 'the room'
  ✓ 'Generated room' → 'the room'
  ✓ 'generated room' → 'the room'
  ✓ 'Generated Room' → 'the room'
  ✓ 'Generated room — post-apoc | tense | survivors' → 'the room'
  ✓ 'Generated room — fantasy-keep | grim | dungeon' → 'the room'
  ✓ 'Ashfall Market | post-apoc | grim' → 'the Ashfall Market'
  ✓ 'Throne Room' → 'the Throne Room'
  ✓ 'A quiet stone antechamber' → 'A quiet stone antechamber'
  ✓ 'Ransacked Safe House' → 'the Ransacked Safe House'
  ✓ 'Ashfall Market — South Gate' → 'the Ashfall Market — South Gate'

buildRoomSummary (intro clause regression)
  ✓ room.name = 'Generated room — post-apoc | tense | survivors'
      → summary.text starts with 'You enter the room.'
      → does NOT contain 'Generated room', 'post-apoc', 'tense', 'survivors', '|', or '—'
  ✓ room.name = 'Generated room'
      → summary.text starts with 'You enter the room.'
  ✓ room.name = 'Throne Room'
      → summary.text contains 'You enter the Throne Room.'
  ✓ fallback room (name = 'A quiet stone antechamber')
      → not-throw; intro unchanged
  ✓ existing object-name / interaction-body no-leak tests still pass
```

---

## 6. Verification commands

```bash
# from apps/web
npm run test -- roomSummary
npm run lint
npm run build
```

---

## 7. Manual smoke expectations

These are expected behaviors for manual QA; not a claim the smoke pass was run during docs closeout.

- PromptBar-generate a post-apoc room → intro reads `"You enter the room. A <object> …"` — no
  `"Generated room"`, no tags.
- PromptBar-generate a fantasy room → same.
- Navigate to an adjacent generated room → intro natural.
- Bootstrap/authored throne room → `"You enter the Throne Room."` — unchanged.
- Force fallback room → `"You enter A quiet stone antechamber."` or similar — unchanged.
- Dismiss intro panel; re-enter room → intro re-appears (existing reset behavior unchanged).

---

**Manual smoke checklist recorded for closeout:**
- [ ] PromptBar-generate a post-apoc room: intro reads `"You enter the room..."`, with no
  `"Generated room"` marker or seed tags.
- [ ] PromptBar-generate a fantasy room: same generic intro behavior.
- [ ] Navigate to an adjacent generated room: intro remains natural and tag-free.
- [ ] Bootstrap/authored throne room: intro remains `"You enter the Throne Room."`.
- [ ] Force fallback room: intro remains natural for `"A quiet stone antechamber"`.
- [ ] Dismiss and re-enter: existing intro panel reset behavior is unchanged.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Future authored name starts with `"Generated room"` | Documented in ADR; authored names are ours and never use this prefix in practice |
| Authored name contains ` \| ` separator | Documented in ADR; ` \| ` is the worldBibleToGeneratorSeed separator and must not appear in authored names; rule 3 would drop the tag tail (safe outcome) |
| `withArticle` behavior changes in future | `introRoomNoun` delegates to it for all authored/real names; any change to `withArticle` is reflected here automatically |
| Real-provider name with ` \| ` (LLM generates a pipe) | Rule 3 clips after the first pipe and returns the leading prose; a sensible degradation, not a safety issue |

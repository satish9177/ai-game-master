# Implementation Plan — `feature/time-context-and-day-night-presentation-v0`

> Status: **PROPOSED — design approved, not implemented.**
> Consumes the completed, read-only `world-clock-v0` projection to make time
> **visible** (a minimal HUD day/night treatment) and **available as read-only,
> ambient/tone-only context** to NPC dialogue, exposing **only** the closed
> `timeOfDay` enum (`dawn | day | dusk | night`). No time-advancement change, no
> renderer lighting, no room/object generation context, and no state / schema /
> event / command / persistence change.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) · [BOUNDARIES](../BOUNDARIES.md) ·
> [FAILURE-MODES](../FAILURE-MODES.md) · [CONVENTIONS](../CONVENTIONS.md) · [/AGENTS.md](../../../AGENTS.md).
> Builds on `world-clock-v0`
> ([implementation plan](./world-clock-v0.md)) and the authoritative event-log
> model ([ADR-0013](../decisions/ADR-0013-world-state-event-log-v0.md)). Reuses
> the bounded, enum-only, non-authoritative dialogue-context-section pattern
> established by the NPC relationship hint.
>
> **ADR proposed:** [ADR-0076 — Read-only `timeOfDay` exposure for NPC dialogue
> context](../decisions/ADR-0076-read-only-timeofday-dialogue-context-v0.md).
> `world-clock-v0` deliberately deferred "dialogue/provider/context injection of
> time" and predicted it would be its own ADR; this feature closes that specific
> deferral and records the new invariant that the provider can never set, advance,
> or read back time.

---

## 1. Title and status

**Time Context & Day/Night Presentation v0 — consume the closed `world-clock-v0`
read-only projection to (a) give the HUD a minimal day/night presentation and
(b) expose only the closed `timeOfDay` enum as a bounded, read-only,
non-authoritative NPC dialogue context section.**

Status: **PROPOSED / design approved / NOT implemented.** No source, test, config,
or dependency file is touched by this document. Implementation is a separate,
maintainer-approved step.

---

## 2. Problem statement

`world-clock-v0` derives `{ day, hour, timeOfDay }` as a pure projection over the
authoritative `WorldEvent` log and surfaces it on the HUD. Nothing consumes it
yet: NPCs cannot atmospherically reference that it is dusk, and the HUD clock is a
plain text line with no day/night affordance.

`world-clock-v0` explicitly deferred "dialogue/provider/context injection of time"
and "day/night rendering." This feature closes the **smallest safe** part of that
deferral: make time **visible** (light HUD treatment) and **available as read-only
tone context** to NPC dialogue, using only the coarse `timeOfDay` band.

The traps to avoid are well understood and are hard boundaries here:

- letting the provider **set or advance** time,
- letting `day` / `hour` integers reach prompts,
- feeding time into **deterministic room/object generation**,
- drifting into **renderer lighting**, **lazy room transitions**, or **NPC
  routines/schedules**.

None of that is in v0.

---

## 3. Current architecture recap (from `main`)

Grounded in the code as it exists today:

- **The clock is pure and read-only.** `computeWorldClock(log)`
  (`apps/web/src/domain/world/worldClock.ts`) imports only the `WorldEvent` type,
  counts `moved-to-room` events, and returns `{ day, hour, timeOfDay }`.
  `timeOfDayForHour` maps each hour to the closed enum
  `dawn | day | dusk | night`. It reads no `Date.now()`, holds no state, and does
  no I/O.
- **HUD exposure already exists.** `App.tsx` holds a `worldClock` state, refreshed
  by the monotonic-guarded `applyWorldClockFromSession` seam at the existing
  derived-view refresh sites (bootstrap / start / load / navigation), and passes
  `clock={worldClock}` to `StatusHud`. `StatusHud.tsx` renders it presentationally
  via `formatWorldClock` with a nullable `clock` prop and a **local**
  `TIME_OF_DAY_LABEL` map — i.e. presentation strings already live in the UI
  layer, not in pure domain.
- **Dialogue context is a pure projection with a separate serializer.**
  `buildDialogueContext` (`apps/web/src/domain/dialogue/buildDialogueContext.ts`)
  projects authoritative `WorldState` plus optional room / quest / memory /
  relationship inputs into `NPCDialogueContext`
  (`apps/web/src/domain/dialogue/contracts.ts`).
  `buildDialoguePromptMessages` (`apps/web/src/generation/llmDialoguePrompt.ts`)
  serializes that context into bounded, headered sections (`CURRENT ROOM`,
  `QUEST`, `PLAYER`, `RECENT CONVERSATION`, `BACKGROUND ROOM MEMORY`,
  `RELATIONSHIP HINT`) with single-line collapsing, per-line character clamps, and
  explicit "NON-AUTHORITATIVE / TONE GUIDE ONLY" headers.
- **The relationship-hint path is the exact precedent.** `relationshipState`
  flows: `RoomViewer.tsx` (dialogue trigger) → `buildNPCDialogueReplyInput`
  (`apps/web/src/app/npcDialogueReplyInput.ts`) → `NPCDialogueInput` →
  `NPCDialogueService.reply` → `buildDialogueContext` (projected to bucket enums)
  → a bounded, enum-only prompt section in `llmDialoguePrompt.ts`. Time context
  will follow the identical seam.
- **Room/object context is pure over the room and time-free.**
  `buildRoomDialogueContext(room)`
  (`apps/web/src/domain/dialogue/buildRoomDialogueContext.ts`) is pure over
  `LoadedRoom` and takes no time input. Room generation is deterministic and does
  not read the clock.
- **Precedent for docs weight.** The relationship hint — a bounded, enum-only,
  non-authoritative dialogue section — shipped plan-only. This feature adds an ADR
  anyway because `world-clock-v0` explicitly flagged time-in-provider-context as a
  boundary to record (see §15 and the ADR).

**Key structural fact:** because time is already a pure projection and the HUD
already consumes it, this feature only needs to (a) add a presentational HUD
treatment and (b) pass an already-derived enum along an existing dialogue seam. No
new authority, no new persistence, no new advancement.

---

## 4. Proposed v0 scope

1. **Pure enum projector (chokepoint).** `toPromptTimeContext(clock)` living near
   `worldClock.ts`, returning **only** `{ timeOfDay }`. This is the single place
   that strips `day` / `hour` before anything provider-facing. (Added during
   implementation per approved decision 6.)
2. **HUD day/night presentation.** A minimal, presentational treatment of the
   existing clock line — a `data-time-of-day` attribute (or band class) styled in
   `index.css` — confined to `StatusHud.tsx` + `index.css`. The HUD may display
   `day` / `hour` / `timeOfDay`.
3. **NPC dialogue time awareness.** Thread **only** `timeOfDay` from the
   composition root through the existing relationship-style path into **one**
   small, bounded, read-only prompt section, always included when a valid
   `timeOfDay` is present.
4. **Prompts receive only `timeOfDay`.** `day` / `hour` never enter the dialogue
   data flow at all (by construction — see §6).
5. **One bounded system-prompt line** reinforcing that time of day is ambient
   scene context only and must never be claimed to pass, change, or be instructed.

NPC dialogue is the **only** provider-facing time consumer in v0.

---

## 5. Explicit non-goals (hard "not this feature")

Each is a possible future slice with its own approval:

- ❌ No change to `world-clock-v0` advancement (still travel-only, `moved-to-room`,
  `+HOURS_PER_MOVE`).
- ❌ No `day` / `hour` in any prompt / provider payload.
- ❌ No `WorldState` field, `WorldEvent`, `WorldCommand`, or `applyEvent` change.
- ❌ No `SaveGame` / schema / `schemaVersion` / SQLite / persistence / migration
  change.
- ❌ No `Date.now` / `setInterval` / timer / wall-clock / background simulation.
- ❌ No Three.js / renderer lighting or day/night rendering (see §8).
- ❌ No room / environment mutation; time is **not** fed into room/object
  generation or object state.
- ❌ No lazy fire/body/cleanup or room re-theming transitions.
- ❌ No NPC schedules / routines / patrol / chase / awareness.
- ❌ No memory / facts / fact_visibility writes.
- ❌ No provider path that **sets, advances, or reads back** time.
- ❌ No `CanonSeed` start-hour configuration.
- ❌ No second provider-facing time surface (room/object/inspect prompt injection).

---

## 6. Time context data shape

A dedicated, enum-only, prompt-safe shape is the firewall that makes `day` /
`hour` leakage structurally impossible:

```ts
// near apps/web/src/domain/world/worldClock.ts (added during implementation)
export type PromptTimeContext = { timeOfDay: TimeOfDay } // TimeOfDay reused from worldClock.ts

export function toPromptTimeContext(clock: WorldClock): PromptTimeContext {
  return { timeOfDay: clock.timeOfDay } // day/hour intentionally dropped
}
```

- **HUD** keeps consuming the existing `WorldClock` (`day` / `hour` / `timeOfDay`)
  — unchanged.
- **Provider path** carries only `timeOfDay`. `NPCDialogueContext` gains an
  optional `timeOfDay?: TimeOfDay`, **not** the full clock. Because `day` / `hour`
  are never placed on any dialogue-facing structure, they cannot leak even through
  a future serializer bug.
- **Pure domain holds no UI strings.** Presentation labels stay in `StatusHud`
  (matches existing repo style; `TIME_OF_DAY_LABEL` already lives there).

---

## 7. Authority / read-only model

Unchanged from `world-clock-v0`: the clock is a non-authoritative projection
strictly below `WorldState`. This feature adds **only read paths**.

| Concept | Authoritative? | Mutates truth? | Persisted? | Derived from |
| --- | :---: | :---: | :---: | --- |
| `WorldEvent` log / `WorldState` | **Yes** | Yes (reducer) | Yes | validated commands |
| `WorldClock` / `PromptTimeContext` | **No — projection** | **No** | **No (re-derived)** | `moved-to-room` events only |

Locked invariants:

- Time never becomes a `WorldEvent`, `WorldCommand`, `WorldState` field,
  `CanonSeed`, save-game field, SQLite row, or API payload.
- Time never gates navigation, interactions, encounters, quests, inventory, or
  exits.
- The provider can neither **set** nor **advance** nor **read back** time.
- `buildDialogueContext` and `buildNPCDialogueReplyInput` **must not** import
  `worldClock` / session / log to fetch time. The already-derived enum is passed
  in from the composition root (`App`).

---

## 8. HUD / visual presentation plan

- In `StatusHud.tsx`: keep the existing `formatWorldClock` line; add a
  presentational hook — a `data-time-of-day={clock.timeOfDay}` attribute (or a
  `status-hud-clock--{band}` modifier class) on the clock element.
- In `index.css`: style the four bands minimally (e.g. subtle color / opacity via
  CSS only). Read-only, `pointer-events: none`, no new DOM semantics.
- **Neutral labeling.** Show only the band name (e.g. "Dusk"). Do **not** add
  implied-behavior copy ("Shops closing", "Guards patrolling") — none of that
  exists in the sim, and such copy would falsely imply gameplay.
- **No renderer lighting (justification for the default "no").** Day/night
  lighting means touching the trusted Three.js renderer and per-frame state; it is
  a separate boundary ([ADR-0001](../decisions/ADR-0001-data-only-room-spec-trusted-renderer.md),
  [ADR-0002](../decisions/ADR-0002-react-three-boundary.md)), a far larger
  surface, and delivers no context value for v0. It stays deferred. The HUD
  treatment is DOM/CSS only.

---

## 9. Room / object context decision

**Presentation-only. No provider or generation time context in v0.**

- **No time input to room/object generation or object state.**
  `buildRoomDialogueContext`, `RoomSpec`, and the generation pipeline stay
  untouched. Feeding time into generation would inject non-determinism into
  deterministically-generated content and risk lazy transitions — both hard
  non-goals.
- **Room/object "time context" in v0 is satisfied entirely by the HUD band**
  (§8). Any future ambient time descriptor in inspect/room text is a **separate
  slice** with its own review, because it would add a second provider-facing
  surface and additional prompt budget.
- Net: the **only** provider consumer of time in v0 is the single NPC dialogue
  section (§10). This deliberately keeps the injection surface and prompt-budget
  cost to one bounded line.

---

## 10. NPC dialogue time-awareness plan

Thread `timeOfDay` along the proven relationship path, projecting to the enum at
the **composition root** so `day` / `hour` never enter the dialogue layer:

1. `App` computes `toPromptTimeContext(worldClock)` and passes `timeOfDay`
   (or `null`) as a prop to `RoomViewer`. The `worldClock` state is already
   refreshed on navigation, and dialogue never advances time, so the value is
   current at dialogue time.
2. `RoomViewer` passes `timeOfDay` into `buildNPCDialogueReplyInput` (new optional
   field) → `NPCDialogueInput` → `NPCDialogueService.reply` → `buildDialogueContext`
   (new optional param) → sets `NPCDialogueContext.timeOfDay`.
3. `llmDialoguePrompt.ts` adds a `buildTimeSection(timeOfDay)`: a single bounded
   line under a clear, non-authoritative header, e.g.:

   ```
   TIME OF DAY - AMBIENT, READ-ONLY, NOT AUTHORITATIVE
   timeOfDay: dusk
   ```

   The value is rendered via a fixed label/enum map (no raw string
   interpolation), so it cannot carry a payload.
4. **One system-prompt line** appended to `DIALOGUE_SYSTEM_PROMPT`: *"Time of day
   is ambient scene context only; never claim time has passed or changed, and
   never instruct any time change."*
5. **Always included when valid** (approved decision 8). The section is emitted
   whenever a valid `timeOfDay` is present; `day` is **not** omitted in v0. This
   keeps behavior deterministic and trivially testable; the one-line cost is
   bounded by the prompt-budget test.

---

## 11. Prompt / context safety rules

- **`day` / `hour` never reach prompts — structurally.** They are dropped by
  `toPromptTimeContext` at the composition root; no dialogue-facing type carries
  them.
- **Header-fabrication is not possible for this section.** The only interpolated
  value is a closed enum produced by pure domain (a `switch` / `Record`), never
  free text — unlike memory, it cannot carry an injected section header. It is
  still rendered via a fixed label map keyed by the four values, and covered by a
  red-team assertion.
- **Budget bounded.** One header + one line; covered by the prompt-budget
  evaluation.
- **Provider cannot control time.** Read-only section + the system-prompt line +
  the existing "do not claim / instruct state mutations" rule in
  `DIALOGUE_SYSTEM_PROMPT`.
- **No raw event log pulled into builders.** Builders receive the pre-derived
  enum; they must not import `worldClock` / session / log. Enforced by the existing
  domain import-boundary and scope-stability checks.

---

## 12. Logging / debug safety rules

- Only the closed `timeOfDay` enum (plus counts / booleans / stable status codes)
  may be logged. Never the digest text, section strings, room/object/NPC names,
  dialogue text, prompts, or provider bodies.
- No new `console.*`; use the logger abstraction.
- The log-safety evaluation is extended to assert the new section/flow logs
  nothing beyond the enum.

---

## 13. Test plan (deterministic, repo-grounded)

- **`toPromptTimeContext`** returns `{ timeOfDay }` with **no** `day` / `hour`
  keys, for all four bands (co-located with `worldClock` tests).
- **`buildDialogueContext`**: `timeOfDay` placed on context when passed, omitted
  when absent; determinism (same inputs → equal context); a boundary test that the
  builder does not import/fetch the clock/session/log.
- **`llmDialoguePrompt`**: the section renders exactly one bounded line per band;
  the serialized digest contains **no** integer day/hour; header text is fixed; the
  section is always present when `timeOfDay` is valid; the new system-prompt line
  is present.
- **Red-team (`promptContext.redteam`)**: the time section cannot fabricate another
  section header; the enum is not attacker-controllable.
- **Prompt budget**: total prompt stays within budget with the new section.
- **Log safety / no-side-effects**: no unsafe logging; no state mutation; no
  events/commands emitted.
- **`StatusHud`**: the band attribute/class renders per `timeOfDay`; still
  read-only; label neutral.
- **Regression**: existing `worldClock` / `StatusHud` / dialogue suites stay
  green; `npm run lint` and `npm run build` clean.

---

## 14. Implementation slices

- **Slice 1 — pure projector + tests.** `toPromptTimeContext` / `PromptTimeContext`
  near `worldClock.ts`; unit tests (especially day/hour absence). Unwired.
- **Slice 2 — HUD day/night presentation.** `StatusHud.tsx` band hook +
  `index.css`; presentation-only tests. No renderer change.
- **Slice 3 — NPC dialogue time awareness + prompt safety.** Thread `timeOfDay`
  root → `RoomViewer` → reply input → service → `buildDialogueContext` →
  `NPCDialogueContext`; add `buildTimeSection` + the system-prompt line in
  `llmDialoguePrompt.ts`; all §13 prompt / red-team / budget / log tests.
- **Slice 4 — docs closeout.** Finalize this plan's closeout and the ADR
  (already drafted as ADR-0076).

**Deferred future features (each its own plan/approval):** room/object time
context or ambient inspect text; day/night renderer lighting; NPC routines /
schedules; configurable start hour via `CanonSeed`; a `rest`/`wait` action.

---

## 15. Minimum Safe Change Check (per AGENTS.md)

- **Reused:** the `world-clock-v0` projection and its `TimeOfDay` enum; the
  existing HUD `clock` prop and `StatusHud` presentation seam; the relationship
  hint's bounded, enum-only, non-authoritative dialogue-section pattern; the
  established dialogue seam (`RoomViewer` → `buildNPCDialogueReplyInput` →
  `NPCDialogueInput` → `NPCDialogueService` → `buildDialogueContext` →
  `llmDialoguePrompt`); the existing prompt-budget / log-safety / red-team / scope
  evaluations.
- **Minimum new code:** one pure enum-projector + tests; one optional
  `timeOfDay?` field threaded through the existing dialogue types; one bounded
  prompt section + one system-prompt line; one HUD data-attribute/class + one CSS
  rule.
- **Safety boundaries unchanged:** no `WorldEvent` / `WorldCommand` / `applyEvent`
  / `WorldState`; no schema / save / persistence / migration; no timer / wall
  clock; no renderer/engine change; no memory/facts writes; provider cannot set,
  advance, or read back time; `day`/`hour` structurally excluded from prompts.
- **Tests prove it:** §13.

---

## 16. Risk analysis

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | Day/hour leak to prompts | Dropped at root by `toPromptTimeContext`; no dialogue type carries them; absence test. |
| 2 | Provider controls/advances time | Read-only section + system-prompt line + existing mutation ban; advancement code untouched. |
| 3 | Header fabrication / injection | Enum-only via fixed label map (not free text); red-team test. |
| 4 | Prompt budget growth | One bounded line; prompt-budget evaluation gate. |
| 5 | Log-safety regression | Enum-only logging; log-safety evaluation extended. |
| 6 | Builder pulls raw event log | Pre-derived enum passed in; builders must not import clock/session/log; import-boundary test. |
| 7 | UI implies gameplay (shops/guards) | Band name only; no behavioral copy. |
| 8 | Room mutation / routines / lazy transitions / lighting | None wired; generation/renderer/NPC untouched; explicit non-goals + tests. |
| 9 | Schema/save/event/command change | None; nothing authoritative added. |
| 10 | Date.now/setInterval/timer | None; derivation stays pure over the log. |

---

## 17. Open questions — resolved

- **a. Omission rule** → **Always include** the `timeOfDay` section when a valid
  band is present. `day` is **not** omitted in v0 (approved decision 8).
- **b. ADR** → **Yes.** ADR-0076 records the boundary this touches (approved
  decision 9; see §15 and the ADR).
- **c. HUD styling** → **Minimal only** — a data attribute / class plus CSS; no
  icons/assets, no renderer (approved decisions 10–11).
- **d. Dialogue seam** → **`RoomViewer` / `App` composition-root seam accepted**;
  `timeOfDay` is projected at the root and threaded through the existing reply-
  input → service → `buildDialogueContext` path (approved decisions 14–15).

---

## 18. Final recommendation

**Approve the scope as written.** The safe, minimal shape is: one pure
enum-projector, a CSS-only HUD band, and one bounded read-only dialogue section
fed by the enum through the existing relationship path — with `day` / `hour`
structurally excluded from the provider data flow. Keep room/object exposure to
presentation only; defer renderer lighting, room-time generation, and NPC
routines. Land Slices 1 → 3 with the §13 tests green, then close this plan and
ADR-0076. No source, test, config, or dependency file is modified by this
document.

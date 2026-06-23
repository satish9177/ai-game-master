# Implementation Plan — `feature/world-bible-seed-v0`

> Status: **implemented.** Slices 1–6 are complete on
> `feature/world-bible-seed-v0`; commits are made manually by the maintainer.
>
> Companion docs: [ARCHITECTURE](../ARCHITECTURE.md) ·
> [BOUNDARIES](../BOUNDARIES.md) · [FAILURE-MODES](../FAILURE-MODES.md) ·
> roadmap context: `room-generation-repair-fallback-v0` (ADR-0020),
> `adjacent-room-pregeneration-v0` (ADR-0021). Decision:
> [ADR-0022](../decisions/ADR-0022-world-bible-seed-v0.md).

## Goal

Introduce a small, **deterministic, browser-only** World Bible seed layer that
turns the user's room prompt into a structured, compact, validated `WorldBibleSeed`
(*initial canon*) used to seed the existing prompt-generated room path. This is
preparation for `real-room-generator-provider-v0`; **v0 adds no real LLM**.

---

## 1. Current prompt-to-room flow

The prompt path lives entirely in the composition root and the generation seam.
The renderer/engine are untouched by it.

```
PromptBar.onSubmit(trimmedPrompt)                         app/PromptBar.tsx
  → App.handlePrompt(prompt)                              App.tsx
       logger.info('prompt submitted', { promptLength }) // length only
       → prepareGeneratedRoomSeed(prompt, seeder, logger) app/worldBible.ts
            → FakeWorldBibleSeeder.seed(prompt)          generation/
                 → WorldBibleSeedSchema.parse            strict/bounded
            → worldBibleToGeneratorSeed(worldBible)      deterministic, ≤160 chars
            └─ failure → raw prompt seed + no worldBible
       → new GeneratedRoomSource(generator, generatorSeed, logger, fallbackRoom)
            → FakeRoomGenerator.generate(generatorSeed)  raw JSON text
            → assembleRoom(rawText, fallbackRoom)
                 JSON.parse → loadRoomSpec → validateRoom → repairRoom → fallback
            → { ok:true, room, provenance }              generated|repaired|fallback
       → startRoomSession(result.room)                   unchanged fresh session
       → setActivePlay({ roomSource, sessionId, roomCache, worldBible? })
       → if repaired|fallback: setNotice(FALLBACK_NOTICE)
```

Facts this plan relies on:

- The PromptBar prompt is input to `WorldBibleSeeder`; the validated bible's
  compact projection is the normal `RoomGenerator` seed. If seeding fails, the
  raw prompt remains the safe compatibility seed. `RoomGenerator` itself is unchanged.
- Prompt/bible/derived-seed **text is never logged**. Logs contain prompt/seed
  lengths, safe enums/counts/codes, and assembly diagnostics only.
- The prompt path is a **fresh single-room session + fresh cache, no navigation
  and no warming**. The authored two-room bootstrap path (`bootstrapExamplePlay`)
  is separate and uses `AdjacentRoomPregenerator`.
- `generation/**` may import the domain + PRNG but **must not import the logger**
  (BOUNDARIES). Both fake adapters are pure/silent; prompt composition logs.

## 2. Current backend / session boundary

- **Authoritative truth is event-sourced.** `WorldSession` appends validated
  `WorldEvent`s; `WorldState` is a pure projection (`domain/world/`). `CanonSeed`
  (`domain/world/worldState.ts`) initializes the first `session-started` event and
  never overrides later play. The browser uses `InMemoryWorldStore`.
- `CanonSeed` fields: `schemaVersion`, `worldId` (UUID), `name`, `startingRoomId`,
  `initialPlayer{health,status,inventory}`. `startRoomSession` (`App.tsx`) derives
  `name` from `room.name` and `startingRoomId` from `room.id`.
- **RoomSpec is data-only** (`domain/roomSpec.ts`); two authored vocabularies
  exist — fantasy (`throne/pillar/rug/torch/arch/scroll/npc/prop`) and
  post-apocalyptic (`crate/barrel/debris/barricade/zombie`).
- **The backend (SQLite + `node:http` API) is Node-only, headless, and not wired
  to the browser** (ADR-0018/0019). The browser composition root may **not**
  import persistence/server (reciprocal ESLint walls).
- **`assembleRoom`/`validateRoom`/`repairRoom`/`fallbackRoom` live in `domain/`**
  precisely because they are pure, renderer-agnostic invariants a future backend
  reuses (ADR-0020). The World Bible schema/projection follow the same placement.

## 3. Meaning of `WorldBibleSeed` in v0

A small, deterministic, browser-only layer that converts the prompt into a
**compact, bounded, validated `WorldBibleSeed`** — *initial canon only*:

- Fields: world `title`, `themePack`, `tone`, `premise`, `startingLocation`,
  `majorConflict`, a few `factions`, 2–3 `npcs` seeds, 2–4 `locations` seeds,
  `generationHints` (allowed theme pack + a few keywords), a bounded
  `openingArc`, and `canonNotes` (safety/canon).
- It is **pure data** (numbers/strings/enums/bounded arrays), produced
  deterministically (same prompt → byte-identical bible), validated by a zod
  schema — mirroring how `FakeRoomGenerator` output is validated by `loadRoomSpec`.
- It **feeds generation as compact structured context** by deriving a single
  compact, deterministic **seed string** that replaces the raw prompt as the
  generator's input, and it is **held in browser composition state** as the
  session's initial canon.
- It is **initial canon, not current truth.** `WorldState` and the event log
  remain authoritative; the bible is never written as an event and never read back
  as "the current world".
- `openingArc` is only the initial hook/objective/pressure that seeds the first
  generated room. It is not quest state, a branching story plan, an event-log
  entry, or an assertion about what remains true after play begins.

## 4. Non-goals

This slice must **not**:

- Add a **real LLM**, a generation/bible backend endpoint, or any network call.
- Wire **backend / API / SQLite / persistence / save-game** to the bible.
- Change the **renderer / RoomViewer / engine / builders**.
- Change **world-session / event-log authority** (no new event type, no bible in
  `WorldState`, no `CanonSeed`/`startRoomSession` change — see decision 3 below).
- Add a quest engine, branching story planner, or persistence/current-state
  semantics for `openingArc`.
- Add **new UI** (no bible panel, no world-title chip).
- Widen or change the **`RoomGenerator` port** or `FakeRoomGenerator`'s vocabulary
  / theme branching (the fake does **not** branch on `themePack` in v0).
- Build a **many-genre system** (exactly two theme packs), a large prompt/context
  system, or any **memory / vector / graph** work.
- Bypass `assembleRoom` / `repairRoom` / `fallbackRoom` — generated rooms still
  flow through them.
- **Log** the raw prompt, any World Bible text (title/premise/conflict/NPC/faction/
  location/opening-arc text/keywords), derived seed, generated JSON, or thrown
  error details.
- Apply the bible to the **authored bootstrap** or `AdjacentRoomPregenerator`
  (prompt path only — see decisions 5/6).

## 5. Implemented option — B

**Shared domain `WorldBibleSeed` + generator port + browser fake implementation.**

- Pure **domain** schema/types + a pure **projection** (`worldBibleToGeneratorSeed`).
- A `WorldBibleSeeder` **port** in `domain/ports/` mirroring `RoomGenerator`.
- A deterministic **fake** in `generation/` mirroring `FakeRoomGenerator`
  (pure, seeded, silent — no logger import).
- Wire **only** the prompt path in `App.handlePrompt`; store the seed in
  composition state (`ActivePlay.worldBible`); feed a derived compact seed string
  to the existing `GeneratedRoomSource` (unchanged).

Why B (over A inline-in-`app/`, C backend-persist-now, D defer): the
schema/projection are pure invariants a future backend reuses (the `assembleRoom`
precedent); the port lets a real LLM seeder slot in with the schema as the trust
boundary; the change touches only `App.handlePrompt` + new files. C and D violate
the hard constraints / roadmap.

| Piece | Location |
| --- | --- |
| `WorldBibleSeedSchema` + inferred types | `apps/web/src/domain/worldBible/worldBibleSeed.ts` |
| `worldBibleToGeneratorSeed(bible): string` | `apps/web/src/domain/worldBible/worldBibleToSeed.ts` |
| `WorldBibleSeeder` port | `apps/web/src/domain/ports/WorldBibleSeeder.ts` |
| `FakeWorldBibleSeeder` (deterministic impl) | `apps/web/src/generation/FakeWorldBibleSeeder.ts` |
| live seed instance | browser composition state (`ActivePlay.worldBible?`) |

New files under `src/domain/**` and `src/generation/**` are already covered by the
existing ESLint boundary blocks — **no new lint rule is needed** (mirrors
ADR-0020/0021).

## 6. Exact v0 behavior

On prompt submit (`App.handlePrompt`):

1. `logger.info('prompt submitted', { promptLength })` — unchanged.
2. `worldBible = await worldBibleSeeder.seed(prompt)` — deterministic, validated
   against `WorldBibleSeedSchema` **inside the fake** (decision 1: the port
   returns a typed, already-validated `WorldBibleSeed`).
3. `seed = worldBibleToGeneratorSeed(worldBible)` — compact deterministic string,
   **title-first** so the generated room's label reads as the world title, with
   `openingArc.pattern:firstObjective` included as compact initial-canon context.
4. `source = new GeneratedRoomSource(generator, seed, logger, fallbackRoom)` —
   `GeneratedRoomSource` is **unchanged**; it still takes a seed string and runs
   `assembleRoom`.
5. The rest of `handlePrompt` is unchanged (start session, `setActivePlay`,
   fallback notice). `ActivePlay` gains `worldBible?: WorldBibleSeed`, stored for
   the session.
6. One safe log line: `logger.info('world bible seeded', { themePack, tone,
   npcCount, locationCount, factionCount, keywordCount, seedLength })` — **no
   bible text, no prompt text, no derived seed string**.

Determinism chain: `prompt → bible (deterministic) → seed string (pure) → room
(deterministic)`. Same prompt → byte-identical bible → identical seed →
byte-identical room.

**Theme mapping (decision 2), two-way only:** the fake scans the lowercased
prompt for post-apocalyptic keywords (e.g. `zombie`, `ruin`, `apocalypse`,
`survivor`, `raider`, `wasteland`, `infected`, `outbreak`, `fallout`); a match →
`post-apoc`, otherwise → `fantasy-keep`. The chosen pack also sets
`generationHints.allowedThemePack`. In v0 this only deterministically perturbs the
generator via the seed string and is recorded as canon; `FakeRoomGenerator` does
**not** branch on it.

The **authored bootstrap path and `AdjacentRoomPregenerator` are not changed**
(decisions 5/6) — no bible there in v0.

## 7. `WorldBibleSeed` schema

`apps/web/src/domain/worldBible/worldBibleSeed.ts` (zod 4; every string
length-capped and every array size-capped to keep it compact and prevent
uncontrolled context growth):

```ts
export const WORLD_BIBLE_SCHEMA_VERSION = 1 as const

export const ThemePackSchema = z.enum(['fantasy-keep', 'post-apoc'])
export const ToneSchema = z.enum(['heroic', 'grim', 'mysterious', 'tense', 'hopeful'])
export const DispositionSchema = z.enum(['ally', 'neutral', 'hostile'])

const NpcSeedSchema = z.object({
  name: z.string().min(1).max(40),
  role: z.string().min(1).max(60),
  disposition: DispositionSchema,
}).strict()

const LocationSeedSchema = z.object({
  label: z.string().min(1).max(60),
  kind: z.string().min(1).max(40),
}).strict()

const GenerationHintsSchema = z.object({
  allowedThemePack: ThemePackSchema,
  keywords: z.array(z.string().min(1).max(24)).max(6),
}).strict()
const OpeningArcSchema = z.object({
  pattern: z.enum(['escape', 'investigate', 'survive', 'rescue', 'recover-item']),
  hook: z.string().min(1).max(120),
  firstObjective: z.string().min(1).max(120),
  pressure: z.string().min(1).max(120),
}).strict()


export const WorldBibleSeedSchema = z.object({
  schemaVersion: z.literal(WORLD_BIBLE_SCHEMA_VERSION),
  title: z.string().min(1).max(60),
  themePack: ThemePackSchema,
  tone: ToneSchema,
  premise: z.string().min(1).max(240),
  startingLocation: z.string().min(1).max(120),
  majorConflict: z.string().min(1).max(240),
  factions: z.array(z.string().min(1).max(60)).max(3),      // may be empty
  npcs: z.array(NpcSeedSchema).min(2).max(3),
  locations: z.array(LocationSeedSchema).min(2).max(4),
  generationHints: GenerationHintsSchema,
  canonNotes: z.array(z.string().min(1).max(120)).max(4),   // may be empty
  openingArc: OpeningArcSchema,
}).strict()

export type WorldBibleSeed = z.infer<typeof WorldBibleSeedSchema>
```

`apps/web/src/domain/ports/WorldBibleSeeder.ts`:

```ts
export interface WorldBibleSeeder {
  /** Turn a user prompt into compact, validated initial canon. Never executable code. */
  seed(prompt: string): Promise<WorldBibleSeed>
}
```

`apps/web/src/domain/worldBible/worldBibleToSeed.ts` — pure, deterministic,
bounded (~160 chars), title-first:

```ts
export function worldBibleToGeneratorSeed(b: WorldBibleSeed): string {
  return [
    b.title,
    b.themePack,
    b.tone,
    `${b.openingArc.pattern}:${b.openingArc.firstObjective}`,
    b.premise,
    b.generationHints.keywords.join(','),
  ]
    .join(' | ')
    .slice(0, 160)
}
```

## 8. Log-safety rules

- Prompt handling unchanged at the edge: `PromptBar` trims/validates non-empty;
  `App` logs `promptLength` only.
- The bible may carry bounded prompt-derived **inert text** (the fake uses it for
  the title); it is data only, never code.
- **The whole bible is user-derived content → never logged in full.** Logs carry
  only: `themePack`, `tone`, `npcCount`, `locationCount`, `factionCount`,
  `keywordCount`, `seedLength`, booleans, and stable codes. **Never** title,
  premise, conflict, NPC/faction/location/opening-arc text, keywords, the raw
  prompt, or the derived seed string.
- The **seeder is silent** (no logger import, per the `generation/**` boundary).
  The composition root emits the one safe log line.
- `GeneratedRoomSource` keeps logging `promptLength` — now the length of the
  compact derived seed normally, or the raw prompt length on degradation.

## 9. Failure / degrade behavior

The bible is **strictly additive and non-blocking** — its absence degrades to
today's behavior.

| Situation | Detection | Handling | Logging |
| --- | --- | --- | --- |
| Seeder throws/rejects (future LLM) | `try/catch` in `prepareGeneratedRoomSeed` | **Degrade to the previous path**: feed the raw `prompt` to `GeneratedRoomSource`; store no bible; proceed | fixed `world-bible-unavailable` code only |
| Seeder returns schema-invalid bible | `WorldBibleSeedSchema.parse` inside the fake throws → caught as above | same degrade-to-prompt path | code only |
| Empty/edge prompt | `PromptBar` blocks empty; fake clamps and uses a theme-default title | valid minimal bible | counts only |
| Room generation still bad | unchanged | `assembleRoom` → repaired/fallback room + existing notice | unchanged |

A bible failure never blocks gameplay, never reaches the renderer, and never
produces an error screen on its own — the room pipeline's existing guarantees
stand.

## 10. Test plan (Vitest, no DOM/e2e)

- **`worldBibleSeed` schema:** accepts a valid bible and round-trips it; rejects
  extra keys at top level and in nested objects (`.strict()`); rejects empty /
  over-length strings; enforces array bounds (npcs 2–3, locations 2–4, factions
  ≤3, keywords ≤6, canonNotes ≤4); closed enums (`themePack`/`tone`/`disposition`/
  `allowedThemePack`/`openingArc.pattern`); requires each field; rejects unknown
  opening-arc keys and hook/objective/pressure over 120 characters; wrong
  `schemaVersion` rejected; allows empty `factions`/`canonNotes`.
- **`worldBibleToGeneratorSeed`:** deterministic, pure, length-bounded,
  title-first, stable ordering, compact opening-arc context, no input mutation.
- **`FakeWorldBibleSeeder`:** determinism (same prompt → byte-identical bible);
  purity (no `Date.now`/`Math.random`/IO/logger); output always passes
  `WorldBibleSeedSchema`; counts within bounds; **theme mapping picks exactly one
  pack** (post-apoc keyword → `post-apoc`, else `fantasy-keep`, and
  `generationHints.allowedThemePack` agrees); opening arc is deterministic and
  bounded; prompt appears only as inert text;
  data-only (no functions/code); two distinct prompts diverge.
- **Composition (`app/worldBible` helper and/or `App` wiring unit):** prompt →
  bible derived → `GeneratedRoomSource` constructed with the derived seed (not the
  raw prompt); bible stored in `ActivePlay`; **seeder failure degrades to
  prompt-as-seed and still yields a room** (non-blocking).
- **Log-safety guard:** drive seeding through a capturing logger and assert no
  title/premise/conflict/NPC/faction/location/opening-arc/keyword text, no raw
  prompt, and no derived seed string appears — only safe enums/counts/length/codes
  (mirrors the ADR-0020/0021 log-safety tests).

## 11. Implemented slices

Slices 1–6 were implemented independently; the maintainer commits each manually.

1. **`feat(domain): add WorldBibleSeed schema + types`** —
   `domain/worldBible/worldBibleSeed.ts` + schema tests (§10 bullet 1). No wiring,
   no generation impl.
2. **`feat(domain): add worldBibleToGeneratorSeed projection`** —
   `domain/worldBible/worldBibleToSeed.ts` + projection tests.
   **Follow-up:** add the required bounded `openingArc` initial-canon object and
   include `pattern:firstObjective` in the projection; schema/projection tests
   and this plan only, with no wiring or quest/event-state semantics.
3. **`feat(domain): add WorldBibleSeeder port`** —
   `domain/ports/WorldBibleSeeder.ts` (contract only).
4. **`feat(generation): add deterministic FakeWorldBibleSeeder`** —
   `generation/FakeWorldBibleSeeder.ts` + seeder tests (determinism, purity,
   theme mapping, schema-valid output, log-safe / no inert-text leakage).
5. **`feat(app): seed generated rooms from a world bible`** — wire
   `App.handlePrompt`, add `ActivePlay.worldBible`, non-blocking degrade, the one
   safe log line; the landed `app/worldBible.ts` helper owns projection/degrade
   and has focused composition + log-safety tests.
6. **`docs(architecture): record world-bible-seed v0`** — record **ADR-0022**;
   update `ARCHITECTURE.md` (Generation plug-in point), `BOUNDARIES.md` (note the
   new domain/generation modules; no new lint rule), `FAILURE-MODES.md` (new
   "World Bible seeding" non-blocking-degrade row), and `AGENTS.md` (status
   paragraph + out-of-scope note); record this plan/ADR as *implemented*.

## 12. Files added / changed

- **New (domain):** `domain/worldBible/worldBibleSeed.ts`,
  `domain/worldBible/worldBibleToSeed.ts`, `domain/ports/WorldBibleSeeder.ts`
  (+ co-located `*.test.ts`).
- **New (generation):** `generation/FakeWorldBibleSeeder.ts` (+ test).
- **New (composition):** `app/worldBible.ts` helper + test.
- **Edited:** `App.tsx` (construct the seeder once; wire `handlePrompt`; add
  `ActivePlay.worldBible`). Docs: `ARCHITECTURE.md`, `BOUNDARIES.md`,
  `FAILURE-MODES.md`, `AGENTS.md`; new `ADR-0022`; this plan.
- **Deliberately NOT changed:** `FakeRoomGenerator.ts`, `GeneratedRoomSource.ts`,
  `assembleRoom`/`repairRoom`/`fallbackRoom`, `RoomGenerator`/`RoomSource` ports,
  `renderer/**`, `RoomViewer.tsx`, `world-session/**`, `persistence/**`,
  `server/**`, `NavigationService.ts`, `AdjacentRoomPregenerator.ts`,
  `RoomRegistry.ts`, `CanonSeed`/`worldState.ts`, `eslint.config.js`.

## 13. Approval answers (binding for this slice)

1. **Seeder return shape:** `WorldBibleSeeder.seed()` returns a **typed,
   schema-validated `WorldBibleSeed`** (the fake validates internally; a future
   LLM seeder parses raw text → `WorldBibleSeedSchema`).
2. **Theme mapping:** **two-way** — post-apoc keywords → `post-apoc`, otherwise →
   `fantasy-keep`.
3. **World title → CanonSeed:** **Do not** wire `worldBible.title` into
   `CanonSeed` / `startRoomSession` in v0. The world-session path is unchanged.
4. **UI:** **No new UI** in v0.
5. **Scope:** `WorldBibleSeed` applies **only to the PromptBar/generated-room
   path**.
6. **Bootstrap/pregeneration:** **Do not** wire it into the authored bootstrap or
   `AdjacentRoomPregenerator` in v0.

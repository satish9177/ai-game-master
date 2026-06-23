# ADR-0022: World Bible Seed v0 — bounded initial canon for prompt-generated rooms

- **Status:** Accepted — **implemented** (World Bible Seed v0)
- **Date:** 2026-06-23
- **Deciders:** Project owner

## Context

The prompt-generated room path previously sent the raw user prompt directly to
`FakeRoomGenerator`. That was deterministic and safe, but it provided no explicit
place to hold the world's initial theme, premise, cast, locations, or opening
direction. A future real room-generator provider needs compact structured context
without turning generated prose into executable behavior or creating a second
source of gameplay truth.

The project already has an authoritative truth model: `WorldSession` appends
validated events and derives `WorldState` from the event log. Any world-bible
concept must remain initial canon only. It must not become current state, a quest
engine, an event, save-game truth, or persisted backend data.

## Decision

Ship **World Bible Seed v0** as a deterministic, browser-local pre-generation
step used only by the PromptBar/generated-room path.

```
PromptBar prompt
  → FakeWorldBibleSeeder.seed(prompt)
      → WorldBibleSeedSchema.parse            strict, bounded initial canon
  → worldBibleToGeneratorSeed(worldBible)     title-first, deterministic, ≤160 chars
  → GeneratedRoomSource(FakeRoomGenerator, generatorSeed, ...)
      → assembleRoom → validate/repair/fallback
  → fresh generated-room WorldSession + cache
      └─ ActivePlay.worldBible                composition memory only
```

### Domain contracts

- `domain/worldBible/worldBibleSeed.ts` defines the strict, versioned
  `WorldBibleSeedSchema` and inferred `WorldBibleSeed` type. Its strings and
  collections are bounded. It carries a title, two-way theme pack, tone, premise,
  starting location, major conflict, small faction/NPC/location sets, generation
  hints, canon notes, and a bounded `openingArc`.
- `openingArc` contains a closed pattern (`escape`, `investigate`, `survive`,
  `rescue`, or `recover-item`) plus bounded hook, first-objective, and pressure
  strings. It is an opening direction only—not quest state or a branching story
  plan.
- `domain/worldBible/worldBibleToSeed.ts` provides the pure
  `worldBibleToGeneratorSeed` projection. It emits a stable title-first string
  from title, theme, tone, `openingArc.pattern:firstObjective`, premise, and
  keywords, capped at 160 characters without mutating its input.
- `domain/ports/WorldBibleSeeder.ts` defines the domain-safe
  `WorldBibleSeeder.seed(prompt): Promise<WorldBibleSeed>` port.

### Deterministic fake adapter

`generation/FakeWorldBibleSeeder.ts` implements the port with the existing seeded
PRNG. It is pure and silent: no logger, clock, `Math.random`, network, filesystem,
database, or other I/O. The same prompt yields byte-identical data; different
prompts generally vary the title and seeded selections.

The fake maps the approved post-apocalyptic keywords (`zombie`, `ruin`,
`apocalypse`, `survivor`, `raider`, `wasteland`, `infected`, `outbreak`,
`fallout`) to `post-apoc`; all other prompts use `fantasy-keep`.
`generationHints.allowedThemePack` always agrees. Prompt-derived text is inert
bounded data, never code. Before returning, the adapter parses its output through
`WorldBibleSeedSchema`.

### Composition wiring

`App` constructs one `FakeWorldBibleSeeder`. Only `App.handlePrompt` uses it, via
the tested `app/prepareGeneratedRoomSeed` helper:

1. Keep the existing prompt-length-only submission log.
2. Seed and validate a `WorldBibleSeed`.
3. Project it to the compact generator seed.
4. Pass that seed—not the raw prompt—to the unchanged `GeneratedRoomSource`.
5. Store the bible only on the fresh generated session's optional
   `ActivePlay.worldBible` field.
6. Start `WorldSession` exactly as before from the accepted room.

The authored two-room bootstrap and `AdjacentRoomPregenerator` do not use
`WorldBibleSeed` in v0. Adjacent generation remains keyed by its structural
`adjacent:${roomId}` seed. No renderer, RoomViewer, PromptBar UI, RoomGenerator,
FakeRoomGenerator, backend, API, SQLite, or persistence contract changes.

Generated rooms retain the existing trust path:
`GeneratedRoomSource → assembleRoom → loadRoomSpec/validateRoom → repairRoom →
fallbackRoom`. The world bible never bypasses validation and never reaches the
renderer as executable behavior.

### Authority and lifetime

`WorldBibleSeed` is **initial canon only**. It suggests the starting world and
opening situation; it does not describe current truth after play changes the
world. `WorldSession`, the append-only event log, and projected `WorldState`
remain authoritative.

The bible lives only in browser composition memory for the generated play. It is
not copied into `CanonSeed`, `WorldEvent`, `WorldState`, `SaveGame`, the Node API,
or SQLite. No UI reads or displays it in v0.

### Failure and log safety

World-bible seeding is additive and non-blocking. If the seeder rejects or
projection fails, `prepareGeneratedRoomSeed` returns the original raw prompt as
the generator seed and omits `worldBible`. Room generation then follows the
previous behavior and still receives repair/fallback guarantees.

Success logging is limited to the closed theme/tone enums, NPC/location/faction/
keyword counts, and derived-seed length. Failure logging contains only the fixed
`world-bible-unavailable` code. Logs never contain:

- raw prompt or derived generator-seed text;
- world title, premise, major conflict, canon notes, or opening-arc text;
- NPC, faction, location, or keyword text;
- generated RoomSpec JSON; or
- thrown error messages/details.

## Consequences

- Prompt-generated rooms now receive compact structured initial context while
  preserving deterministic local behavior and the existing `RoomGenerator` port.
- A future real `WorldBibleSeeder` can replace the fake behind the same validated
  port; a failure still degrades to the proven raw-prompt path.
- The world bible does not compete with event-sourced truth and creates no
  persistence migration or backend coupling.
- Title-first projection lets the current fake room label reflect the world title
  without changing `FakeRoomGenerator`.
- v0 intentionally has no world-bible UI, quest engine, memory system, branching
  planner, authored-bootstrap integration, or adjacent-room propagation.

## Alternatives considered

- **Keep passing only the raw prompt** — rejected as the primary path because it
  offers no structured initial-canon seam for a future provider; retained as the
  safe degradation path.
- **Put the bible in `WorldState` or add an event** — rejected because initial
  setup is not current truth and would create a competing authority.
- **Persist it through SQLite/API now** — rejected because the browser has no API
  client wiring and v0 needs no durable bible lifecycle.
- **Apply it to authored bootstrap or adjacent pre-generation** — rejected to keep
  v0 scoped to explicit PromptBar generation and avoid accidental canon spread.
- **Add a quest/story planner or UI** — rejected: the bounded opening arc is data
  for initial generation, not a new gameplay/state subsystem.


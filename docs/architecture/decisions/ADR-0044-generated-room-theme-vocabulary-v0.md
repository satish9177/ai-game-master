# ADR-0044 - Generated Room Theme Vocabulary v0

**Status:** Implemented

## Context

World Bible Seed v0 already produces a structured `themePack` for prompt-generated
play, and Adjacent Room Theme Continuity v0 carries a safe bounded projection into
generated adjacent-room seeds. The deterministic fake generator and generated-room
composition still used fantasy-biased default object pools and anchor priority,
which made post-apocalyptic rooms drift toward thrones, altars, statues, scrolls,
candles, and rugs.

This feature closes that gap for the fake/generated-room path without expanding
the product's theme taxonomy.

## Decision

Add a pure generated-room theme vocabulary resolver for the existing theme packs:

- `fantasy-keep`
- `post-apoc`

The theme is the structured `WorldBibleSeed.themePack`. It is not inferred from
the raw prompt, and no seed string is parsed for theme.

`FakeRoomGenerator` now accepts `GeneratedRoomThemeVocabulary` by constructor
injection. Missing vocabulary falls back to the existing/default fantasy-like
behavior. App composition resolves:

```text
WorldBible themePack
  -> themeVocabulary(themePack)
  -> FakeRoomGenerator(vocabulary)
  -> generated JSON
  -> GeneratedRoomSource
  -> assembleRoom(..., { themePack })
  -> theme-aware generated-room composition
  -> trusted renderer
```

Prompt-generated fake rooms and their generated-play adjacent fake rooms receive
the same resolved vocabulary. Authored/example bootstrap and the global authored
adjacent pregenerator keep the default fake behavior.

`generatedRoomComposition` and `assembleRoom` accept an optional structured
`themePack` for story-anchor priority. Missing theme or `fantasy-keep` preserves
the existing priority. `post-apoc` prefers `machine` and `corpse` before
fantasy-biased anchors.

## Vocabulary Rules

The post-apocalyptic vocabulary suppresses fantasy-biased generated pools such as:

- `throne`
- `altar`
- `statue`
- `scroll`
- `candle`
- `rug`

`neverAppear` must not suppress:

- `arch`
- `npc`

Those remain available because generated exit navigation and NPC presence must
continue to work safely.

Fantasy/default vocabulary preserves existing behavior, including the existing
anchor priority for `throne`, `altar`, and `statue`.

## Safety

- No `RoomSpec` schema change.
- No renderer or builder change.
- No GLTF assets, textures, animation, or new asset pipeline.
- No real-provider prompt theming in v0.
- No backend, memory, quest, inventory, or combat change.
- No sci-fi/spaceship support in v0.
- No provenance behavior change: vocabulary and theme-aware composition remain
  benign generated-room normalization.
- Missing theme degrades to default/fantasy vocabulary and default anchor
  priority.
- Diagnostics and logging remain safe: logs must not include raw prompt, seed
  strings, room/object names, generated JSON, provider output, interaction
  body/title text, or object names.

## Deferred

Sci-fi/spaceship is explicitly deferred because `ThemePackSchema` does not include
a sci-fi theme pack. Adding it needs a later theme-pack/classifier/content-pack
feature, plus explicit vocabulary and prompt/real-provider decisions.

## Non-goals

- RoomSpec schema changes.
- Renderer/builder changes.
- New object types.
- GLTF, textures, animation, or external assets.
- Real-provider prompt theming.
- Backend or API theming.
- Memory, quest, inventory, combat, or persistence changes.
- Prompt parsing or seed-string theme inference.
- Sci-fi/spaceship support.

## Consequences

Post-apocalyptic fake/generated rooms now produce and compose around more suitable
objects such as machines and corpses, while fantasy/default rooms preserve the
existing feel. Adjacent generated rooms in a prompt-generated play carry the same
vocabulary as the primary room. The trusted renderer boundary and validation
pipeline remain unchanged.

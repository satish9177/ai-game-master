# Implementation Plan - Ruined Kingdom Survival Visual Pack

> Status: **APPROVED; implementation is divided into reviewable slices.**
>
> Decision: [ADR-0091](../decisions/ADR-0091-ruined-kingdom-survival-visual-pack.md).
> Manual verification: [Ruined Kingdom Survival manual smoke](../../evaluation/ruined-kingdom-survival-manual-smoke.md).
>
> This is the task-specific source of truth. The generated story remains in
> control of semantic composition; showcase rooms are fixtures only.

---

## 0. Locked acceptance criteria

- Grounded low-poly art readable from the existing isometric camera.
- One trusted deterministic Three.js renderer and one shared humanoid rig.
- `RoomSpec` remains validated data only; `schemaVersion: 1` receives additive,
  optional, closed semantic fields.
- No generated model/material/texture paths, asset ids, GLTF node names, shader
  names, clip names, executable code, or renderer instructions.
- One trusted `VisualPackRegistry` with closed mappings and fixed paths.
- A small core plus lazy environment bundles, about 35-50 MB total.
- All existing 24 types and 100 aliases have catalog coverage.
- Supported production content never displays the debug seal, blue capsule, or
  primitive debug geometry.
- No small raw object cap. A high 4,096-entry abuse envelope may remain, while
  runtime rendering is governed by weighted resource budgets.
- Village square, ruined tavern, and crypt entrance are dev/test fixtures, not
  replacements for generated rooms.
- Current gameplay, dialogue, NPC movement, navigation, safety, persistence, and
  schema invariants remain unless this plan explicitly names an additive,
  data-only projection change.

## 1. Current audit and weaknesses

The existing foundation is sound:

- generation flows through parse, exact alias repair, Zod loading,
  normalization, semantic validation, deterministic repair/fallback, then the
  trusted renderer;
- the object builder registry is exhaustive over current schema types;
- React hosts the engine through imperative calls and callbacks;
- `WorldEvent[]` and projected `WorldState` remain authoritative;
- persistence stores validated neutral data, never Three.js objects.

Production-quality gaps:

1. the player is a bright-blue capsule/cone/ring debug marker;
2. NPC roles do not affect the primitive humanoid builder;
3. zombies are the same mannequin with grey skin and reaching arms;
4. there are no modular heads, bodies, hair, clothing, armour, accessories,
   palettes, infection layers, skeletons, or clips;
5. moving characters do not face travel;
6. many props are primitive diagrams and legacy `prop` is literal geometry;
7. the shell cannot express village, tavern, palace, ruins, forest, crypt, or dungeon architecture;
8. only the north shell wall visibly opens for exits;
9. generated aliases lose important distinctions;
10. numerous useful concepts are skipped rather than represented;
11. generated body-only interactions can be purposeless;
12. taken/opened/locked/read/activated objects do not visibly change;
13. there is no production/debug fallback gate;
14. geometries/materials are recreated and nearly every mesh casts shadows;
15. there is no asset cache, instancing, LOD, mixer, texture, shadow, or light budget;
16. current scene disposal would double-dispose shared GLTF resources;
17. no provenance/checksum/license manifest exists;
18. generated rooms are truncated by raw counts rather than actual cost.

## 2. Architecture and data flow

```text
raw generated JSON
  -> exact alias + closed semantic variant repair
  -> RoomSpec Zod loading
  -> deterministic layout/semantic normalization
  -> validated LoadedRoom
  -> weighted render planner
  -> VisualPackRegistry resolver
       exact -> family -> environment -> neutral -> development debug
  -> trusted Three.js engine
       instanced static pieces
       unique stateful props
       shared humanoid factory/controllers
       closed static collision
       neutral interaction/view-model callbacks

existing WorldState flags + generated-gate evaluation
  -> pure ObjectPresentationState projection
  -> RoomViewer approved host seam
  -> Engine.updateObjectPresentationStates(...)
```

`VisualPackId` is selected by trusted app configuration. The renderer owns
bundle URLs, node/material/clip names, asset cost, collision, LODs, and license
references. The LLM selects only published semantic enums.

Existing `exit -> encounter -> dialogue -> effect` precedence does not change.
A supported inspectable object may receive the existing inspect effect with a
stable id. Unsupported body-only affordances become decorative. Assembly never
invents loot, take-item contents, or authoritative flags.

Dynamic visuals are projections:

- `take-item`: closed before resolution, open/looted after the existing flag;
- `inspect`: documents become read; containers open; devices/altars/artifacts activate;
- generated gate evaluation: locked versus open exit;
- static condition: intact/weathered/damaged/burned/overgrown, orthogonal to interaction state.

## 3. Closed contracts

Domain vocabulary:

```ts
type EnvironmentKind =
  | 'village' | 'tavern' | 'palace' | 'ruins'
  | 'forest-edge' | 'crypt' | 'dungeon'

type ObjectCondition =
  | 'intact' | 'weathered' | 'damaged' | 'burned' | 'overgrown'

type ObjectInteractionState =
  | 'none' | 'closed' | 'open' | 'locked'
  | 'looted' | 'read' | 'activated'

type ObjectPresentationState = Readonly<{
  condition: ObjectCondition
  interactionState: ObjectInteractionState
  resolved: boolean
}>

type HumanoidPresetId =
  | 'human-commoner' | 'guard' | 'villager' | 'merchant' | 'noble'
  | 'servant' | 'wanderer' | 'raider' | 'zombie' | 'humanoid-monster'

type HumanoidAppearance = Readonly<{
  preset: HumanoidPresetId
  presentation?: 'masculine' | 'feminine' | 'neutral'
  palette?: 'earth' | 'village' | 'guard' | 'merchant' | 'royal'
    | 'raider' | 'survivor' | 'undead' | 'monster'
  infection?: 'none' | 'early' | 'advanced'
  accessories?: 'none' | 'traveller' | 'merchant' | 'guard'
    | 'noble' | 'raider' | 'survivor'
}>
```

Add five closed family objects:

- `architecture`: wall-straight, wall-corner, wall-ruined, doorway, window,
  stairs, ladder, trapdoor, column, beam, railing, fence, gate, roof,
  floor-section, fountain, well, pool;
- `furniture`: table, chair, stool, bench, bed, shelf, bookcase, cabinet,
  wardrobe, counter, market-stall;
- `clutter`: sack, bottle, mug, plate, pot, cauldron, rope, tool-rack,
  weapon-rack, book-stack, bone-pile, hay-bale, firewood, bloodstain,
  markings, small-rubble, key, coin-pile, potion;
- `vegetation`: tree, dead-tree, stump, bush, grass, fern, vine, mushroom, rock;
- `light-fixture`: lantern, wall-lantern, brazier, campfire, chandelier,
  candle-cluster.

`RoomSpec` adds optional `environmentKind`, relevant optional `condition` and
type-specific `variant`, and strict optional `appearance` on NPC/zombie.
Invalid optional visual selectors degrade to `undefined`; an unknown required
family `kind` remains invalid/skipped. Player appearance remains renderer-owned
as `player-survivor`. Explicit room save/cache projections preserve the
optional fields without changing the schema version.

Renderer-only contracts include:

```ts
type VisualPackId = 'ruined-kingdom-survival'
type VisualResolutionTier = 'exact' | 'family' | 'environment' | 'neutral' | 'debug'
type AnimationIntent =
  | 'idle' | 'walk' | 'run' | 'talk' | 'gesture' | 'inspect'
  | 'pick-up' | 'sit' | 'carry' | 'hurt'
  | 'zombie-idle' | 'zombie-walk'

type CollisionProfile =
  | { kind: 'none' }
  | { kind: 'circle'; radius: number; blocksPlayer: boolean; blocksNpc: boolean }
  | { kind: 'box'; halfExtents: readonly [number, number];
      blocksPlayer: boolean; blocksNpc: boolean }

type VisualAssetDescriptor = Readonly<{
  bundleId: string
  nodeName: string
  family: VisualFamilyId
  instancing: 'allowed' | 'forbidden'
  lodAssetIds: readonly string[]
  collision: CollisionProfile
  cost: RenderCost
  licenseSourceId: string
}>
```

All descriptor strings are trusted registry values, never schema values.

## 4. Weighted budget

Balanced profile:

```ts
{
  visibleTriangles: 800_000,
  drawCalls: 250,
  decodedTextureBytes: 128 * 1024 * 1024,
  skinnedCharacters: 16,
  activeAnimationMixers: 12,
  shadowCastingLights: 1,
  localLights: 12,
  particleEmitters: 4,
  blendedTransparentDraws: 16,
  shadowCastingMeshes: 96,
  staticCollisionBodies: 512,
  activePhysicsBodies: 0,
}
```

Static, state-invariant matches batch by asset/material/state/shadow profile.
Interactive/stateful objects never instance. The planner preserves semantic
objects and degrades only presentation cost, in ADR-0091's locked order.

## 5. Reuse strategy

### Characters and animation

One factory composes body, head, hair, clothing, armour, palette, accessories,
and infection overlays. Exact modular choices derive deterministically from
`(room.id, stable object id, preset)`.

Instance ownership:

- logical root keeps current X/Z movement, proximity, and routines;
- visual child faces velocity;
- cloned skeleton and mixer are per character;
- geometry, textures, and clips are immutable/cache-shared;
- material overrides are bounded and instance-owned;
- interaction anchor and disposal handle are explicit.

Animation priority is:

```text
one-shot action/hurt
-> talk/gesture
-> run/walk/zombie locomotion
-> existing rest-mode sit
-> idle
```

`run` presents existing chase only. `carry` stays dormant until existing
gameplay supplies a real signal. Non-humanoid body plans require future rigs.

### Environments and props

- Village: timber/stone facades, walls, corners, roofs, doors, windows, fences,
  stalls, well, signs, paving.
- Tavern: interior walls, beams, fireplace, stairs, cellar hatch, bar, tables,
  chairs, benches, shelves.
- Palace: dressed masonry, arches, columns, stairs, railings, dais, banners,
  chandeliers.
- Ruins: broken walls/corners/arches, collapsed roofs/floors, burned beams,
  rubble, vines, barricades.
- Forest edge: trees, dead trees, stumps, rocks, bushes, grass, ferns, vines,
  mushrooms, camp clutter.
- Crypt: masonry, stairs, iron gate, coffin/sarcophagus, graves, bone niches,
  braziers.
- Dungeon: walls/corners, bars, cells, drains, chains, stairs, doors, torches,
  racks.
- Shared: furniture, containers, documents, tableware, tools, sacks, rope, hay,
  firewood, clutter, lighting, vegetation, damage states.

## 6. Required legacy catalog coverage

License codes: `MV` Medieval Village MegaKit; `FP` Fantasy Props MegaKit;
`MD` Modular Dungeons; `ZA` Zombie Apocalypse Kit; `UBC` Universal Base
Characters; `FO` Fantasy Outfits; `UAL` Universal Animation Libraries.

| Canonical type and current aliases | Exact target | Required state / collision / source |
| --- | --- | --- |
| `throne` | royal throne | condition states; large box; FP |
| `pillar` | stone column | cracked/ruined/overgrown; circle; MV/MD |
| `rug` | runner | worn/damaged/burned; none; FP |
| `torch` | wall torch | lit/emissive, excess light emissive-only; none; FP/MD |
| `arch`; door, doors, doorway, gate, gateway, archway, portal, entrance | alias-specific arch/door/iron gate/portal | open/locked/damaged/burned; split-post/opening collision; MV/MD |
| `scroll` | rolled scroll | unread/read/optional taken; none; FP |
| `book`; journal, journals, diary, tome, ledger, books | alias-specific book/journal/tome/ledger | unread/read/looted; none; FP |
| `paper`; notes, note, letter, letters, parchment, papers, document, documents, page, pages | notes/letter/parchment/sheet | unread/read/looted; none; FP |
| `map`; floor plan, floorplan, route chart, chart, blueprint, maps | map/plan/route map | unread/read; none; FP |
| `chest`; treasure chest, lockbox, coffer, strongbox, footlocker | alias-specific chest | closed/open/locked/looted/damaged/burned; box; FP |
| `corpse`; dead body, skeleton, skeletons, bones, remains, cadaver, corpses | body/skeleton/bone pile/remains | unsearched/looted/burned; low nonblocking/NPC exclusion; ZA/FP |
| `table`; desk, desks, workbench, worktable, work table, counter, tables | alias-specific table/desk/bench/counter | activated/damaged/burned; box; FP |
| `altar`; shrine, ritual platform, ritual altar, offering table, altars | altar/shrine/platform | inactive/activated/damaged/burned; box; FP/MD |
| `statue`; monument, idol, effigy, sculpture, statues | alias-specific statue | intact/damaged/burned/overgrown; circle; FP/MV |
| `machine`; generator, console, machinery, lab equipment, terminal, apparatus, machines | alias-specific device | inactive/activated/damaged/burned; box; ZA |
| `artifact`; crystal, crystals, relic, relics, orb, strange object, gem, shard, totem, artifacts | crystal/relic/orb/gem/shard/totem | inactive/activated/looted; small circle; FP |
| `candle`; candles, small flames, votive, tea light, tealight | single/cluster/votive/tea-light | lit/unlit/damaged; none; FP |
| `npc` | shared humanoid preset | existing dialogue/encounter; soft character; UBC/FO/UAL |
| `prop` | styled package/cask/stone marker/wrapped bundle | legacy noninteractive; profile collision; FP |
| `crate`; box, boxes, container, containers, case, crates, supply crate | crate/box/case/supply crate | closed/open/locked/looted/damaged/burned; box; FP/ZA |
| `barrel`; drum, keg, cask, barrels | alias-specific barrel | closed/open/looted/damaged/burned; circle; FP/ZA |
| `debris`; rubble, trash, garbage, junk, wreckage, scrap, broken parts, debris pile | alias-specific clutter | optional inspect/damaged/burned; cluster; ZA/MV |
| `barricade` | planks/sandbags | intact/damaged/burned; wall/box blocker; ZA/FP |
| `zombie` | shared humanoid zombie preset | existing encounter + shamble; soft character; UBC/FO/UAL/ZA |

Every row also requires exact/family/environment/neutral resolution tests,
interaction-state tests where applicable, collision tests, and a manifest/checksum
test. The matrix is generated from the catalog rather than duplicated by hand in
Exact asset IDs are closed registry IDs. For legacy rows they are
`object.<canonical-type>.<semantic-variant>` (for example
`object.chest.footlocker`); each alias in the first column maps to its
corresponding semantic variant in the second column. NPC and zombie exact IDs are
`humanoid.<preset>`; barricades and legacy props use
`object.barricade.<style>` and `object.prop.<shape>`. The automated catalog
test is authoritative and proves all 24 canonical types and all 100 aliases have
an exact descriptor with collision and manifest license coverage.

Fallback and test columns for every catalog row are determined by its closed
family:

| Family used by rows | Family fallback | Theme fallback | Neutral production fallback | Test coverage |
| --- | --- | --- | --- | --- |
| architecture | `family.architecture` | `environment.<environmentKind>.architecture` | `neutral.architecture` | R/C/L |
| furniture | `family.furniture` | `environment.<environmentKind>.furniture` | `neutral.furniture` | R/I/C/L |
| container | `family.container` | `environment.<environmentKind>.container` | `neutral.container` | R/I/C/L |
| document | `family.document` | `environment.<environmentKind>.document` | `neutral.document` | R/I/L |
| anchor | `family.anchor` | `environment.<environmentKind>.anchor` | `neutral.anchor` | R/I/C/L |
| device | `family.device` | `environment.<environmentKind>.device` | `neutral.device` | R/I/C/L |
| clutter | `family.clutter` | `environment.<environmentKind>.clutter` | `neutral.clutter` | R/I/C/L |
| lighting | `family.lighting` | `environment.<environmentKind>.lighting` | `neutral.lighting` | R/I/L |
| vegetation | `family.vegetation` | `environment.<environmentKind>.vegetation` | `neutral.vegetation` | R/C/L |
| humanoid | `family.humanoid` | `environment.<environmentKind>.humanoid` | `neutral.humanoid` / static LOD | R/I/C/A/L |

Test codes: R registry/alias/fallback, I interaction/visible-state projection,
C collision profile, A shared-rig animation/clone behavior, and L
license/provenance/checksum. Debug is deliberately absent from these production
chains and can be appended only by trusted development configuration.
test fixtures.

## 7. Files in scope

New runtime/domain areas:

```text
apps/web/src/domain/visuals/
apps/web/src/renderer/engine/visual-pack/
apps/web/src/renderer/engine/characters/
apps/web/src/renderer/engine/controls/CollisionWorld2D.ts
apps/web/src/domain/examples/ruinedKingdomShowcases.ts
apps/web/src/redteam/visualPack.redteam.test.ts
apps/web/src/evaluation/visualPackPerformance.eval.test.ts
apps/web/scripts/verify-visual-pack.mjs
```

New asset/doc areas:

```text
apps/web/public/visual-packs/ruined-kingdom-survival/
docs/assets/ruined-kingdom-survival/
docs/assets/licenses/CC0-1.0.txt
docs/architecture/decisions/ADR-0091-ruined-kingdom-survival-visual-pack.md
docs/architecture/implementation-plans/ruined-kingdom-survival-visual-pack.md
docs/evaluation/ruined-kingdom-survival-manual-smoke.md
```

Existing areas may change only where needed for: package loader support; additive
RoomSpec/load/save projections; aliases/layout/composition/purpose; prompt/fake
generation; RoomViewer/Engine host state; disposal; player and object builders;
shell/lighting/materials/indicators; movement/facing/collision; HUD/dialogue/CSS;
and their focused tests. Production code in `world-session/**`,
`persistence/migrations/**`, `server/**`, `memory/**`, event reducers,
encounters, and dialogue provider contracts remains unchanged.

No file outside the approved inventory may change without a plan amendment.

Plan amendment: the production shell also belongs to the visual-pack area above.
It is projected by buildVisualShellRoom into closed semantic architecture and
resolved through the same registry/cache/budget path; the former box shell stays
legacy/debug-only. ADR-0031 is updated only to mark its old 30-object cap as
superseded, avoiding contradictory current architecture guidance.

## 8. Reviewable slices

| Slice | Suggested branch | Review result |
| --- | --- | --- |
| 1 | `codex/rks-01-contract-and-adr` | ADR/contracts/failure modes; no runtime behavior |
| 2 | `codex/rks-02-semantic-vocabulary` | additive semantic fields, alias distinctions, save round trips |
| 3 | `codex/rks-03-weighted-budget` | remove 30-object rule; retain abuse ceiling; planner tests |
| 4 | `codex/rks-04-pack-core` | neutral production fallbacks, registry/cache/fixed-path loader |
| 5 | `codex/rks-05-village-tavern-palace` | first environment/furniture/container bundles, instancing |
| 6 | `codex/rks-06-ruins-crypt-dungeon-forest` | remaining environment/clutter/light/vegetation/damage variants |
| 7 | `codex/rks-07-shared-humanoids` | one production factory for player/NPC/zombie |
| 8 | `codex/rks-08-character-animation` | clone-safe mixers, facing, transitions, existing signals |
| 9 | `codex/rks-09-object-presentation` | purposeful affordances and live visible states |
| 10 | `codex/rks-10-collision-and-runtime-budget` | swept/sliding collision and deterministic runtime degradation |
| 11 | `codex/rks-11-camera-light-ui-profile` | retained isometric camera, coherent PBR/light/shadow/UI profile |
| 12 | `codex/rks-12-showcases-and-regressions` | showcases, stress/failure smokes, licensing verification |

Do not create commits automatically. Each slice ends with targeted tests,
`git diff --check`, lint, and build as appropriate; a maintainer may then
request the documented branch/commit split.

## 9. Automated test plan

Unit:

- reject arbitrary URLs/paths/shaders/clips/code/instructions;
- old specs remain compatible and optional fields survive round trips;
- every alias maps to canonical type plus expected semantic variant;
- every id resolves through the locked fallback hierarchy;
- production cannot resolve `debug`;
- 100-500 cheap objects survive and are not treated as a raw count failure;
- expensive resources degrade in the locked order;
- visible-state precedence covers inspect/take/use/gates/static condition;
- collision covers rotated boxes, circles, sliding, nonblockers, and exit gaps;
- character variation is deterministic; skeletons/mixers are independent;
- every animation intent has a clip or documented safe fallback;
- cache acquisition, failure, stale load, release, and teardown are idempotent.

Integration/renderer:

- raw semantic JSON -> aliases -> RoomSpec -> assembly -> registry;
- fake/real-provider prompts expose semantics, never assets or the old 30 cap;
- interaction precedence stays byte-identical;
- success updates presentation live; failure leaves it unchanged;
- NPC wander/patrol/chase/awareness/dialogue pause remain intact;
- locked exits match the same authoritative gate and save/load reconstruction;
- no visual runtime state enters SaveGame, events, SQLite world state, or memory;
- all bundles pass checksum/size/extension/node/material/animation validation;
- no camera/light/script/remote URL is embedded in GLB;
- supported production rooms have no debug primitives or capsule;
- interactive objects are not instanced; identical static objects are;
- 20-room StrictMode navigation has stable cache/mixer/listener/GPU counts;
- all exit sides have matching visual and collision openings.

## 10. Asset acquisition and license requirements

Preferred reviewed CC0 source family:

- Quaternius Universal Base Characters;
- Modular Character Outfits - Fantasy;
- Universal Animation Library 1 and 2;
- Medieval Village MegaKit;
- Modular Dungeons;
- Fantasy Props MegaKit;
- Zombie Apocalypse Kit;
- Ultimate Stylized Nature.

Record source title, creator, official page, acquisition date, `CC0-1.0`,
license URL, original archive SHA-256/name, included nodes, and modifications.
Use only reviewed free-download contents. Record cleanup, topology/UV/atlas,
recoloring, rig normalization, retargeting/trimming, LOD/collider creation, and
bundling. Normalize meters/Y-up/+Z/y=0, self-contain GLBs, strip unsafe/unused
content, default atlases to at most 1024 square, and use standard PBR only.
Never claim the whole repository is CC0.

## 11. Explicit non-goals

No combat, damage simulation, weapon system/physics, loot randomization, zombie
combat AI, multiplayer, networking, voice, streaming, runtime-generated or
downloaded assets, model-selected asset identities, non-humanoid rigs, physics
engine, ragdolls, navmesh, sprint/carry/sit gameplay, new health rules,
first-person/free camera, minimap, touch controls, backend/API/SQLite wiring,
new events/state/migrations/memory writes, fixed showcase generation, or a small
raw object-count cap.

Static weapon racks/broken weapons may exist as clutter but add no combat or
equipment capability.

## 12. Regression risks

- Optional fields lost: explicit projection and round-trip tests.
- Asset/path injection: absent schema fields plus hostile red-team tests.
- Visual state divergence: derive only from existing flags/gates.
- Engine remount resetting NPCs: live state-update method.
- Shared GLTF double-disposal: cache leases and StrictMode tests.
- Shared bone state: skeleton-safe cloning and per-instance mixer tests.
- Rich layout truncation: 100-500-piece fixtures.
- Resource overload: weighted deterministic degradation.
- Stateful instancing: explicit registry prohibition.
- Exit/interactable blocking: closed collision profiles and four-side smoke.
- Moonwalking: logical root plus velocity-facing child.
- Style drift: one source family and common material/palette treatment.
- Debug leak: production invariant and fatal asset-unavailable surface.
- Unsafe loader logs: fixed diagnostic codes/counts only.
- Bundle growth: manifest byte limits and verification gate.

## 13. Minimum Safe Change Check

- **Reuse:** RoomSpec loader/assembly/repair, exhaustive object registry,
  Engine/RoomViewer seam, isometric camera, NPC movement/routines, interactions,
  world flags/gates, save/load, SQLite room JSON, logger, and existing HUD/dialogue.
- **Necessary additions:** closed semantics, registry/cache/resolver, reviewed
  assets, shared humanoid/animation controller, pure visible-state projection,
  closed collision, weighted planner, and asset verification.
- **Unchanged safety:** no executable generation, arbitrary paths, domain
  Three.js objects, renderer world writes, browser SQLite, memory authority,
  new event/persistence truth, or unsafe logging.
- **Proof:** exhaustive catalog/red-team tests, rich-layout budgets,
  clone/cache/disposal tests, state/save integration, showcase smokes, lint,
  build, and full tests.

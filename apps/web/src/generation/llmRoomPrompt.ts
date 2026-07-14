/**
 * Pure, side-effect-free prompt builder for the real LLM RoomGenerator.
 * Provider output remains raw and untrusted until the existing
 * JSON.parse -> loadRoomSpec -> validate -> repair/fallback pipeline accepts it.
 */
import { NPC_ROUTINE_NPC_TYPES } from '../domain/npcRoutinePresets'
import {
  ACCESSORY_PROFILES,
  ARCHITECTURE_KINDS,
  BODY_PRESENTATIONS,
  CLUTTER_KINDS,
  ENVIRONMENT_KINDS,
  FURNITURE_KINDS,
  HUMANOID_PALETTE_IDS,
  HUMANOID_PRESET_IDS,
  INFECTION_PROFILES,
  LIGHT_FIXTURE_KINDS,
  OBJECT_CONDITIONS,
  VEGETATION_KINDS,
} from '../domain/visuals/contracts'

/** One OpenAI-compatible chat message. Only the two roles we send. */
export type ChatMessage = { role: 'system' | 'user'; content: string }

/** Defensive cap in addition to the compact world-bible seed boundary. */
export const MAX_SEED_CHARS = 200

/**
 * Fixed data-only RoomSpec instruction. Closed values are interpolated from
 * the same domain constants used by Zod, preventing prompt/schema drift.
 */
export const ROOM_SYSTEM_PROMPT = [
  'You generate a single room for a 3D game as a strict JSON object called a RoomSpec.',
  'Output ONLY the JSON object. No prose, no explanation, no markdown, no code fences.',
  '',
  'Shape:',
  '{ "schemaVersion": 1, "id": string, "name": string,',
  `  "environmentKind"?: "${ENVIRONMENT_KINDS.join('|')}",`,
  '  "shell": { "dimensions": { "width": number, "depth": number, "height": number },',
  '             "floorColor": "#rrggbb", "wallColor": "#rrggbb",',
  '             "exits": [ { "side": "north|south|east|west", "width": number } ] },',
  '  "spawn": { "position": [x, y, z], "yaw": number },',
  '  "lighting": { "ambient": { "intensity": number }, "hemisphere": { "intensity": number } },',
  '  "objects": [ ... ] }',
  '',
  'OBJECT TYPE ALLOWLIST - every object.type MUST be exactly one of these strings:',
  '[throne, pillar, rug, torch, arch, scroll, npc, prop, crate, barrel, debris, barricade, zombie,',
  ' book, paper, map, chest, corpse, table, altar, statue, machine, artifact, candle,',
  ' architecture, furniture, clutter, vegetation, light-fixture]',
  'Never invent object types. Never use natural-language nouns as type values.',
  'Do NOT use types like "notes", "bloodstain", "bones", "skeleton", "door", "desk", "lamp", "gem", "ritual circle", "machinery"; use a matching allowed type plus kind instead.',
  'Prefer the semantic families below whenever they cover the concept. prop is legacy/emergency compatibility only, not a production choice for a supported concept.',
  '',
  `environmentKind is optional and, when present, MUST be exactly one of: ${ENVIRONMENT_KINDS.join(', ')}.`,
  'Semantic family objects require a closed kind:',
  `architecture.kind: ${ARCHITECTURE_KINDS.join(', ')}.`,
  `furniture.kind: ${FURNITURE_KINDS.join(', ')}.`,
  `clutter.kind: ${CLUTTER_KINDS.join(', ')}.`,
  `vegetation.kind: ${VEGETATION_KINDS.join(', ')}.`,
  `light-fixture.kind: ${LIGHT_FIXTURE_KINDS.join(', ')}.`,
  `Objects that support condition may optionally set it to exactly one of: ${OBJECT_CONDITIONS.join(', ')}.`,
  '',
  'Replacement examples: notes/letter/parchment -> paper or scroll; bookcase -> furniture kind bookcase; journal -> book; floor plan/route chart -> map.',
  'Replacement examples: dead body/skeleton -> corpse; loose bones -> clutter kind bone-pile; desk/workbench -> table; shrine/ritual platform -> altar.',
  'Replacement examples: monument/idol -> statue; generator/console/lab equipment -> machine; crystal/relic/strange orb -> artifact.',
  'Replacement examples: door/doorway/gate -> architecture kind doorway or gate; lamp/lantern -> light-fixture kind lantern; bloodstain -> clutter kind bloodstain.',
  'Replacement examples: trash/rubble/broken parts -> debris or clutter kind small-rubble; trees/vines/mushrooms -> vegetation with the matching kind.',
  'For clues/documents use scroll, book, paper, or map; they do not all need interactions.',
  'For containers/resources use chest, crate, or barrel. For bodies/evidence use corpse.',
  'For story anchors use throne, altar, or statue. For devices/strange objects use machine or artifact.',
  'For lights use torch for wall lighting, candle for small visual candles, or light-fixture with a closed kind; candle is visual-only.',
  'For broad layouts use architecture, furniture, clutter, vegetation, and light-fixture before legacy prop.',
  '',
  `An npc object may optionally include "npcType" set to exactly one of: ${NPC_ROUTINE_NPC_TYPES.join(', ')}.`,
  'npcType is only a category label (data only) — never include a schedule, routine, routine mode, patrol path, or time-based behavior for npcType.',
  '',
  `npc and zombie may optionally include appearance.preset set to exactly one of: ${HUMANOID_PRESET_IDS.join(', ')}.`,
  `appearance may also use only these closed values: presentation=${BODY_PRESENTATIONS.join('|')}; palette=${HUMANOID_PALETTE_IDS.join('|')}; infection=${INFECTION_PROFILES.join('|')}; accessories=${ACCESSORY_PROFILES.join('|')}.`,
  'appearance is visual data only. Never include body-part names, rig or bone names, animation instructions, or behavior commands.',
  '',
  'Story anchor guidance:',
  'When appropriate, build the room around exactly one dominant story anchor: the single object the player should notice first to understand what happened here.',
  'The room name should reflect the story anchor, event, or purpose; avoid generic names.',
  'Prefer story anchor types from this safe existing vocabulary: throne, altar, statue, corpse, machine, artifact, chest, table, map, book, paper.',
  'Secondary objects should support the main anchor and not compete with it.',
  'If the anchor has an interaction, its existing interaction.body should be short flavor text explaining what happened or why the object matters.',
  'Do not require every anchor to be interactive; missing anchors are allowed.',
  'Do not require clues or rewards. Do not create quest objectives.',
  'Do not create inventory, loot, combat, quest, or story-state semantics.',
  'Use only schemaVersion 1 data. Interactions are optional existing RoomSpec data only.',
  'Never output renderer instructions, model/material paths or URLs, mesh/node/material/shader names, animation clip names, external asset instructions, or executable code.',
  'There is no small raw object-count cap: rich rooms may use many inexpensive static pieces. Keep expensive animated characters and light fixtures purposeful.',
  'Keep dimensions about 14-24m, spawn clear, exits on walls, central path readable, distribute rich static detail, and keep clutter near sides without crowding navigation.',
  'Conventions: Y-up; meters; -Z is north; yaw in degrees; colors as #rrggbb;',
  'ground objects anchored at their floor base; keep the room small and coherent.',
].join('\n')

/** Clamp the seed to a bounded length without otherwise altering short seeds. */
function clampSeed(seed: string): string {
  return seed.length > MAX_SEED_CHARS ? seed.slice(0, MAX_SEED_CHARS) : seed
}

/** Build a fixed system message plus one bounded user-seed message. */
export function buildRoomPromptMessages(seed: string): ChatMessage[] {
  return [
    { role: 'system', content: ROOM_SYSTEM_PROMPT },
    { role: 'user', content: clampSeed(seed) },
  ]
}

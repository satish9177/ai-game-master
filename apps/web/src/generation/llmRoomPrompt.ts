/**
 * Pure prompt builder for the real LLM RoomGenerator
 * (real-room-generator-provider v0; ADR-0007 stage 1, "fast LLM → RoomSpec JSON").
 *
 * This module is intentionally pure and side-effect free: it takes the compact
 * seed the generator already receives and returns the chat messages to send. It
 * performs NO I/O, imports no logger, and never logs — so its bounds are
 * unit-testable in isolation. The provider sends these messages verbatim.
 *
 * The system message instructs the model to emit ONLY a JSON `RoomSpec` (no
 * prose, no markdown fences) using the published vocabulary and conventions. The
 * model's reply is still treated as raw, untrusted text downstream: it flows
 * through `assembleRoom` (`JSON.parse → loadRoomSpec → validateRoom → repair →
 * fallback`), which is the only trust boundary. Nothing here weakens that.
 *
 * The `npcType` hint (generated-npc-routine-type-v0; ADR-0090) reuses the same
 * closed vocabulary already validated by the RoomSpec `Npc.npcType` field
 * (`domain/npcRoutinePresets.ts`) so the prompt and the schema can never drift.
 * It asks for a category label only — never a schedule, routine, mode, patrol
 * path, or time-based behavior; the field is dropped to `undefined` by the
 * schema if the model ever ignores this and emits anything else, so this hint
 * is a population aid, not a trust boundary.
 */
import { NPC_ROUTINE_NPC_TYPES } from '../domain/npcRoutinePresets'

/** One OpenAI-compatible chat message. Only the two roles we send. */
export type ChatMessage = { role: 'system' | 'user'; content: string }

/**
 * Hard cap on the user seed length that reaches the model. The prompt path
 * already bounds the seed to ≤160 chars (`worldBibleToGeneratorSeed`); this is a
 * defensive clamp so no unbounded user text can ever be sent, even if a caller
 * passes a raw prompt (the world-bible failure fallback).
 */
export const MAX_SEED_CHARS = 200

/**
 * The system instruction. Static, prompt-free, and bounded. It names the
 * published object vocabulary (CONVENTIONS.md / ADR-0001), the RoomSpec shape,
 * and the coordinate/color conventions, and demands raw JSON with no fences.
 */
export const ROOM_SYSTEM_PROMPT = [
  'You generate a single room for a 3D game as a strict JSON object called a RoomSpec.',
  'Output ONLY the JSON object. No prose, no explanation, no markdown, no code fences.',
  '',
  'Shape:',
  '{ "schemaVersion": 1, "id": string, "name": string,',
  '  "shell": { "dimensions": { "width": number, "depth": number, "height": number },',
  '             "floorColor": "#rrggbb", "wallColor": "#rrggbb",',
  '             "exits": [ { "side": "north|south|east|west", "width": number } ] },',
  '  "spawn": { "position": [x, y, z], "yaw": number },',
  '  "lighting": { "ambient": { "intensity": number }, "hemisphere": { "intensity": number } },',
  '  "objects": [ ... ] }',
  '',
  'OBJECT TYPE ALLOWLIST — every object.type MUST be exactly one of these strings:',
  '[throne, pillar, rug, torch, arch, scroll, npc, prop, crate, barrel, debris, barricade, zombie,',
  ' book, paper, map, chest, corpse, table, altar, statue, machine, artifact, candle]',
  'Never invent object types. Never use natural-language nouns as type values.',
  'Do NOT use types like "notes", "bloodstain", "bones", "skeleton", "door", "desk", "lamp", "gem", "ritual circle", "machinery".',
  'If unsure, use prop rather than inventing a new type. If a requested concept has no exact type, choose the closest allowed type.',
  'Replacement examples: notes/letter/parchment -> paper or scroll; bookcase/journal -> book; floor plan/route chart -> map.',
  'Replacement examples: dead body/skeleton/bones -> corpse; desk/workbench -> table; shrine/ritual platform -> altar.',
  'Replacement examples: monument/idol -> statue; generator/console/lab equipment -> machine; crystal/relic/strange orb -> artifact.',
  'Replacement examples: candles/small flames -> candle; door/doorway/gate -> arch; trash/rubble/broken parts -> debris.',
  'For clues/documents use scroll, book, paper, or map; they do not all need interactions.',
  'For containers/resources use chest, crate, or barrel. For bodies/evidence use corpse.',
  'For story anchors use throne, altar, or statue. For devices/strange objects use machine or artifact.',
  'For lights use torch for wall lighting and candle for small visual candles; candle is visual-only.',
  'For generic clutter use debris, barricade, prop, crate, or barrel.',
  '',
  `An npc object may optionally include "npcType" set to exactly one of: ${NPC_ROUTINE_NPC_TYPES.join(', ')}.`,
  'npcType is only a category label (data only) — never include a schedule, routine, routine mode, patrol path, or time-based behavior for npcType.',
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
  'Do not output renderer hints, mesh names, material instructions, external asset instructions, or executable logic.',
  'Keep dimensions about 14-24m, object count under 30, spawn clear, exits on walls, central path readable, clutter near sides.',
  'Conventions: Y-up; meters; -Z is north; yaw in degrees; colors as #rrggbb;',
  'ground objects anchored at their floor base; keep the room small and coherent.',
].join('\n')

/** Clamp the seed to a bounded length without otherwise altering short seeds. */
function clampSeed(seed: string): string {
  return seed.length > MAX_SEED_CHARS ? seed.slice(0, MAX_SEED_CHARS) : seed
}

/**
 * Build the chat messages for a room generation call: a fixed system message and
 * a single user message carrying the (bounded) seed verbatim.
 */
export function buildRoomPromptMessages(seed: string): ChatMessage[] {
  return [
    { role: 'system', content: ROOM_SYSTEM_PROMPT },
    { role: 'user', content: clampSeed(seed) },
  ]
}

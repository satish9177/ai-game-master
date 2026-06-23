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
 */

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
  'Allowed object "type" values only: throne, pillar, rug, torch, arch, scroll, npc, prop.',
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

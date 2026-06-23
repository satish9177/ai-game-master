/**
 * The trusted fallback room (room-generation-repair-fallback v0). DATA ONLY —
 * no logic, no imports, no executable code, and no generated/prompt/story text.
 *
 * When generation produces output that cannot be loaded, validated, or
 * deterministically repaired, the assembly pipeline (a later commit) returns
 * THIS room instead, so the renderer always receives a valid, playable room
 * (ADR-0007 "safe fallback room"; FAILURE-MODES.md cases 4 / 4b).
 *
 * It is deliberately minimal and sits comfortably inside the semantic validator
 * limits (validateRoom.ts LIMITS): a small square stone room, spawn centered and
 * in bounds, one declared exit, a handful of safe known-type objects, two
 * torches. It is authored to raise zero fatal AND zero warning semantic issues
 * (guarded by fallbackRoom.test.ts).
 *
 * Validated at runtime by loadRoomSpec(); kept as a plain literal so it stays
 * pure data rather than coupling to the schema's inferred type.
 *
 * Conventions: Y-up, meters, -Z = north, rotationY in degrees.
 */
export const fallbackRoom = {
  schemaVersion: 1,
  id: 'fallback-room',
  name: 'A quiet stone antechamber',
  shell: {
    dimensions: { width: 8, depth: 8, height: 4 },
    floorColor: '#3c3a33',
    wallColor: '#5a5347',
    exits: [{ side: 'north', width: 3 }],
  },
  spawn: { position: [0, 1.7, 0], yaw: 180 }, // centered, facing the north arch
  lighting: {
    ambient: { intensity: 0.85 }, // dark but readable
    hemisphere: { intensity: 0.5 },
  },
  objects: [
    { type: 'rug', position: [0, 0.01, 0], size: [4, 4] },
    { type: 'pillar', position: [-3, 0, -3] },
    { type: 'pillar', position: [3, 0, -3] },
    { type: 'pillar', position: [-3, 0, 3] },
    { type: 'pillar', position: [3, 0, 3] },
    { type: 'torch', position: [-3, 3, -3], light: { intensity: 10, distance: 8 } },
    { type: 'torch', position: [3, 3, -3], light: { intensity: 10, distance: 8 } },
    { type: 'arch', position: [0, 0, -4] }, // frames the north exit
  ],
}

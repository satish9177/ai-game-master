/**
 * Hardcoded demo room. DATA ONLY — no logic, no imports, no executable code.
 * Conventions: Y-up, meters, -Z = north, rotationY in degrees.
 *
 * Validated at runtime by loadRoomSpec(); kept as a plain literal so it stays
 * pure data rather than coupling to the schema's inferred type.
 */
export const throneRoom = {
  schemaVersion: 1,
  id: 'throne-room',
  name: 'Throne Room',
  shell: {
    dimensions: { width: 14, depth: 20, height: 6 },
    exits: [{ side: 'north', width: 3 }],
  },
  spawn: { position: [0, 1.7, 8], yaw: 180 }, // near south wall, facing north
  lighting: {
    ambient: { intensity: 0.85 }, // dark but readable
    hemisphere: { intensity: 0.5 },
  },
  objects: [
    { type: 'throne', position: [0, 0, -8], rotationY: 180 },
    { type: 'rug', position: [0, 0.01, -2], size: [4, 10] },
    { type: 'pillar', position: [-4, 0, -4] },
    { type: 'pillar', position: [4, 0, -4] },
    { type: 'pillar', position: [-4, 0, 2] },
    { type: 'pillar', position: [4, 0, 2] },
    { type: 'torch', position: [-4, 3, -4], light: { intensity: 12, distance: 9 } },
    { type: 'torch', position: [4, 3, -4], light: { intensity: 12, distance: 9 } },
    {
      type: 'scroll',
      position: [2, 0.5, 2],
      interaction: { key: 'E', prompt: 'Press E to read the scroll', body: 'A faded decree bearing the royal seal.' },
    },
    {
      type: 'npc',
      name: 'Malik',
      position: [-2, 0, 0],
      interaction: { key: 'F', prompt: 'Press F to speak with Malik', body: 'The steward Malik regards you warily.' },
    },
    { type: 'arch', position: [0, 0, -10] }, // at the north exit
  ],
}

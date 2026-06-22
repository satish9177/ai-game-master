/**
 * Showcase room for the zombie / post-apocalyptic asset pack v0. DATA ONLY —
 * no logic, no imports, no executable code. Exercises the full new vocabulary
 * (crate, barrel, debris, barricade, zombie) alongside existing props so the
 * pack can be reviewed end-to-end. A ransacked safe house with the street
 * barricaded and the dead still inside.
 *
 * Validated at runtime by loadRoomSpec(); kept as a plain literal so it stays
 * pure data rather than coupling to the schema's inferred type.
 *
 * Conventions: Y-up, meters, -Z = north, rotationY in degrees.
 */
export const ruinedRoom = {
  schemaVersion: 1,
  id: 'ruined-safehouse',
  name: 'Ransacked Safe House',
  shell: {
    dimensions: { width: 16, depth: 14, height: 5 },
    floorColor: '#3a3a36',
    wallColor: '#55524a',
    exits: [{ side: 'north', width: 3 }],
  },
  spawn: { position: [0, 1.7, 5], yaw: 180 }, // near the south door, facing north
  lighting: {
    ambient: { intensity: 0.7 },
    hemisphere: { intensity: 0.45 },
  },
  objects: [
    // Barricaded approaches: sandbags across the room, a salvaged plank wall.
    { type: 'barricade', position: [-4, 0, 4], length: 4, style: 'sandbags' },
    { type: 'barricade', position: [5, 0, 2], length: 3, rotationY: 90, style: 'planks' },

    // Looted supplies stacked along the east wall.
    {
      type: 'crate',
      id: 'medical-crate',
      position: [6, 0, -2],
      size: [1.2, 1.2, 1.2],
      interaction: {
        key: 'E',
        prompt: 'Press E to search the medical crate',
        body: 'A sealed field medkit remains under the torn packing cloth.',
        effect: {
          kind: 'take-item',
          item: { itemId: 'medkit', name: 'Field Medkit', quantity: 1 },
        },
      },
    },
    { type: 'crate', position: [6.9, 0, -1.1], size: [1, 1, 1] },
    { type: 'crate', position: [7, 0, 3], size: [1, 1.4, 1] },

    // Fuel and water drums clustered in the west corner.
    {
      type: 'barrel',
      id: 'medkit-use-point',
      position: [-6, 0, -3],
      interaction: {
        key: 'E',
        prompt: 'Press E to use a medkit',
        body: 'The drum offers a flat surface and a little cover to dress your wounds.',
        effect: {
          kind: 'use-item',
          itemId: 'medkit',
          quantity: 1,
          health: { delta: 25 },
        },
      },
    },
    { type: 'barrel', position: [-6.8, 0, -3.4] },
    { type: 'barrel', position: [-6, 0, -2.1], color: '#7a5230' }, // rusted

    // Collapsed masonry and wreckage toward the back.
    { type: 'debris', position: [3, 0, -5], size: [3, 1, 2.4] },
    { type: 'debris', position: [-3, 0, -5.5], size: [2.5, 0.9, 2] },

    // The dead. One examinable; one just shambling scenery.
    {
      type: 'zombie',
      id: 'slumped-corpse',
      position: [-2, 0, -3],
      rotationY: 20,
      interaction: {
        key: 'F',
        prompt: 'Press F to examine the slumped corpse',
        effect: { kind: 'inspect' },
      },
    },
    // A walker that rises when approached — a survival encounter (ADR-0015):
    // fight (damage + infection), hide (nothing happens), or run (slip away).
    {
      type: 'zombie',
      id: 'lurching-walker',
      position: [2.5, 0, -4],
      rotationY: -30,
      interaction: {
        key: 'F',
        prompt: 'Press F to face the walker',
        encounter: {
          id: 'walker-encounter',
          title: 'A Reanimated Walker',
          description: 'A corpse lurches upright between you and the back wall, jaws working.',
          choices: [
            {
              id: 'fight',
              action: 'fight',
              label: 'Put it down',
              outcome: {
                effects: [
                  { kind: 'damage', amount: 20 },
                  { kind: 'add-status', status: 'infected' },
                ],
                resultText: 'You crush its skull — but not before its teeth find your arm.',
              },
            },
            {
              id: 'hide',
              action: 'hide',
              label: 'Hold still and hide',
              outcome: {
                effects: [],
                resultText: 'You press into the shadows until it shambles past.',
              },
            },
            {
              id: 'run',
              action: 'run',
              label: 'Run for the door',
              outcome: {
                effects: [],
                resultText: 'You bolt for the north arch and do not look back.',
              },
            },
          ],
        },
      },
    },

    // A scavenged note and a toppled shelf.
    {
      type: 'scroll',
      id: 'east-wall-note',
      position: [6, 0.5, 4],
      interaction: {
        key: 'E',
        prompt: 'Press E to read the note',
        body: 'Scrawled in haste: "They got through the east wall. Don\'t open it."',
        effect: { kind: 'inspect' },
      },
    },
    { type: 'prop', shape: 'box', position: [7, 0, 0], size: [0.6, 1.8, 2], color: '#6f675a' },

    // Failing emergency lights bracketed high on the north wall.
    { type: 'torch', position: [-7.5, 3, -6], light: { color: '#9fd0ff', intensity: 9, distance: 9 } },
    { type: 'torch', position: [7.5, 3, -6], light: { color: '#9fd0ff', intensity: 9, distance: 9 } },

    // A buckled doorway framing the north exit.
    {
      type: 'arch',
      id: 'north-door',
      position: [0, 0, -7],
      interaction: {
        key: 'E',
        prompt: 'Press E to leave through the north arch',
        exit: { toRoomId: 'throne-room' },
      },
    },
  ],
}

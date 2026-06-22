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
    { type: 'crate', position: [6, 0, -2], size: [1.2, 1.2, 1.2] },
    { type: 'crate', position: [6.9, 0, -1.1], size: [1, 1, 1] },
    { type: 'crate', position: [7, 0, 3], size: [1, 1.4, 1] },

    // Fuel and water drums clustered in the west corner.
    { type: 'barrel', position: [-6, 0, -3] },
    { type: 'barrel', position: [-6.8, 0, -3.4] },
    { type: 'barrel', position: [-6, 0, -2.1], color: '#7a5230' }, // rusted

    // Collapsed masonry and wreckage toward the back.
    { type: 'debris', position: [3, 0, -5], size: [3, 1, 2.4] },
    { type: 'debris', position: [-3, 0, -5.5], size: [2.5, 0.9, 2] },

    // The dead. One examinable; one just shambling scenery.
    {
      type: 'zombie',
      position: [-2, 0, -3],
      rotationY: 20,
      interaction: { key: 'F', prompt: 'Press F to examine the slumped corpse' },
    },
    { type: 'zombie', position: [2.5, 0, -4], rotationY: -30 },

    // A scavenged note and a toppled shelf.
    {
      type: 'scroll',
      position: [6, 0.5, 4],
      interaction: {
        key: 'E',
        prompt: 'Press E to read the note',
        body: 'Scrawled in haste: "They got through the east wall. Don\'t open it."',
      },
    },
    { type: 'prop', shape: 'box', position: [7, 0, 0], size: [0.6, 1.8, 2], color: '#6f675a' },

    // Failing emergency lights bracketed high on the north wall.
    { type: 'torch', position: [-7.5, 3, -6], light: { color: '#9fd0ff', intensity: 9, distance: 9 } },
    { type: 'torch', position: [7.5, 3, -6], light: { color: '#9fd0ff', intensity: 9, distance: 9 } },

    // A buckled doorway framing the north exit.
    { type: 'arch', position: [0, 0, -7] },
  ],
}

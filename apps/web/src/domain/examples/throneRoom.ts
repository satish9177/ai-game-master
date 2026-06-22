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
      id: 'royal-decree',
      position: [2, 0.5, 2],
      interaction: {
        key: 'E',
        prompt: 'Press E to read the scroll',
        body: 'A faded decree bearing the royal seal.',
        effect: { kind: 'inspect' },
      },
    },
    // A coffer of tribute — open it for the coin the steward expects.
    {
      type: 'crate',
      id: 'offering-coffer',
      position: [3, 0, 4],
      interaction: {
        key: 'E',
        prompt: 'Press E to open the offering coffer',
        body: 'A coffer of tribute left for the court. A single gold coin remains.',
        effect: {
          kind: 'take-item',
          item: { itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 },
        },
      },
    },
    {
      type: 'npc',
      id: 'steward-malik',
      name: 'Malik',
      position: [-2, 0, 0],
      // Both an effect and an encounter: the encounter takes precedence
      // (ADR-0015 decision 3), so pressing F opens the confrontation. A
      // fantasy/mystery encounter — distract gates on the coin without spending
      // it, negotiate spends it for a writ, and fighting costs health.
      interaction: {
        key: 'F',
        prompt: 'Press F to confront Malik',
        body: 'The steward Malik bars the dais, hand resting on his sword.',
        effect: { kind: 'inspect' },
        encounter: {
          id: 'malik-encounter',
          title: 'Steward Malik',
          description: 'Malik blocks the way to the throne. "None pass without tribute."',
          choices: [
            {
              id: 'distract',
              action: 'distract',
              label: 'Dangle the coin to distract him',
              requires: { itemId: 'gold-coin', quantity: 1 },
              outcome: {
                effects: [],
                resultText: "You jingle the coin; as his eyes follow it, you slip past.",
              },
            },
            {
              id: 'negotiate',
              action: 'negotiate',
              label: 'Offer the coin for passage',
              requires: { itemId: 'gold-coin', quantity: 1 },
              outcome: {
                effects: [
                  { kind: 'remove-item', itemId: 'gold-coin', quantity: 1 },
                  { kind: 'add-item', item: { itemId: 'royal-writ', name: 'Royal Writ', quantity: 1 } },
                ],
                resultText: 'Malik pockets the coin and presses a sealed writ into your hand.',
              },
            },
            {
              id: 'fight',
              action: 'fight',
              label: 'Force your way past',
              outcome: {
                effects: [{ kind: 'damage', amount: 15 }],
                resultText: "His blade opens your side before you wrestle past him.",
              },
            },
          ],
        },
      },
    },
    { type: 'arch', position: [0, 0, -10] }, // at the north exit
  ],
}
